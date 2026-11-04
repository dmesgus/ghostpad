# Ghostpad

A little space. A lot of control.

Ghostpad turns a phone browser into a wireless trackpad for a Linux computer on the same Wi-Fi. A minimal touch surface, a connection indicator, and settings tucked behind it. Local operation, no accounts, no telemetry, no external assets. MIT licensed.

**v0.2 implementation:** Rust receiver, framework-free TypeScript interface, binary WebSocket input, Linux uinput backend. Designed for Safari on iPhone; Android touch browsers use the same interface. Physical iPhone/Android and compositor testing is still required. Windows/macOS receiver backends are roadmap items, not implemented.

## Run

Requires Linux, Rust 1.85+, a C linker, and OpenSSL development libraries. On Debian/Ubuntu install `build-essential libssl-dev`; on Arch install `base-devel openssl`. Optional `qrencode` prints the phone pairing QR in the terminal. The receiver has **no Cargo registry dependencies**. Compiled browser JavaScript is checked in; Node is needed only to edit the frontend.

```sh
cd ~/Projects/ghostpad
cargo build --release --offline
./scripts/setup-linux.sh
./target/release/ghostpad
```

The setup script loads `uinput` and uses `sudo setfacl` to grant only your current user access to `/dev/uinput`. Install the `acl` package if needed. This access expires on reboot or device recreation. Run the receiver as your normal user. No configuration is automatically installed and no existing desktop settings are modified.

Scan the QR with the iPhone camera, then open the link in Safari. Without `qrencode`, open the complete pairing URL printed in the terminal. Both devices must be on the same Wi-Fi, without AP/client isolation. On systems with UFW enabled (including Omarchy), allow the phone explicitly:

```sh
./scripts/allow-phone.sh PHONE_WIFI_IPV4
```

Find the phone's IPv4 address in its Wi-Fi settings; this is different from the computer address in the QR. The script allows only that source address, on its directly attached interface, to TCP 8765. It uses sudo, leaves the firewall enabled, and refuses routed/public destinations. Add `--dry-run` to print the command without changing rules. Reconfigure this rule if the phone's address/interface changes; custom receiver ports require a matching rule. Remove an old rule with `sudo ufw status numbered` then `sudo ufw delete NUMBER` after identifying the Ghostpad rule.

 Allow inbound TCP 8765 only on your private LAN if your firewall blocks it. Keep the page open and phone unlocked.

Automatic address selection prefers a physical Wi-Fi interface over VPN and container addresses. If multiple interfaces are ambiguous, specify your computer's Wi-Fi IPv4 address:

```sh
./target/release/ghostpad --address 192.168.1.42
```

The receiver binds to that address only and checks Host and WebSocket Origin against it. Use exactly the printed address, including when opening the page on the computer. Address changes require reopening a new pairing URL. A DHCP reservation helps maintain a stable address.

Preview the full connection and gesture flow without Linux input access:

```sh
./target/release/ghostpad --preview
```

Preview mode explicitly disables actual cursor input. Stop either mode with Ctrl+C.

## Gestures

| Action | Gesture |
| --- | --- |
| Move | Slide one finger |
| Left click | Tap one finger |
| Right click | Tap two fingers |
| Vertical/horizontal scroll | Slide two fingers |
| Drag | Hold one finger still for 0.4 seconds, slide, then lift |
| Keyboard | Tap Keys to show/hide the US QWERTY keyboard |
| Super | Tap Super, or briefly tap the pad with three fingers |
| Move a Hyprland window | Position the cursor over it, enable Super, drag one finger |
| Resize a Hyprland window | Position the cursor over it, enable Super, drag two fingers |
| Settings | Tap the connection indicator / ellipsis |

Super, Ctrl, Alt, and Shift are latching modifiers: tap once to hold, tap again to release. Their highlight shows their state. With Super off, two fingers scroll normally; with Super on, they hold the right mouse button to resize. Lifting a drag releases its mouse button but keeps Super active. Opening Settings, touch cancellation, disconnect, and page suspension release every modifier. Keys sends physical US-layout key taps to whichever desktop window has focus, including arrows, Enter, Tab, Escape, Backspace, Delete, and punctuation. For Ctrl+C, enable Ctrl, tap c, then disable Ctrl. Keyboard labels are US QWERTY and Shift modifies the desktop output; other languages/Unicode text composition and hold-to-repeat are not implemented.

