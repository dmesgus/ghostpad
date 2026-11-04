use std::{
    collections::BTreeSet,
    fs::{File, OpenOptions},
    io::{self, Write},
    os::fd::AsRawFd,
};
unsafe extern "C" {
    fn ioctl(fd: i32, request: std::ffi::c_ulong, ...) -> i32;
}
#[derive(Debug, PartialEq)]
pub enum Command {
    Move(f32, f32),
    Scroll(f32, f32),
    Click(u16),
    Down,
    Up,
    Release,
    Ping,
    RightDown,
    RightUp,
    Key(u16, bool),
    KeyTap(u16),
    Text(Vec<u8>),
}
pub fn decode(b: &[u8]) -> io::Result<Command> {
    let bad = || io::Error::new(io::ErrorKind::InvalidData, "Invalid input packet");
    match b {
        [kind @ (1 | 2), rest @ ..] if rest.len() == 8 => {
            let x = f32::from_le_bytes(rest[..4].try_into().unwrap());
            let y = f32::from_le_bytes(rest[4..].try_into().unwrap());
            if !x.is_finite() || !y.is_finite() || x.abs() > 2048. || y.abs() > 2048. {
                return Err(bad());
            }
            Ok(if *kind == 1 {
                Command::Move(x, y)
            } else {
                Command::Scroll(x, y)
            })
        }
        [3] => Ok(Command::Click(272)),
        [4] => Ok(Command::Click(273)),
        [5] => Ok(Command::Down),
        [6] => Ok(Command::Up),
        [7] => Ok(Command::Release),
        [8] => Ok(Command::Ping),
        [op @ (9..=11), usage] => {
            let key = crate::keys::linux_key(*usage).ok_or_else(bad)?;
            Ok(if *op == 11 {
                Command::KeyTap(key)
            } else {
                Command::Key(key, *op == 9)
            })
        }
        [12] => Ok(Command::RightDown),
        [13] => Ok(Command::RightUp),
        [14, text @ ..] if !text.is_empty() && text.len() <= 120 && text.iter().all(|b| crate::keys::ascii_key(*b).is_some()) => Ok(Command::Text(text.to_vec())),
        _ => Err(bad()),
    }
}
pub struct Pointer {
    device: Option<File>,
    keyboard: Option<File>,
    keys: BTreeSet<u16>,
    right_down: bool,
    #[cfg(test)]
    events: Vec<(bool, u16, i32)>,
    down: bool,
    remainder: [f32; 4],
    wheel: [i32; 2],
}
// Linux uinput_setup: input_id, name[80], ff_effects_max.
// Build separately so device initialization can be tested without /dev/uinput.
fn device_setup(keyboard: bool) -> [u8; 92] {
    let mut setup = [0u8; 92];
    setup[..2].copy_from_slice(&3u16.to_ne_bytes());
    setup[2..4].copy_from_slice(&0x1209u16.to_ne_bytes());
    setup[4..6].copy_from_slice(&1u16.to_ne_bytes());
    let name: &[u8] = if keyboard {
        b"Ghostpad keyboard\0"
    } else {
        b"Ghostpad trackpad\0"
    };
    if keyboard {
        setup[4..6].copy_from_slice(&2u16.to_ne_bytes());
    }
    setup[8..8 + name.len()].copy_from_slice(name);
    setup
}
fn create_device(keyboard: bool) -> io::Result<File> {
    let f = OpenOptions::new().write(true).open("/dev/uinput")?;
    let fd = f.as_raw_fd();
    let set = |request, code: i32| {
        if unsafe { ioctl(fd, request, code) } < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    };
    set(0x40045564, 1)?;
    if !keyboard {
        set(0x40045564, 2)?;
    }
    let keys: Vec<u16> = if keyboard {
        (0..=255).filter_map(crate::keys::linux_key).collect()
    } else {
        vec![272, 273]
    };
    for k in keys {
        set(0x40045565, i32::from(k))?;
    }
    for axis in if keyboard {
        &[][..]
    } else {
        &[0, 1, 6, 8, 11, 12][..]
    } {
        set(0x40045566, *axis)?;
    }
    let setup = device_setup(keyboard);
    if unsafe { ioctl(fd, 0x405c5503 as std::ffi::c_ulong, setup.as_ptr()) } < 0 {
        return Err(io::Error::last_os_error());
    }
    set(0x5501, 0)?;
    Ok(f)
}
impl Pointer {
    #[cfg(test)]
    pub fn is_down(&self) -> bool {
        self.down || self.right_down || !self.keys.is_empty()
    }
    pub fn new(preview: bool) -> io::Result<Self> {
        let device = if preview {
            None
        } else {
            Some(create_device(false)?)
        };
        let keyboard = if preview {
            None
        } else {
            Some(create_device(true)?)
        };
        Ok(Self {
            device,
            keyboard,
            keys: BTreeSet::new(),
            right_down: false,
            #[cfg(test)]
            events: Vec::new(),
            down: false,
            remainder: [0.; 4],
            wheel: [0; 2],
        })
    }
    fn emit(&mut self, events: &[(u16, u16, i32)]) -> io::Result<()> {
        #[cfg(test)]
        for &(_, code, value) in events {
            self.events.push((false, code, value));
        }
        Self::write_events(&mut self.device, events)
    }
    fn key_event(&mut self, code: u16, down: bool) -> io::Result<()> {
        #[cfg(test)]
        self.events.push((true, code, i32::from(down)));
        Self::write_events(&mut self.keyboard, &[(1, code, i32::from(down))])
    }
    fn write_events(device: &mut Option<File>, events: &[(u16, u16, i32)]) -> io::Result<()> {
        if let Some(f) = device {
            let mut bytes = Vec::with_capacity((events.len() + 1) * 24);
            for &(kind, code, value) in events.iter().chain(std::iter::once(&(0, 0, 0))) {
                bytes.extend_from_slice(&0isize.to_ne_bytes());
                bytes.extend_from_slice(&0isize.to_ne_bytes());
                bytes.extend_from_slice(&kind.to_ne_bytes());
                bytes.extend_from_slice(&code.to_ne_bytes());
                bytes.extend_from_slice(&value.to_ne_bytes());
            }
            f.write_all(&bytes)?;
        }
        Ok(())
    }
    fn whole(&mut self, axis: usize, value: f32) -> i32 {
        let total = self.remainder[axis] + value;
        let whole = total.trunc();
        self.remainder[axis] = total - whole;
        whole as i32
    }
    pub fn handle(&mut self, command: Command) -> io::Result<()> {
        match command {
            Command::Move(x, y) => {
                let x = self.whole(0, x);
                let y = self.whole(1, y);
                self.emit(&[(2, 0, x), (2, 1, y)])?;
            }
            Command::Scroll(x, y) => {
                let x = self.whole(2, x * 2.5);
                let y = self.whole(3, -y * 2.5);
                self.wheel[0] += x;
                self.wheel[1] += y;
                let a = self.wheel[0] / 120;
                let b = self.wheel[1] / 120;
                self.wheel[0] %= 120;
                self.wheel[1] %= 120;
                self.emit(&[(2, 12, x), (2, 11, y), (2, 6, a), (2, 8, b)])?;
            }
            Command::Click(button) => {
                if !(self.down || self.right_down) {
                    self.emit(&[(1, button, 1)])?;
                    self.emit(&[(1, button, 0)])?;
                }
            }
            Command::Down => {
                self.emit(&[(1, 272, 1)])?;
                self.down = true;
            }
            Command::Up => {
                self.emit(&[(1, 272, 0)])?;
                self.down = false;
            }
            Command::RightDown => {
                self.emit(&[(1, 273, 1)])?;
                self.right_down = true;
            }
            Command::RightUp => {
                self.emit(&[(1, 273, 0)])?;
                self.right_down = false;
            }
            Command::Key(code, down) => {
                if down != self.keys.contains(&code) {
                    self.key_event(code, down)?;
                    if down {
                        self.keys.insert(code);
                    } else {
                        self.keys.remove(&code);
                    }
                }
            }
            Command::KeyTap(code) => {
                if !self.keys.contains(&code) {
                    self.key_event(code, true)?;
                    self.key_event(code, false)?;
                }
            }
            Command::Text(text) => {
                if !self.keys.is_empty() { return Err(io::Error::new(io::ErrorKind::InvalidData,"Release modifiers before typing text")); }
                for byte in text {
                    let (code, shift) = crate::keys::ascii_key(byte).ok_or_else(||io::Error::other("Unsupported text"))?;
                    if shift { self.handle(Command::Key(42, true))?; }
                    self.handle(Command::KeyTap(code))?;
                    if shift { self.handle(Command::Key(42, false))?; }
                }
            }
            Command::Release => self.release()?,
            Command::Ping => {}
        }
        Ok(())
    }
    pub fn release(&mut self) -> io::Result<()> {
        if self.down {
            self.emit(&[(1, 272, 0)])?;
        }
        if self.right_down {
            self.emit(&[(1, 273, 0)])?;
        }
        for code in self.keys.clone() {
            self.key_event(code, false)?;
            self.keys.remove(&code);
        }
        self.right_down = false;
        self.down = false;
        self.remainder = [0.; 4];
        self.wheel = [0; 2];
        Ok(())
    }
}
impl Drop for Pointer {
    fn drop(&mut self) {
        let _ = self.release();
        for f in [&self.device, &self.keyboard].into_iter().flatten() {
            unsafe {
                ioctl(f.as_raw_fd(), 0x5502 as std::ffi::c_ulong, 0);
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn device_setup_has_valid_linux_layout_and_terminated_name() {
        let setup = device_setup(false);
        assert_eq!(setup.len(), 92);
        assert_eq!(u16::from_ne_bytes(setup[..2].try_into().unwrap()), 3);
        assert_eq!(u16::from_ne_bytes(setup[2..4].try_into().unwrap()), 0x1209);
        assert_eq!(u16::from_ne_bytes(setup[4..6].try_into().unwrap()), 1);
        let name = &setup[8..88];
        let end = name.iter().position(|&byte| byte == 0).unwrap();
        assert_eq!(&name[..end], b"Ghostpad trackpad");
        assert!(name[end..].iter().all(|&byte| byte == 0));
        assert_eq!(&setup[88..], &[0; 4]);
    }
    #[test]
    fn keyboard_device_name_fits_and_is_terminated() {
        let setup = device_setup(true);
        assert_eq!(&setup[8..26], b"Ghostpad keyboard\0");
        assert!(setup[26..88].iter().all(|b| *b == 0));
        assert_eq!(u16::from_ne_bytes(setup[4..6].try_into().unwrap()), 2);
    }
    #[test]
    fn super_resize_and_release_order() {
        let mut p = Pointer::new(true).unwrap();
        for packet in [&[9, 227][..], &[12], &[1, 0, 0, 32, 65, 0, 0, 0, 0], &[7]] {
            p.handle(decode(packet).unwrap()).unwrap();
        }
        assert_eq!(p.events.first(), Some(&(true, 125, 1)));
        assert_eq!(p.events[1], (false, 273, 1));
        assert_eq!(
            &p.events[p.events.len() - 2..],
            &[(false, 273, 0), (true, 125, 0)]
        );
        assert!(p.keys.is_empty());
        assert!(!p.right_down);
    }
    #[test]
    fn keyboard_taps_preserve_held_modifiers_and_deduplicate_down() {
        let mut p = Pointer::new(true).unwrap();
        for packet in [[9, 224], [9, 224], [11, 6], [10, 224]] {
            p.handle(decode(&packet).unwrap()).unwrap();
        }
        assert_eq!(
            p.events,
            vec![(true, 29, 1), (true, 46, 1), (true, 46, 0), (true, 29, 0)]
        );
        assert!(decode(&[9, 255]).is_err());
        assert!(decode(&[11, 0]).is_err());
    }
    #[test]
    fn rejects_bad_packets() {
        for b in [
            vec![],
            vec![9],
            vec![3, 0],
            vec![1],
            [
                vec![1],
                f32::NAN.to_le_bytes().to_vec(),
                0f32.to_le_bytes().to_vec(),
            ]
            .concat(),
        ] {
            assert!(decode(&b).is_err());
        }
    }
    #[test]
    fn preserves_fractional_motion() {
        let mut p = Pointer::new(true).unwrap();
        assert_eq!(p.whole(0, 0.4), 0);
        assert_eq!(p.whole(0, 0.4), 0);
        assert_eq!(p.whole(0, 0.4), 1);
    }
    #[test]
    fn release_clears_state() {
        let mut p = Pointer::new(true).unwrap();
        p.handle(Command::Down).unwrap();
        p.release().unwrap();
        assert!(!p.down);
    }
}
