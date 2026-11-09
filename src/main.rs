mod crypto;
mod input;
mod keys;
mod network;
mod page;
mod touchpad;
mod transport;
mod wire;
use input::{Command, Pointer};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    net::TcpListener,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use transport::Stream;
struct State {
    verbose: bool,
    keyboard_debug: bool,
    token: String,
    origin: String,
    preview: bool,
    pointer: Mutex<Pointer>,
    clients: AtomicUsize,
    tls: Option<Arc<transport::Tls>>,
}
struct Lease(Arc<State>);
impl Drop for Lease {
    fn drop(&mut self) {
        self.0.clients.fetch_sub(1, Ordering::Relaxed);
    }
}
fn invalid(s: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, s)
}
fn token(rotate: bool) -> io::Result<String> {
    let dir = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config")
        })
        .join("ghostpad");
    fs::create_dir_all(&dir)?;
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
    let path = dir.join("pairing-key");
    if rotate {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
    {
        Ok(mut f) => {
            let key = crypto::secret()?;
            f.write_all(key.as_bytes())?;
            Ok(key)
        }
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            let meta = fs::symlink_metadata(&path)?;
            if !meta.is_file() || meta.permissions().mode() & 0o077 != 0 {
                return Err(invalid("Pairing key must be a regular file with mode 600"));
            }
            let key = fs::read_to_string(path)?;
            if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(invalid("Invalid saved pairing key; use --rotate-key"));
            }
            Ok(key)
        }
        Err(e) => Err(e),
    }
}
fn respond(
    c: &mut impl Write,
    origin: &str,
    status: &str,
    mime: &str,
    body: &[u8],
) -> io::Result<()> {
    let websocket_origin = origin.replacen("http", "ws", 1);
    let asset_policy = &page::page().policy;
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; connect-src 'self' {websocket_origin}; {asset_policy}; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\n\r\n",
        body.len()
    );
    c.write_all(headers.as_bytes())?;
    c.write_all(body)
}
fn serve(tcp: std::net::TcpStream, state: Arc<State>) -> io::Result<()> {
    let _lease = Lease(state.clone());
    tcp.set_nodelay(true)?;
    tcp.set_read_timeout(Some(Duration::from_secs(5)))?;
    tcp.set_write_timeout(Some(Duration::from_secs(3)))?;
    let c = transport::Connection::new(tcp, state.tls.clone())?;
    handle(c, &state)
}
fn handle(c: impl transport::Stream, state: &State) -> io::Result<()> {
    let mut c = transport::Buffered::new(c);
    c.begin_read();
    let mut request = Vec::new();
    let mut b = [0];
    while !request.ends_with(b"\r\n\r\n") {
        if request.len() >= 8192 {
            return Err(invalid("Headers too large"));
        }
        c.read_exact(&mut b)?;
        request.push(b[0]);
    }
    let text = std::str::from_utf8(&request).map_err(|_| invalid("Invalid HTTP"))?;
    let mut lines = text.split("\r\n");
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    let mut headers = HashMap::new();
    for line in lines.filter(|x| !x.is_empty()) {
        let (k, v) = line
            .split_once(':')
            .ok_or_else(|| invalid("Invalid header"))?;
        if headers
            .insert(k.to_ascii_lowercase(), v.trim().to_string())
            .is_some()
        {
            return Err(invalid("Duplicate header"));
        }
    }
    if method != "GET" {
        return respond(
            &mut c,
            &state.origin,
            "405 Method Not Allowed",
            "text/plain",
            b"GET only",
        );
    }
    let expected_host = state.origin.split_once("://").unwrap().1;
    if headers.get("host").map(String::as_str) != Some(expected_host) {
        return respond(
            &mut c,
            &state.origin,
            "403 Forbidden",
            "text/plain",
            b"Use the address printed by Ghostpad",
        );
    }
    if state.verbose {
        let resource = match path {
            "/" => "page",
            "/ws" => "WebSocket",
            "/health" => "health check",
            "/style.css" | "/app.js" | "/gestures.js" | "/scroll.js" | "/icon.svg" => "asset",
            _ => "unknown path",
        };
        eprintln!("ghostpad: received GET for {resource}");
    }
    if let Some(trace) = path.strip_prefix("/keyboard-trace?") {
        let valid = !trace.is_empty()
            && trace.len() <= 6000
            && trace
                .bytes()
                .all(|b| b.is_ascii_digit() || matches!(b, b',' | b';' | b'.' | b'-'));
        if valid && state.keyboard_debug {
            eprintln!("ghostpad-layout: {trace}");
        }
        return respond(
            &mut c,
            &state.origin,
            if valid {
                "204 No Content"
            } else {
                "400 Bad Request"
            },
            "text/plain",
            b"",
        );
    }
    if path == "/keyboard-debug" || path.starts_with("/keyboard-debug?") {
        // Old diagnostic tabs continue working as the normal app unless explicitly enabled.
        let body = if state.keyboard_debug {
            page::page().html.replace(
                "</body>",
                "<script src=\"/keyboard-debug.js\"></script></body>",
            )
        } else {
            page::page().html.clone()
        };
        return respond(
            &mut c,
            &state.origin,
            "200 OK",
            "text/html; charset=utf-8",
            body.as_bytes(),
        );
    }
    if path == "/ws" {
        if headers.get("origin") != Some(&state.origin)
            || headers.get("sec-websocket-version").map(String::as_str) != Some("13")
            || !headers
                .get("upgrade")
                .is_some_and(|v| v.eq_ignore_ascii_case("websocket"))
            || !headers.get("connection").is_some_and(|v| {
                v.split(',')
                    .any(|x| x.trim().eq_ignore_ascii_case("upgrade"))
            })
        {
            return respond(
                &mut c,
                &state.origin,
                "403 Forbidden",
                "text/plain",
                b"Invalid WebSocket origin or upgrade",
            );
        }
        let key = headers
            .get("sec-websocket-key")
            .filter(|k| {
                k.len() == 24
                    && k.ends_with("==")
                    && k.as_bytes()[..22]
                        .iter()
                        .copied()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
            })
            .ok_or_else(|| invalid("Invalid WebSocket key"))?;
        let flow = headers
            .get("sec-websocket-protocol")
            .is_some_and(|v| v.split(',').any(|p| p.trim() == "ghostpad.flow.v1"));
        let protocol = if flow {
            "Sec-WebSocket-Protocol: ghostpad.flow.v1\r\n"
        } else {
            ""
        };
        let upgrade = format!(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n{protocol}\r\n",
            crypto::accept(key)
        );
        c.write_all(upgrade.as_bytes())?;
        c.begin_read();
        let mut frame = [0; 125];
        let (op, data) = wire::read_frame(&mut c, &mut frame)?;
        if op != 1 || !crypto::equal(data, state.token.as_bytes()) {
            wire::send(&mut c, 1, b"unauthorized")?;
            return Ok(());
        }
        let Ok(mut pointer) = state.pointer.try_lock() else {
            wire::send(&mut c, 1, b"busy")?;
            return Ok(());
        };
        wire::send(
            &mut c,
            1,
            if state.preview {
                b"ready:preview"
            } else {
                b"ready:linux"
            },
        )?;
        if state.verbose {
            eprintln!("ghostpad: phone authenticated; controller ready");
        }
        let result = (|| {
            let mut window = Instant::now();
            let mut count = 0;
            let mut sequence = 0u16;
            loop {
                c.begin_read();
                let (op, data) = wire::read_frame(&mut c, &mut frame)?;
                if window.elapsed() >= Duration::from_secs(1) {
                    window = Instant::now();
                    count = 0;
                }
                count += 1;
                if count > 300 {
                    return Err(invalid("Input rate exceeded"));
                }
                match op {
                    8 => {
                        wire::send(&mut c, 8, &[])?;
                        break;
                    }
                    9 => wire::send(&mut c, 10, data)?,
                    10 => {}
                    2 => {
                        let payload = if flow {
                            if data.len() < 4 || data[0] != 17 {
                                return Err(invalid("Expected acknowledged input"));
                            }
                            let next = u16::from_le_bytes([data[1], data[2]]);
                            if next != sequence.wrapping_add(1) {
                                return Err(invalid("Invalid input sequence"));
                            }
                            sequence = next;
                            &data[3..]
                        } else {
                            data
                        };
                        let command = input::decode(payload)?;
                        if command == Command::Ping {
                            wire::send(&mut c, 1, b"pong")?;
                        } else {
                            pointer.handle(command)?;
                        }
                        // Confirm only after validation and native input delivery.
                        if flow {
                            wire::send(&mut c, 2, &data[..3])?;
                        }
                    }
                    _ => return Err(invalid("Expected binary input")),
                }
            }
            Ok(())
        })();
        pointer.release()?;
        result
    } else {
        let (mime, body): (&str, &[u8]) = match path {
            "/" => ("text/html; charset=utf-8", page::page().html.as_bytes()),
            "/style.css" => ("text/css", include_bytes!("../web/style.css")),
            "/app.js" => ("text/javascript", include_bytes!("../web/app.js")),
            "/keyboard-debug.js" if state.keyboard_debug => (
                "text/javascript",
                include_bytes!("../web/keyboard-debug.js"),
            ),
            "/gestures.js" => ("text/javascript", include_bytes!("../web/gestures.js")),
            "/flow.js" => ("text/javascript", include_bytes!("../web/flow.js")),
            "/scroll.js" => ("text/javascript", include_bytes!("../web/scroll.js")),
            "/text.js" => ("text/javascript", include_bytes!("../web/text.js")),
            "/icon.svg" => ("image/svg+xml", include_bytes!("../web/icon.svg")),
            "/health" => ("text/plain", b"ghostpad/1"),
            _ => {
                return respond(
                    &mut c,
                    &state.origin,
                    "404 Not Found",
                    "text/plain",
                    b"Not found",
                );
            }
        };
        respond(&mut c, &state.origin, "200 OK", mime, body)?;
        if state.verbose {
            eprintln!("ghostpad: HTTP response sent ({} bytes)", body.len());
        }
        Ok(())
    }
}
fn run() -> io::Result<()> {
    let mut verbose = false;
    let mut keyboard_debug = false;
    let mut preview = false;
    let mut rotate = false;
    let mut address = None;
    let mut port = 8765u16;
    let mut cert = None;
    let mut key = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--preview" => preview = true,
            "--verbose" => verbose = true,
            "--keyboard-debug" => keyboard_debug = true,
            "--rotate-key" => rotate = true,
            "--address" => address = Some(args.next().ok_or_else(|| invalid("Missing address"))?),
            "--port" => {
                port = args
                    .next()
                    .ok_or_else(|| invalid("Missing port"))?
                    .parse()
                    .map_err(|_| invalid("Invalid port"))?
            }
            "--cert" => cert = Some(args.next().ok_or_else(|| invalid("Missing cert"))?),
            "--key" => key = Some(args.next().ok_or_else(|| invalid("Missing key"))?),
            "--help" | "-h" => {
                println!(
                    "Ghostpad 0.3.0\n  --verbose        Show connection diagnostics (no pairing secrets)\n  --keyboard-debug Enable /keyboard-debug and numeric layout logging\n  --preview        Connect without controlling the cursor\n  --address IP     LAN IPv4 address for pairing and binding\n  --port PORT      Default: 8765\n  --cert FILE --key FILE   Enable HTTPS (certificate must be trusted on phone)\n  --rotate-key     Revoke all previously paired browsers\n\nStart, scan the terminal QR code with your phone, keep Ghostpad open."
                );
                return Ok(());
            }
            _ => return Err(invalid(&format!("Unknown option: {arg}"))),
        }
    }
    let address = match address {
        Some(address) => address,
        None => network::address()?.to_string(),
    };
    let ip: std::net::Ipv4Addr = address
        .parse()
        .map_err(|_| invalid("--address must be an IPv4 address on this computer"))?;
    if port == 0 || ip.is_unspecified() || ip.is_multicast() {
        return Err(invalid("Use a specific LAN address and nonzero port"));
    }
    let tls = match (cert, key) {
        (Some(c), Some(k)) => Some(transport::Tls::new(&c, &k)?),
        (None, None) => None,
        _ => return Err(invalid("Supply both --cert and --key")),
    };
    let pointer = Pointer::new(preview).map_err(|e| {
        io::Error::other(format!(
            "Cannot create Linux input device: {e}. See README for uinput setup, or use --preview."
        ))
    })?;
    let origin = format!(
        "{}://{address}:{port}",
        if tls.is_some() { "https" } else { "http" }
    );
    let token = token(rotate)?;
    let listener = TcpListener::bind((ip, port))?;
    println!(
        "\n  GHOSTPAD · {}\n",
        if preview {
            "PREVIEW — cursor input disabled"
        } else {
            "Linux receiver"
        }
    );
    if tls.is_none() {
        println!(
            "  Trusted Wi-Fi only: HTTP traffic is not encrypted.\n  Use --cert and --key for TLS.\n"
        );
    }
    let link = format!("{origin}/#key={token}");
    // Secrets travel to qrencode over stdin, not process arguments.
    if let Ok(mut child) = std::process::Command::new("qrencode")
        .args(["-t", "ANSIUTF8", "-m", "2"])
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(link.as_bytes());
        }
        let _ = child.wait();
    }
    println!(
        "  Scan with your phone, or open:\n  {link}\n\n  Keep this terminal private. Ctrl+C stops the receiver.\n"
    );
    if ip.is_loopback() {
        eprintln!(
            "ghostpad: this address is computer-only. Use --address with your Wi-Fi IPv4 address for an iPhone."
        );
    }
    println!("  Page check: {origin}/health (should show ghostpad/1)\n");
    let state = Arc::new(State {
        verbose,
        keyboard_debug,
        token,
        origin,
        preview,
        pointer: Mutex::new(pointer),
        clients: AtomicUsize::new(0),
        tls,
    });
    for tcp in listener.incoming() {
        let tcp = tcp?;
        if verbose {
            eprintln!("ghostpad: incoming connection from {}", tcp.peer_addr()?);
        }
        if state.clients.fetch_add(1, Ordering::Relaxed) >= 16 {
            state.clients.fetch_sub(1, Ordering::Relaxed);
            continue;
        }
        let state = state.clone();
        std::thread::spawn(move || match serve(tcp, state) {
            Err(error) if verbose => eprintln!("ghostpad: connection ended: {error}"),
            _ => {}
        });
    }
    Ok(())
}
fn main() {
    if let Err(e) = run() {
        eprintln!("ghostpad: {e}");
        std::process::exit(1)
    }
}

