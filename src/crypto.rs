//! Cryptographic primitives come from the system OpenSSL, never custom crypto.
use std::{
    ffi::c_void,
    io::{self, Read},
};
#[link(name = "crypto")]
unsafe extern "C" {
    fn SHA256(data: *const u8, len: usize, out: *mut u8) -> *mut u8;
    fn SHA1(data: *const u8, len: usize, out: *mut u8) -> *mut u8;
    fn CRYPTO_memcmp(a: *const c_void, b: *const c_void, len: usize) -> i32;
}
pub fn equal(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len()
        && unsafe { CRYPTO_memcmp(a.as_ptr().cast(), b.as_ptr().cast(), a.len()) == 0 }
}
pub fn secret() -> io::Result<String> {
    let mut bytes = [0; 32];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
pub fn accept(key: &str) -> String {
    let data = format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    let mut digest = [0; 20];
    unsafe {
        SHA1(data.as_ptr(), data.len(), digest.as_mut_ptr());
    }
    base64(&digest)
}
pub fn sha256(data: &[u8]) -> String {
    let mut digest = [0; 32];
    unsafe {
        SHA256(data.as_ptr(), data.len(), digest.as_mut_ptr());
    }
    base64(&digest)
}
fn base64(data: &[u8]) -> String {
    let abc = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        result.push(abc[(n >> 18) as usize] as char);
        result.push(abc[((n >> 12) & 63) as usize] as char);
        result.push(if chunk.len() > 1 {
            abc[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        result.push(if chunk.len() > 2 {
            abc[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    result
}
#[cfg(test)]
mod tests {
    #[test]
    fn rfc_accept() {
        assert_eq!(
            super::accept("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }
    #[test]
    fn sha256_known_vector() {
        assert_eq!(
            super::sha256(b"abc"),
            "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0="
        );
    }
    #[test]
    fn secrets() {
        let a = super::secret().unwrap();
        assert_eq!(a.len(), 64);
        assert!(super::equal(a.as_bytes(), a.as_bytes()));
        assert!(!super::equal(
            a.as_bytes(),
            super::secret().unwrap().as_bytes()
        ));
    }
}
