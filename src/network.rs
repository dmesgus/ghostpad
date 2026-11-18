use std::{
    fs::File,
    io::{self, Read},
    net::{Ipv4Addr, TcpListener, UdpSocket},
    os::fd::{AsRawFd, FromRawFd},
    process::Command,
};

// Linux rtnetlink notifications let the listener sleep until a LAN address or
// route changes. The same blocking poll also waits for incoming connections.
#[repr(C)]
struct NetlinkAddress {
    family: u16,
    pad: u16,
    pid: u32,
    groups: u32,
}

#[repr(C)]
struct PollFd {
    fd: i32,
    events: i16,
    revents: i16,
}

unsafe extern "C" {
    fn socket(domain: i32, kind: i32, protocol: i32) -> i32;
    fn bind(fd: i32, address: *const NetlinkAddress, len: u32) -> i32;
    fn poll(descriptors: *mut PollFd, count: std::ffi::c_ulong, timeout: i32) -> i32;
}

pub struct Monitor(File);
impl Monitor {
    pub fn new() -> io::Result<Self> {
        const AF_NETLINK: u16 = 16;
        const SOCK_RAW: i32 = 3;
        const SOCK_NONBLOCK: i32 = 0o4000;
        const SOCK_CLOEXEC: i32 = 0o2000000;
        const NETLINK_ROUTE: i32 = 0;
        const IPV4_ADDRESS_AND_ROUTE: u32 = 0x10 | 0x40;
        let fd = unsafe {
            socket(
                AF_NETLINK.into(),
                SOCK_RAW | SOCK_NONBLOCK | SOCK_CLOEXEC,
                NETLINK_ROUTE,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let file = unsafe { File::from_raw_fd(fd) };
        let address = NetlinkAddress {
            family: AF_NETLINK,
            pad: 0,
            pid: 0,
            groups: IPV4_ADDRESS_AND_ROUTE,
        };
        if unsafe { bind(fd, &address, size_of::<NetlinkAddress>() as u32) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(file))
    }

    pub fn wait(
        &mut self,
        desktop: &TcpListener,
        lan: Option<&TcpListener>,
    ) -> io::Result<[bool; 3]> {
        const POLLIN: i16 = 1;
        let mut fds = [
            self.0.as_raw_fd(),
            desktop.as_raw_fd(),
            lan.map_or(-1, AsRawFd::as_raw_fd),
        ]
        .map(|fd| PollFd {
            fd,
            events: POLLIN,
            revents: 0,
        });
        loop {
            if unsafe { poll(fds.as_mut_ptr(), fds.len() as _, -1) } >= 0 {
                break;
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
        if fds[0].revents != 0 {
            let mut events = [0; 4096];
            // Only the notification matters. Drain a burst before resampling
            // the routing state, then return to accepting clients.
            for _ in 0..32 {
                match self.0.read(&mut events) {
                    Ok(0) => return Err(io::Error::other("Network monitor closed")),
                    Ok(_) => {}
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                    Err(error) if error.raw_os_error() == Some(105) => continue, // Linux ENOBUFS
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(error) => return Err(error),
                }
            }
        }
        Ok(fds.map(|fd| fd.revents != 0))
    }
}

pub fn validate(ip: Ipv4Addr) -> io::Result<()> {
    if ip.is_private() || ip.is_loopback() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Use a private Wi-Fi/LAN IPv4 address (10.x, 172.16–31.x, 192.168.x), or loopback for local testing. Public and wildcard binding are disabled.",
        ))
    }
}

pub fn local_hostname(value: &str) -> io::Result<String> {
    let value = value.to_ascii_lowercase();
    if let Some(name) = value.strip_suffix(".local") {
        let first = name.as_bytes().first();
        let last = name.as_bytes().last();
        if name.len() <= 63
            && first.is_some_and(u8::is_ascii_alphanumeric)
            && last.is_some_and(u8::is_ascii_alphanumeric)
            && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Ok(value);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "Use a hostname already advertised on your LAN, such as computer.local.",
    ))
}

struct InterfaceAddress {
    name: String,
    ip: Ipv4Addr,
    prefix: u32,
}

impl InterfaceAddress {
    fn contains(&self, ip: Ipv4Addr) -> bool {
        let mask = u32::MAX.checked_shl(32 - self.prefix).unwrap_or(0);
        self.ip.to_bits() & mask == ip.to_bits() & mask
    }
}