#[cfg(test)]
mod server_tests {
    use super::*;
    struct Memory {
        input: io::Cursor<Vec<u8>>,
        output: Vec<u8>,
        reads: usize,
        writes: Vec<usize>,
        chunk: usize,
        deadlines: usize,
    }
    impl Memory {
        fn new(input: Vec<u8>, chunk: usize) -> Self {
            Self {
                input: io::Cursor::new(input),
                output: vec![],
                reads: 0,
                writes: vec![],
                chunk,
                deadlines: 0,
            }
        }
    }
    impl transport::Stream for Memory {
        fn begin_read(&mut self) {
            self.deadlines += 1;
        }
    }
    impl io::Read for Memory {
        fn read(&mut self, b: &mut [u8]) -> io::Result<usize> {
            self.reads += 1;
            let len = b.len().min(self.chunk);
            self.input.read(&mut b[..len])
        }
    }
    impl Write for Memory {
        fn write(&mut self, b: &[u8]) -> io::Result<usize> {
            self.writes.push(b.len());
            self.output.extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    fn state() -> State {
        State {
            verbose: false,
            keyboard_debug: false,
            token: "a".repeat(64),
            origin: "http://127.0.0.1:8765".into(),
            preview: true,
            pointer: Mutex::new(Pointer::new(true).unwrap()),
            clients: AtomicUsize::new(0),
            tls: None,
        }
    }
    fn frame(op: u8, data: &[u8]) -> Vec<u8> {
        let mut v = vec![0x80 | op, 0x80 | data.len() as u8, 1, 2, 3, 4];
        v.extend(
            data.iter()
                .enumerate()
                .map(|(i, b)| b ^ [1, 2, 3, 4][i % 4]),
        );
        v
    }
    fn request(path: &str) -> Vec<u8> {
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:8765\r\nOrigin: http://127.0.0.1:8765\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n").into_bytes()
    }
    fn run(bytes: Vec<u8>, state: &State) -> (io::Result<()>, Vec<u8>) {
        let mut m = Memory::new(bytes, usize::MAX);
        let result = handle(&mut m, state);
        (result, m.output)
    }
    fn contains(bytes: &[u8], s: &str) -> bool {
        bytes.windows(s.len()).any(|w| w == s.as_bytes())
    }
    #[test]
    fn assets_and_security_headers() {
        let (r, out) = run(request("/"), &state());
        assert!(r.is_ok());
        assert!(contains(&out, "200 OK"));
        assert!(contains(&out, "frame-ancestors 'none'"));
        assert!(contains(&out, "Tap to start typing"));
    }
    #[test]
    fn keyboard_diagnostics_are_opt_in_and_only_accept_bounded_numeric_samples() {
        let (_, normal) = run(request("/"), &state());
        assert!(!contains(&normal, "/keyboard-debug.js"));
        let mut enabled = state();
        enabled.keyboard_debug = true;
        for path in ["/keyboard-debug", "/keyboard-debug?compare=1"] {
            let (_, quiet) = run(request(path), &state());
            assert_eq!(
                quiet, normal,
                "Old diagnostic tabs must serve the normal app"
            );
            let (_, diagnostic) = run(request(path), &enabled);
            assert!(contains(&diagnostic, "/keyboard-debug.js"));
        }
        let (_, disabled_script) = run(request("/keyboard-debug.js"), &state());
        assert!(contains(&disabled_script, "404 Not Found"));
        let (_, enabled_script) = run(request("/keyboard-debug.js"), &enabled);
        assert!(contains(&enabled_script, "200 OK"));
        for (path, status) in [
            (
                "/keyboard-trace?100,1,844,320,0;120,0,844,320,0",
                "204 No Content",
            ),
            ("/keyboard-trace?text", "400 Bad Request"),
            ("/keyboard-trace?", "400 Bad Request"),
        ] {
            let (_, response) = run(request(path), &state());
            assert!(contains(&response, status));
        }
        let (_, response) = run(
            request(&format!("/keyboard-trace?{}", "1".repeat(6001))),
            &state(),
        );
        assert!(contains(&response, "400 Bad Request"));
    }
    #[test]
    fn http_headers_are_written_together_before_the_body() {
        let mut m = Memory::new(request("/health"), usize::MAX);
        handle(&mut m, &state()).unwrap();
        assert_eq!(m.reads, 1);
        assert_eq!(m.writes.len(), 2);
        assert!(m.output[..m.writes[0]].ends_with(b"\r\n\r\n"));
        assert_eq!(&m.output[m.writes[0]..], b"ghostpad/1");
    }
    #[test]
    fn buffered_frames_preserve_fragmented_and_batched_input() {
        let s = state();
        let mut req = flow_request(&s);
        for sequence in 1..=200 {
            req.extend(acknowledged(sequence, &[1, 0, 0, 160, 63, 0, 0, 32, 192]));
        }
        req.extend(frame(8, &[]));
        for chunk in [1, 2, 3, 7, 125, usize::MAX] {
            let mut m = Memory::new(req.clone(), chunk);
            handle(&mut m, &s).unwrap();
            assert!(contains(&m.output, "ready:preview"));
            assert_eq!(m.deadlines, 203, "Every frame retains its read deadline");
            assert_eq!(m.writes.len(), 203, "Upgrade, ready, 200 ACKs, close");
            assert!(m.output[..m.writes[0]].ends_with(b"\r\n\r\n"));
            let first_ack = m.writes[0] + m.writes[1];
            for (i, ack) in m.output[first_ack..first_ack + 1000].chunks(5).enumerate() {
                let sequence = (i as u16 + 1).to_le_bytes();
                assert_eq!(ack, &[0x82, 3, 17, sequence[0], sequence[1]]);
            }
            assert!(!s.pointer.lock().unwrap().is_down());
            if chunk == usize::MAX {
                assert!(
                    m.reads <= 4,
                    "Available input must not use a read per header byte/frame field"
                );
            }
        }
    }
    #[test]
    fn host_origin_and_duplicate_rejection() {
        for (a, b) in [
            ("Host: 127.0.0.1:8765", "Host: evil.example"),
            (
                "Origin: http://127.0.0.1:8765",
                "Origin: https://evil.example",
            ),
        ] {
            let req = String::from_utf8(request("/ws"))
                .unwrap()
                .replace(a, b)
                .into_bytes();
            let (_, out) = run(req, &state());
            assert!(contains(&out, "403 Forbidden"));
        }
        let req = String::from_utf8(request("/"))
            .unwrap()
            .replace("Host: ", "Host: other\r\nHost: ")
            .into_bytes();
        assert!(run(req, &state()).0.is_err());
    }
    #[test]
    fn invalid_auth_never_controls() {
        let s = state();
        let mut req = request("/ws");
        req.extend(frame(1, b"bad key"));
        req.extend(frame(2, &[5]));
        let (_, out) = run(req, &s);
        assert!(contains(&out, "unauthorized"));
        assert!(!contains(&out, "ready:"));
        assert!(!s.pointer.lock().unwrap().is_down());
    }
    #[test]
    fn valid_input_ping_and_disconnect_release() {
        let s = state();
        let mut req = request("/ws");
        req.extend(frame(1, s.token.as_bytes()));
        req.extend(frame(2, &[5]));
        req.extend(frame(2, &[8]));
        req.extend(frame(8, &[]));
        let (r, out) = run(req, &s);
        assert!(r.is_ok());
        assert!(contains(&out, "ready:preview"));
        assert!(contains(&out, "pong"));
        assert!(!s.pointer.lock().unwrap().is_down());
    }
    #[test]
    fn malformed_input_and_eof_release() {
        for ending in [vec![], frame(2, &[99])] {
            let s = state();
            let mut req = request("/ws");
            req.extend(frame(1, s.token.as_bytes()));
            req.extend(frame(2, &[5]));
            req.extend(ending);
            assert!(run(req, &s).0.is_err());
            assert!(!s.pointer.lock().unwrap().is_down());
        }
    }
    #[test]
    fn lost_connection_releases_keyboard_and_resize_button() {
        let s = state();
        let mut req = request("/ws");
        req.extend(frame(1, s.token.as_bytes()));
        req.extend(frame(2, &[9, 227]));
        req.extend(frame(2, &[12]));
        assert!(run(req, &s).0.is_err());
        assert!(!s.pointer.lock().unwrap().is_down());
    }
    #[test]
    fn lost_connection_or_bad_packet_releases_native_pinch() {
        for ending in [vec![], frame(2, &[99])] {
            let s = state();
            let mut req = request("/ws");
            req.extend(frame(1, s.token.as_bytes()));
            req.extend(frame(
                2,
                &[vec![15], 1.5f32.to_le_bytes().to_vec()].concat(),
            ));
            req.extend(ending);
            assert!(run(req, &s).0.is_err());
            assert!(!s.pointer.lock().unwrap().is_down());
        }
    }
    #[test]
    fn second_controller_is_busy() {
        let s = state();
        let _held = s.pointer.lock().unwrap();
        let mut req = request("/ws");
        req.extend(frame(1, s.token.as_bytes()));
        let (_, out) = run(req, &s);
        assert!(contains(&out, "busy"));
    }
    #[test]
    fn excessive_rate_disconnects() {
        let s = state();
        let mut req = request("/ws");
        req.extend(frame(1, s.token.as_bytes()));
        for _ in 0..301 {
            req.extend(frame(2, &[8]));
        }
        assert!(run(req, &s).0.unwrap_err().to_string().contains("rate"));
    }
    fn flow_request(s: &State) -> Vec<u8> {
        let mut req = String::from_utf8(request("/ws"))
            .unwrap()
            .replace(
                "\r\n\r\n",
                "\r\nSec-WebSocket-Protocol: other, ghostpad.flow.v1\r\n\r\n",
            )
            .into_bytes();
        req.extend(frame(1, s.token.as_bytes()));
        req
    }
    fn acknowledged(sequence: u16, payload: &[u8]) -> Vec<u8> {
        let mut bytes = vec![17];
        bytes.extend(sequence.to_le_bytes());
        bytes.extend(payload);
        frame(2, &bytes)
    }
    #[test]
    fn negotiated_input_is_acknowledged_after_processing() {
        let s = state();
        let mut req = flow_request(&s);
        req.extend(acknowledged(1, &[9, 227]));
        req.extend(acknowledged(2, &[12]));
        req.extend(acknowledged(3, &[7]));
        req.extend(acknowledged(4, &[14, b'x']));
        req.extend(acknowledged(5, &[8]));
        req.extend(frame(8, &[]));
        let (r, out) = run(req, &s);
        assert!(r.is_ok());
        assert!(contains(
            &out,
            "Sec-WebSocket-Protocol: ghostpad.flow.v1\r\n"
        ));
        for sequence in 1..=5 {
            assert!(out.windows(5).any(|w| w == [0x82, 3, 17, sequence, 0]));
        }
        assert!(contains(&out, "pong"));
        assert!(!s.pointer.lock().unwrap().is_down());
    }
    #[test]
    fn invalid_or_replayed_flow_input_releases_without_acknowledgement() {
        for ending in [
            acknowledged(1, &[3]),  // duplicate
            acknowledged(3, &[3]),  // skipped
            acknowledged(2, &[99]), // invalid command
            frame(2, &[17, 2, 0]),  // missing command
            frame(2, &[3]),         // unwrapped command
        ] {
            let s = state();
            let mut req = flow_request(&s);
            req.extend(acknowledged(1, &[5]));
            req.extend(ending);
            let (r, out) = run(req, &s);
            assert!(r.is_err());
            assert_eq!(out.windows(3).filter(|w| *w == [0x82, 3, 17]).count(), 1);
            assert!(!s.pointer.lock().unwrap().is_down());
        }
    }
    #[test]
    fn flow_requires_negotiation_and_still_requires_authentication() {
        let s = state();
        let mut req = request("/ws");
        req.extend(frame(1, s.token.as_bytes()));
        req.extend(acknowledged(1, &[3]));
        assert!(run(req, &s).0.is_err());
        let mut bad = state();
        bad.token = "b".repeat(64);
        let (_, out) = run(flow_request(&s), &bad);
        assert!(contains(&out, "unauthorized"));
        assert!(!contains(&out, "ready:"));
    }
    #[test]
    fn hostile_unicode_key_does_not_panic() {
        let req = String::from_utf8(request("/ws"))
            .unwrap()
            .replace(
                "dGhlIHNhbXBsZSBub25jZQ==",
                &format!("{}é==", "a".repeat(20)),
            )
            .into_bytes();
        assert!(run(req, &state()).0.is_err());
    }
}
