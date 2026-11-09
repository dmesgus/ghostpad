//! A separate type-B multitouch device for native libinput/browser pinch gestures.
//! Pointer motion, scrolling and clicks still use the relative pointer device.
use std::{
    fs::{File, OpenOptions},
    io,
    os::fd::AsRawFd,
};

unsafe extern "C" {
    fn ioctl(fd: i32, request: std::ffi::c_ulong, ...) -> i32;
}
const EV_KEY: u16 = 1;
const EV_ABS: u16 = 3;
const BTN_TOUCH: u16 = 330;
const BTN_TOOL_DOUBLETAP: u16 = 333;
const SLOT: u16 = 47;
const X: u16 = 53;
const Y: u16 = 54;
const TRACKING_ID: u16 = 57;
const INITIAL_DISTANCE: f32 = 2000.;
type Event = (u16, u16, i32);

// UI_ABS_SETUP: u16 code, two bytes padding, then Linux input_absinfo.
fn abs_setup(code: u16, maximum: i32, resolution: i32) -> [u8; 28] {
    let mut bytes = [0; 28];
    bytes[..2].copy_from_slice(&code.to_ne_bytes());
    bytes[12..16].copy_from_slice(&maximum.to_ne_bytes());
    bytes[24..28].copy_from_slice(&resolution.to_ne_bytes());
    bytes
}
fn create_device() -> io::Result<File> {
    let file = OpenOptions::new().write(true).open("/dev/uinput")?;
    let fd = file.as_raw_fd();
    let set = |request, value: i32| {
        if unsafe { ioctl(fd, request, value) } < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    };
    set(0x40045564, i32::from(EV_KEY))?; // UI_SET_EVBIT
    set(0x40045564, i32::from(EV_ABS))?;
    set(0x4004556e, 0)?; // UI_SET_PROPBIT: INPUT_PROP_POINTER, not DIRECT or SEMI_MT
    for key in [272, 273, 325, BTN_TOUCH, BTN_TOOL_DOUBLETAP] {
        set(0x40045565, i32::from(key))?;
    }
    // Physical dimensions 160 x 100 mm, two fully tracked contacts.
    for (code, maximum, resolution) in [
        (0, 16000, 100),
        (1, 10000, 100),
        (SLOT, 1, 0),
        (X, 16000, 100),
        (Y, 10000, 100),
        (TRACKING_ID, 65535, 0),
    ] {
        set(0x40045567, i32::from(code))?; // UI_SET_ABSBIT
        let setup = abs_setup(code, maximum, resolution);
        if unsafe { ioctl(fd, 0x401c5504 as std::ffi::c_ulong, setup.as_ptr()) } < 0 {
            return Err(io::Error::last_os_error());
        }
    }
    let mut setup = [0u8; 92];
    setup[..2].copy_from_slice(&3u16.to_ne_bytes()); // BUS_USB
    setup[2..4].copy_from_slice(&0x1209u16.to_ne_bytes());
    setup[4..6].copy_from_slice(&3u16.to_ne_bytes());
    setup[6..8].copy_from_slice(&1u16.to_ne_bytes());
    let name = b"Ghostpad gestures\0";
    setup[8..8 + name.len()].copy_from_slice(name);
    if unsafe { ioctl(fd, 0x405c5503 as std::ffi::c_ulong, setup.as_ptr()) } < 0 {
        return Err(io::Error::last_os_error());
    }
    set(0x5501, 0)?; // UI_DEV_CREATE
    Ok(file)
}

