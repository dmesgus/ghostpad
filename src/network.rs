use std::{
    io,
    net::{Ipv4Addr, UdpSocket},
    process::Command,
};

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

fn candidates(output: &str) -> Vec<(String, Ipv4Addr)> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            let name = fields.get(1)?.split('@').next()?;
            let index = fields.iter().position(|s| *s == "inet")?;
            let ip: Ipv4Addr = fields.get(index + 1)?.split('/').next()?.parse().ok()?;
            let physical = name.starts_with("wl")
                || name.starts_with("en")
                || name.starts_with("eth")
                || std::path::Path::new("/sys/class/net")
                    .join(name)
                    .join("device")
                    .exists();
            if physical && ip.is_private() {
                Some((name.to_string(), ip))
            } else {
                None
            }
        })
        .collect()
}
fn choose(entries: &[(String, Ipv4Addr)], route: Option<Ipv4Addr>) -> io::Result<Ipv4Addr> {
    let wireless: Vec<_> = entries
        .iter()
        .filter(|(name, _)| {
            name.starts_with("wl")
                || std::path::Path::new("/sys/class/net")
                    .join(name)
                    .join("wireless")
                    .exists()
        })
        .collect();
    let choices: Vec<_> = if wireless.is_empty() {
        entries.iter().collect()
    } else {
        wireless
    };
    if choices.len() == 1 {
        return Ok(choices[0].1);
    }
    if let Some(ip) = route.filter(|ip| choices.iter().any(|(_, candidate)| candidate == ip)) {
        return Ok(ip);
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
