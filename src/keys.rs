//! USB HID keyboard usages on the wire, translated only at the Linux boundary.
pub fn linux_key(usage: u8) -> Option<u16> {
    const LETTERS: [u16; 26] = [
        30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50, 49, 24, 25, 16, 19, 31, 20, 22, 47, 17,
        45, 21, 44,
    ];
    match usage {
        4..=29 => Some(LETTERS[(usage - 4) as usize]),
        30..=38 => Some(u16::from(usage - 28)),
        39 => Some(11),
        40 => Some(28),
        41 => Some(1),
        42 => Some(14),
        43 => Some(15),
        44 => Some(57),
        45 => Some(12),
        46 => Some(13),
        47 => Some(26),
        48 => Some(27),
        49 => Some(43),
        51 => Some(39),
        52 => Some(40),
        53 => Some(41),
        54 => Some(51),
        55 => Some(52),
        56 => Some(53),
        58..=67 => Some(u16::from(usage + 1)),
        68 => Some(87),
        69 => Some(88),
        74 => Some(102),
        75 => Some(104),
        76 => Some(111),
        77 => Some(107),
        78 => Some(109),
        79 => Some(106),
        80 => Some(105),
        81 => Some(108),
        82 => Some(103),
        224 => Some(29),
        225 => Some(42),
        226 => Some(56),
        227 => Some(125),
        _ => None,
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn physical_keys_and_modifiers() {
        assert_eq!(super::linux_key(227), Some(125));
        assert_eq!(super::linux_key(4), Some(30));
        assert_eq!(super::linux_key(40), Some(28));
        assert_eq!(super::linux_key(82), Some(103));
        assert_eq!(super::linux_key(0), None);
        assert_eq!(super::linux_key(255), None);
    }
}

/// US-layout text mapping. Return physical Linux key plus whether Shift is required.
pub fn ascii_key(byte: u8) -> Option<(u16, bool)> {
    let (usage, shift) = match byte {
        b'a'..=b'z' => (byte - b'a' + 4, false),
        b'A'..=b'Z' => (byte - b'A' + 4, true),
        b'1'..=b'9' => (byte - b'1' + 30, false),
        b'0' => (39, false),
        b'\n' => (40, false),
        b'\t' => (43, false),
        b' ' => (44, false),
        _ => {
            let plain = b"-=[]\\;'`,./";
            let shifted = b"_+{}|:\"~<>?";
            let usages = [45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56];
            if let Some(i) = plain.iter().position(|b| *b == byte) {
                (usages[i], false)
            } else if let Some(i) = shifted.iter().position(|b| *b == byte) {
                (usages[i], true)
            } else {
                let i = b"!@#$%^&*()".iter().position(|b| *b == byte)?;
                (if i == 9 { 39 } else { 30 + i as u8 }, true)
            }
        }
    };
    linux_key(usage).map(|key| (key, shift))
}

#[cfg(test)]
mod text_tests {
    #[test]
    fn entire_printable_ascii_is_mapped() {
        for byte in 32..=126 {
            assert!(super::ascii_key(byte).is_some(), "{byte}");
        }
        assert_eq!(super::ascii_key(b'?'), Some((53, true)));
        assert_eq!(super::ascii_key(b'0'), Some((11, false)));
        assert_eq!(super::ascii_key(b')'), Some((11, true)));
        assert_eq!(super::ascii_key(b'\n'), Some((28, false)));
        assert!(super::ascii_key(127).is_none());
    }
}
