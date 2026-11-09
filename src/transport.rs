//! Blocking I/O, one bounded worker per connection. OpenSSL owns TLS framing.
use std::{
    ffi::{CString, c_char, c_int, c_long, c_void},
    io::{self, Read, Write},
    net::TcpStream,
    os::fd::AsRawFd,
    sync::Arc,
    time::{Duration, Instant},
};
#[link(name = "ssl")]
unsafe extern "C" {
    fn TLS_server_method() -> *const c_void;
    fn SSL_CTX_new(method: *const c_void) -> *mut c_void;
    fn SSL_CTX_free(ctx: *mut c_void);
    fn SSL_CTX_use_certificate_chain_file(ctx: *mut c_void, path: *const c_char) -> c_int;
    fn SSL_CTX_use_PrivateKey_file(ctx: *mut c_void, path: *const c_char, kind: c_int) -> c_int;
    fn SSL_CTX_check_private_key(ctx: *const c_void) -> c_int;
    fn SSL_CTX_ctrl(ctx: *mut c_void, cmd: c_int, arg: c_long, ptr: *mut c_void) -> c_long;
    fn SSL_new(ctx: *mut c_void) -> *mut c_void;
    fn SSL_free(ssl: *mut c_void);
    fn SSL_set_fd(ssl: *mut c_void, fd: c_int) -> c_int;
    fn SSL_accept(ssl: *mut c_void) -> c_int;
    fn SSL_read(ssl: *mut c_void, out: *mut c_void, len: c_int) -> c_int;
    fn SSL_write(ssl: *mut c_void, data: *const c_void, len: c_int) -> c_int;
}
pub struct Tls(*mut c_void);
// Context is immutable after construction; OpenSSL 1.1+ is internally synchronized.
unsafe impl Send for Tls {}
unsafe impl Sync for Tls {}
impl Tls {
    pub fn new(cert: &str, key: &str) -> io::Result<Arc<Self>> {
        let cert = CString::new(cert)?;
        let key = CString::new(key)?;
        unsafe {
            let ctx = Self(SSL_CTX_new(TLS_server_method()));
            if ctx.0.is_null() {
                return Err(io::Error::other("TLS context failed"));
            }
            if SSL_CTX_ctrl(ctx.0, 123, 0x303, std::ptr::null_mut()) != 1
                || SSL_CTX_use_certificate_chain_file(ctx.0, cert.as_ptr()) != 1
                || SSL_CTX_use_PrivateKey_file(ctx.0, key.as_ptr(), 1) != 1
                || SSL_CTX_check_private_key(ctx.0) != 1
            {
                return Err(io::Error::other(
                    "Unable to load TLS certificate/key (minimum TLS 1.2)",
                ));
            }
            Ok(Arc::new(ctx))
        }
    }
}
impl Drop for Tls {
    fn drop(&mut self) {
        unsafe {
            SSL_CTX_free(self.0);
        }
    }
}
pub trait Stream: Read + Write {
    fn begin_read(&mut self) {}
}
impl<T: Stream + ?Sized> Stream for &mut T {
    fn begin_read(&mut self) {
        (**self).begin_read();
    }
}
// Read whatever is already available in one operation. Writes bypass the read
// buffer so acknowledgements and releases are never delayed by buffering.
pub struct Buffered<S: Stream>(io::BufReader<S>);
impl<S: Stream> Buffered<S> {
    pub fn new(stream: S) -> Self {
        Self(io::BufReader::with_capacity(1024, stream))
    }
}
impl<S: Stream> Read for Buffered<S> {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.0.read(bytes)
    }
}
impl<S: Stream> Write for Buffered<S> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.get_mut().write(bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.0.get_mut().flush()
    }
}
impl<S: Stream> Stream for Buffered<S> {
    fn begin_read(&mut self) {
        self.0.get_mut().begin_read();
    }
}
pub struct Connection {
    deadline: Instant,
    tcp: TcpStream,
    ssl: Option<*mut c_void>,
    _context: Option<Arc<Tls>>,
}
impl Connection {
    pub fn new(tcp: TcpStream, context: Option<Arc<Tls>>) -> io::Result<Self> {
        let mut c = Self {
            deadline: Instant::now() + Duration::from_secs(5),
            tcp,
            ssl: None,
            _context: context.clone(),
        };
        if let Some(ctx) = context {
            unsafe {
                let ssl = SSL_new(ctx.0);
                if ssl.is_null() {
                    return Err(io::Error::other("TLS allocation"));
                }
                c.ssl = Some(ssl);
                if SSL_set_fd(ssl, c.tcp.as_raw_fd()) != 1 || SSL_accept(ssl) != 1 {
                    return Err(io::Error::other("TLS handshake"));
                }
            }
        }
        Ok(c)
    }
}
impl Stream for Connection {
    fn begin_read(&mut self) {
        self.deadline = Instant::now() + Duration::from_secs(5);
    }
}
impl Read for Connection {
    fn read(&mut self, b: &mut [u8]) -> io::Result<usize> {
        if b.is_empty() {
            return Ok(0);
        }
        let remaining = self
            .deadline
            .checked_duration_since(Instant::now())
            .filter(|d| !d.is_zero())
            .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "Read deadline"))?;
        self.tcp.set_read_timeout(Some(remaining))?;
        if let Some(s) = self.ssl {
            let n = unsafe {
                SSL_read(
                    s,
                    b.as_mut_ptr().cast(),
                    b.len().min(i32::MAX as usize) as i32,
                )
            };
            if n > 0 {
                Ok(n as usize)
            } else {
                Err(io::Error::other("TLS read closed or timed out"))
            }
        } else {
            self.tcp.read(b)
        }
    }
}
impl Write for Connection {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        if b.is_empty() {
            return Ok(0);
        }
        if let Some(s) = self.ssl {
            let n =
                unsafe { SSL_write(s, b.as_ptr().cast(), b.len().min(i32::MAX as usize) as i32) };
            if n > 0 {
                Ok(n as usize)
            } else {
                Err(io::Error::other("TLS write closed or timed out"))
            }
        } else {
            self.tcp.write(b)
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        self.tcp.flush()
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        if let Some(s) = self.ssl {
            unsafe { SSL_free(s) }
        }
    }
}
