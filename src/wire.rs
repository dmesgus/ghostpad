use std::io::{self, Read, Write};
pub fn read_frame(r: &mut impl Read) -> io::Result<(u8, Vec<u8>)> {
    let bad = || io::Error::new(io::ErrorKind::InvalidData, "Invalid WebSocket frame");
    let mut header = [0; 2];
    r.read_exact(&mut header)?;
    let op = header[0] & 15;
    // Only complete, masked, small frames. No extensions or fragmentation negotiated.
    if header[0] & 0xf0 != 0x80 || header[1] & 0x80 == 0 || ![1, 2, 8, 9, 10].contains(&op) {
        return Err(bad());
    }
    let len = (header[1] & 127) as usize;
    if len > 125 {
        return Err(bad());
    }
    let mut mask = [0; 4];
    r.read_exact(&mut mask)?;
    let mut data = vec![0; len];
    r.read_exact(&mut data)?;
    for (i, b) in data.iter_mut().enumerate() {
        *b ^= mask[i % 4];
    }
    Ok((op, data))
}
pub fn send(w: &mut impl Write, op: u8, data: &[u8]) -> io::Result<()> {
    if data.len() > 125 {
        return Err(io::Error::other("Frame too large"));
    }
    let mut frame = [0u8; 127];
    frame[0] = 0x80 | op;
    frame[1] = data.len() as u8;
    frame[2..2 + data.len()].copy_from_slice(data);
    w.write_all(&frame[..2 + data.len()])?;
    w.flush()
}
#[cfg(test)]
mod tests {
    #[test]
    fn complete_frame_is_written_together() {
        struct Writer {
            writes: Vec<Vec<u8>>,
        }
        impl std::io::Write for Writer {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.writes.push(bytes.to_vec());
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut w = Writer { writes: vec![] };
        super::send(&mut w, 1, b"pong").unwrap();
        assert_eq!(w.writes, vec![b"\x81\x04pong".to_vec()]);
    }
    #[test]
    fn masked() {
        let mut b = &[0x82, 0x81, 1, 2, 3, 4, 2][..];
        assert_eq!(super::read_frame(&mut b).unwrap(), (2, vec![3]));
    }
    #[test]
    fn rejects_unmasked_fragmented_oversized() {
        for b in [[0x82, 1], [0x02, 0x81], [0x82, 0xfe], [0xc2, 0x81]] {
            assert!(super::read_frame(&mut &b[..]).is_err());
        }
    }
}