fn candidates(output: &str) -> Vec<InterfaceAddress> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            let name = fields.get(1)?.split('@').next()?;
            let index = fields.iter().position(|s| *s == "inet")?;
            let (ip, prefix) = fields.get(index + 1)?.split_once('/')?;
            let ip: Ipv4Addr = ip.parse().ok()?;
            let prefix = prefix.parse().ok()?;
            let physical = name.starts_with("wl")
                || name.starts_with("en")
                || name.starts_with("eth")
                || std::path::Path::new("/sys/class/net")
                    .join(name)
                    .join("device")
                    .exists();
            if physical && ip.is_private() && prefix <= 32 {
                Some(InterfaceAddress {
                    name: name.to_string(),
                    ip,
                    prefix,
                })
            } else {
                None
            }
        })
        .collect()
}
fn choose(entries: &[InterfaceAddress], route: Option<Ipv4Addr>) -> io::Result<Ipv4Addr> {
    let wireless: Vec<_> = entries
        .iter()
        .filter(|entry| {
            entry.name.starts_with("wl")
                || std::path::Path::new("/sys/class/net")
                    .join(&entry.name)
                    .join("wireless")
                    .exists()
        })
        .collect();
    let choices: Vec<_> = if wireless.is_empty() {
        entries.iter().collect()
    } else {
        wireless
    };
    // Two adapters on the same LAN can receive on one interface and send replies
    // through the other. Advertise the address Linux prefers for that LAN.
    if let Some(routed) = entries.iter().find(|entry| Some(entry.ip) == route) {
        if choices.iter().any(|entry| {
            entry.ip == routed.ip || (entry.contains(routed.ip) && routed.contains(entry.ip))
        }) {
            return Ok(routed.ip);
        }
    }
    if choices.len() == 1 {
        return Ok(choices[0].ip);
    }
    Err(io::Error::other(
        "Cannot choose a Wi-Fi/LAN address. Run `ip -4 -brief address` and pass your computer's Wi-Fi address with --address IP.",
    ))
}
pub fn address() -> io::Result<Ipv4Addr> {
    let output = Command::new("ip")
        .args(["-o", "-4", "addr", "show", "up", "scope", "global"])
        .output()?;
    if !output.status.success() {
        return Err(io::Error::other(
            "Cannot list LAN interfaces. Specify --address with your Wi-Fi IPv4 address.",
        ));
    }
    let entries = candidates(&String::from_utf8_lossy(&output.stdout));
    let route = UdpSocket::bind("0.0.0.0:0").ok().and_then(|s| {
        s.connect("192.0.2.1:9").ok()?;
        match s.local_addr().ok()?.ip() {
            std::net::IpAddr::V4(ip) => Some(ip),
            _ => None,
        }
    });
    choose(&entries, route)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prefers_the_routed_adapter_when_wifi_and_ethernet_share_a_lan() {
        let entries =
            candidates("2: wlp1s0 inet 172.20.10.4/28\n3: enp0s20f0u5c4i2 inet 172.20.10.6/28");
        let ethernet = "172.20.10.6".parse().unwrap();
        assert_eq!(choose(&entries, Some(ethernet)).unwrap(), ethernet);
    }
    #[test]
    fn prefers_wifi_when_ethernet_uses_another_lan() {
        let entries =
            candidates("2: wlp1s0 inet 172.20.10.4/28\n3: enp0s20f0u5c4i2 inet 172.20.10.22/28");
        assert_eq!(
            choose(&entries, Some("172.20.10.22".parse().unwrap())).unwrap(),
            "172.20.10.4".parse::<Ipv4Addr>().unwrap()
        );
    }
    #[test]
    fn binding_stays_on_private_networks_or_loopback() {
        for value in [
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.254",
            "192.168.1.1",
            "127.0.0.1",
        ] {
            assert!(validate(value.parse().unwrap()).is_ok());
        }
        for value in [
            "0.0.0.0",
            "8.8.8.8",
            "172.32.0.1",
            "169.254.1.1",
            "224.0.0.1",
            "255.255.255.255",
        ] {
            assert!(validate(value.parse().unwrap()).is_err());
        }
    }
    #[test]
    fn wifi_wins_over_vpn_and_docker_default_route() {
        let entries = candidates(
            "2: docker0 inet 172.17.0.1/16 scope global docker0\n3: tun0 inet 10.8.0.2/24 scope global tun0\n4: enp1s0 inet 192.168.2.2/24 scope global enp1s0\n5: wlan0 inet 192.168.1.42/24 scope global wlan0",
        );
        assert_eq!(
            choose(&entries, Some("10.8.0.2".parse().unwrap())).unwrap(),
            "192.168.1.42".parse::<Ipv4Addr>().unwrap()
        );
    }
    #[test]
    fn absent_or_ambiguous_lan_requires_explicit_address() {
        assert!(choose(&[], None).is_err());
        assert!(
            choose(
                &candidates("2: wlan0 inet 192.168.1.42/24\n3: wlan1 inet 192.168.2.42/24"),
                None
            )
            .is_err()
        );
    }
}