pub struct Touchpad {
    device: Option<File>,
    active: bool,
    next_id: u16,
    #[cfg(test)]
    frames: Vec<Vec<Event>>,
}
impl Touchpad {
    pub fn new(preview: bool) -> io::Result<Self> {
        Ok(Self {
            device: if preview {
                None
            } else {
                Some(create_device()?)
            },
            active: false,
            next_id: 0,
            #[cfg(test)]
            frames: Vec::new(),
        })
    }
    #[cfg(test)]
    pub fn is_active(&self) -> bool {
        self.active
    }
    fn emit(&mut self, events: &[Event]) -> io::Result<()> {
        #[cfg(test)]
        self.frames.push(events.to_vec());
        crate::input::Pointer::write_events(&mut self.device, events)
    }
    fn positions(scale: f32) -> [Event; 8] {
        let half = (INITIAL_DISTANCE * scale / 2.).round() as i32;
        [
            (EV_ABS, SLOT, 0),
            (EV_ABS, X, 8000 - half),
            (EV_ABS, Y, 5000),
            (EV_ABS, SLOT, 1),
            (EV_ABS, X, 8000 + half),
            (EV_ABS, Y, 5000),
            (EV_ABS, 0, 8000 - half),
            (EV_ABS, 1, 5000),
        ]
    }
    pub fn update(&mut self, scale: f32) -> io::Result<()> {
        if !scale.is_finite() || !(0.1..=6.).contains(&scale) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid pinch scale",
            ));
        }
        if !self.active {
            // Establish a neutral pair before moving it. No Ctrl or wheel events.
            let first = self.next_id;
            self.next_id = self.next_id.wrapping_add(2);
            let begin = [
                (EV_KEY, BTN_TOUCH, 1),
                (EV_KEY, BTN_TOOL_DOUBLETAP, 1),
                (EV_ABS, SLOT, 0),
                (EV_ABS, TRACKING_ID, i32::from(first)),
                (EV_ABS, X, 7000),
                (EV_ABS, Y, 5000),
                (EV_ABS, SLOT, 1),
                (EV_ABS, TRACKING_ID, i32::from(first.wrapping_add(1))),
                (EV_ABS, X, 9000),
                (EV_ABS, Y, 5000),
                (EV_ABS, 0, 7000),
                (EV_ABS, 1, 5000),
            ];
            self.active = true; // release can recover even if the device write fails
            self.emit(&begin)?;
        }
        self.emit(&Self::positions(scale))
    }
    pub fn release(&mut self) -> io::Result<()> {
        if self.active {
            self.emit(&[
                (EV_KEY, BTN_TOUCH, 0),
                (EV_KEY, BTN_TOOL_DOUBLETAP, 0),
                (EV_ABS, SLOT, 0),
                (EV_ABS, TRACKING_ID, -1),
                (EV_ABS, SLOT, 1),
                (EV_ABS, TRACKING_ID, -1),
            ])?;
            self.active = false;
        }
        Ok(())
    }
}
impl Drop for Touchpad {
    fn drop(&mut self) {
        let _ = self.release();
        if let Some(file) = &self.device {
            unsafe {
                ioctl(file.as_raw_fd(), 0x5502 as std::ffi::c_ulong, 0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absolute_axis_layout_has_physical_resolution() {
        let bytes = abs_setup(X, 16000, 100);
        assert_eq!(u16::from_ne_bytes(bytes[..2].try_into().unwrap()), X);
        let values: [i32; 6] = std::array::from_fn(|i| {
            i32::from_ne_bytes(bytes[4 + i * 4..8 + i * 4].try_into().unwrap())
        });
        assert_eq!(values, [0, 0, 16000, 0, 0, 100]);
    }
    #[test]
    fn pinch_tracks_two_contacts_continuously_and_releases_both() {
        let mut pad = Touchpad::new(true).unwrap();
        pad.update(1.2).unwrap();
        pad.update(1.5).unwrap();
        pad.update(0.8).unwrap();
        pad.release().unwrap();
        pad.release().unwrap();
        assert_eq!(pad.frames.len(), 5);
        let begins: Vec<_> = pad.frames[0]
            .iter()
            .filter(|e| e.1 == TRACKING_ID)
            .collect();
        assert_eq!(begins.len(), 2);
        assert_ne!(begins[0].2, begins[1].2);
        for (frame, distance) in pad.frames[1..4].iter().zip([2400, 3000, 1600]) {
            let x: Vec<_> = frame.iter().filter(|e| e.1 == X).map(|e| e.2).collect();
            assert_eq!(x[1] - x[0], distance);
            assert_eq!(x[0] + x[1], 16000);
            assert!(frame.iter().all(|e| e.0 == EV_ABS));
        }
        assert_eq!(
            pad.frames[4]
                .iter()
                .filter(|e| e.1 == TRACKING_ID && e.2 == -1)
                .count(),
            2
        );
        assert!(!pad.is_active());
        pad.update(1.1).unwrap();
        assert!(pad.frames[5].contains(&(EV_ABS, TRACKING_ID, 2)));
    }
    #[test]
    fn invalid_scale_never_creates_contacts() {
        let mut pad = Touchpad::new(true).unwrap();
        for scale in [f32::NAN, f32::INFINITY, 0., -1., 0.09, 6.1] {
            assert!(pad.update(scale).is_err());
        }
        assert!(pad.frames.is_empty());
        for scale in [0.1, 6.] {
            pad.update(scale).unwrap();
        }
        for frame in &pad.frames {
            assert!(
                frame
                    .iter()
                    .filter(|e| e.1 == X)
                    .all(|e| (0..=16000).contains(&e.2))
            );
        }
    }
}