Window gestures use the installed Hyprland bindings (Super + left drag to move, Super + right drag to resize). No Hyprland configuration is changed. Place the cursor over the intended window before enabling Super. A three-finger tap can be intercepted by browser/OS accessibility gestures; the Super button always provides the same toggle.

Settings provide pointer sensitivity (0.4–3×), natural scrolling, disconnect/reconnect, and forgetting the phone's pairing. Settings and credentials persist in local browser storage when available. Returning to a suspended tab reconnects automatically. Safari may suspend networking when backgrounded or locked; this implementation does not promise background operation or a screen wake lock.

## Pairing and encryption

The receiver creates a random 256-bit bearer secret at `$XDG_CONFIG_HOME/ghostpad/pairing-key` (default `~/.config/ghostpad/pairing-key`), with mode 600 inside a mode 700 directory. The QR contains this secret in a URL fragment; the browser removes it from the address bar, stores it locally, and authenticates in the first WebSocket message. It is not placed in HTTP request URLs. Only one authenticated phone controls the pointer at a time.

**HTTP is the default and is not encrypted.** Use it only on trusted private Wi-Fi. Anyone who can intercept the connection can steal its bearer secret and control the pointer. Do not forward the port to the internet. For encryption, use a certificate whose CA is trusted by the phone and whose SAN covers the exact LAN IP:

```sh
./target/release/ghostpad --address 192.168.1.42 \
  --cert /path/to/certificate.pem --key /path/to/private-key.pem
```

The receiver then uses HTTPS/WSS with TLS 1.2 or newer through system OpenSSL. Certificate issuance and iPhone trust installation are not automated. A self-signed certificate without phone trust is not a seamless Safari pairing solution. HTTP bootstrap is never automatically upgraded to TLS.

Pairing survives receiver restarts. To revoke **all** old pairings, stop the receiver and restart with `--rotate-key`; scan the new QR. “Forget pairing” deletes this browser's saved credential only; it does not revoke copies on other devices. Per-device credentials and individual revocation are future work. Terminal output contains the pairing secret; keep it private. An optional systemd service logs it to your user journal, which should also be kept private.

The server limits concurrent workers, request/frame sizes, and input rate, validates numeric ranges and origins, and releases buttons on disconnect, protocol errors, page suspension, and a five-second read deadline. Linux removes the virtual device when the receiver exits. This is a first implementation, not a security audit.

## Build and test

```sh
npm install                 # only needed for TypeScript edits / browser tests
npm run build:web
npm test
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --offline
cargo build --offline
python3 tests/integration.py
npm run test:browser        # requires Chromium; CHROMIUM_PATH overrides executable
cargo build --release --offline
```

The compiled JavaScript and CSS are embedded in the Rust binary and served inline in one HTML response, authorized by exact CSP hashes. Startup does not wait for separate style or module downloads. The generated JavaScript targets ES2018, and the page includes viewport/dialog fallbacks and a startup error message. Rebuild Rust after changing it. `tests/integration.py` exercises actual HTTP/WebSocket/TLS connections, key persistence and rotation, invalid authentication, controller exclusion, and timeout recovery. It explicitly skips if socket creation is forbidden. Browser tests exercise a mobile viewport and touch gestures in preview mode, and save screenshots to `artifacts/`.

Validation in the build environment: Rust protocol/server tests and TypeScript gesture tests pass; TypeScript compilation, Clippy, and release compilation pass. Network integration and Chromium execution are blocked by sandbox socket restrictions. Actual iPhone cursor feel, Linux event delivery, TLS handshake interoperability, CPU/battery measurements, and visual browser validation remain to be verified on a normal host. No latency or battery benchmarks are claimed.

## Architecture

- `src/main.rs`: bounded HTTP/WebSocket receiver, pairing storage, authentication, embedded assets.
- `src/transport.rs`: TCP and system OpenSSL TLS boundary.
- `src/wire.rs`: deliberately small WebSocket frame parser; complete masked frames only.
- `src/input.rs`: validated commands, separate pointer/keyboard uinput devices, and release-on-disconnect.
- `src/keys.rs`: USB HID keyboard usage to Linux keycode mapping.
- `web/src/gestures.ts`: pure gesture state machine.
- `web/src/app.ts`: connection lifecycle, keyboard/modifier controls, preferences, and bounded movement batching.

Movement packets contain one opcode plus two little-endian float32 deltas (9 bytes). The browser sends the first movement immediately, coalesces subsequent movement within an 8 ms interval (up to roughly 125 movement packets/second), has no idle animation loop, and sends a small heartbeat every 1.5 seconds. Fractional cursor and wheel motion is retained; Linux receives both high-resolution and legacy wheel events. Backpressure above 256 queued bytes closes the connection instead of replaying a backlog of stale gestures. WebSocket response headers and payload are written together. Settings show measured Wi-Fi round-trip time; this includes network/receiver/browser scheduling and is not a cursor-latency benchmark. Rust uses at most 16 connection threads; a connected phone occupies one thread mostly blocked on input. The tiny HTTP/WebSocket implementation is intentionally narrow; extending it should preserve the parser tests and bounded resource use.

See [PROTOCOL.md](PROTOCOL.md) for the version 1 wire format. The input module is the boundary for future Windows SendInput and macOS CGEvent backends. Native mobile clients can reuse the protocol. A browser client is the fastest path to both phone platforms, but a native iOS client may eventually be needed for more reliable screen/lifecycle handling and easier secure local discovery.

## Optional installation

Copy `target/release/ghostpad` to `~/.local/bin/ghostpad`. `packaging/ghostpad.service` is an optional user service template; inspect and customize its address/TLS flags before installing. It does not grant input access. No service has been installed or enabled by this project.

## Roadmap

- Test and tune on physical iPhones, Android phones, and multiple Linux compositors.
- Add per-device pairing approval, individual revocation, and easier trusted TLS setup.
- Add a desktop tray/pairing panel, local discovery, and a signed release/install path.
- Implement Windows and macOS input backends and native mobile clients if needed.
- Measure latency, idle CPU, and battery use on real Wi-Fi before making performance claims.

Inspired by [NomadPadServer](https://github.com/r1cA18/NomadPadServer), whose native macOS receiver offers QR pairing and trackpad input. Ghostpad is an independent implementation with its own protocol; it is not compatible with the NomadPad iOS app. References: [Linux uinput](https://docs.kernel.org/input/uinput.html), [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455), [OpenSSL](https://docs.openssl.org/3.0/man3/SSL_accept/).

## A blank or still-loading phone page

Stop the existing receiver with Ctrl+C before running a rebuilt binary. Start `./target/release/ghostpad --verbose`, then scan its QR again. Diagnostics log incoming connections, page requests/responses, and controller authentication without logging the pairing credential.

Open the printed `/health` address in Safari and on the computer: it must display `ghostpad/1`. If Safari shows no page and the receiver logs no incoming connection, the request is not reaching Ghostpad: verify the exact HTTP/HTTPS address, Wi-Fi interface, firewall, and network client isolation. Page-rendering changes cannot repair an unreachable LAN address. Do not share the part of the pairing URL after `#`.

The page now displays errors if its JavaScript cannot start or a WebSocket connection stalls. Use the visible message to distinguish startup, pairing, and network failures.

Confirmed local diagnosis on 2026-11-04: the kernel journal recorded `[UFW BLOCK]` TCP SYN packets from the phone to port 8765. A blank/still-loading page in that incident was a firewall block, not a gesture or JavaScript error. The original setup script only granted uinput access; it now also points out enabled UFW and the phone-specific rule helper.

## Updating to 0.2

Stop the old receiver with Ctrl+C, run the rebuilt `./target/release/ghostpad --verbose`, and refresh the existing Safari tab (or scan the printed QR if the LAN address changed). Both the new phone UI and receiver must be loaded for keyboard packets. Existing pairing credentials and UFW rules still apply. New keyboard/gesture behavior has automated protocol and browser-state tests; actual iPhone/Hyprland validation and latency measurement require the real devices.
