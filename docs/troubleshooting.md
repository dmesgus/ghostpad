# Troubleshooting

Start with `ghostpad-doctor` (or `make doctor` from source). It checks local prerequisites without reading saved credentials, changing settings, or generating input. Its interface listing contains local IP addresses; redact those if desired before sharing. A nonzero exit status means a required local check failed.

## The phone page never opens

On the phone, open the `/health` address shown by Ghostpad. It should display `ghostpad/1`. Test that same address on the computer.

If it works only on the computer:

1. Keep both devices on the same Wi-Fi. Guest, hotel, campus, and some hotspot networks isolate clients even when the Wi-Fi name matches.
2. Use the **computer's LAN IPv4 address** shown by Ghostpad. When Wi-Fi and Ethernet or USB tethering share a subnet, Ghostpad can select the adapter Linux prefers. The desktop page refreshes after an address change in automatic HTTP mode. To pin the receiver to an address, run `ghostpad --desktop --address 192.168.1.42`.
3. Check the firewall. The desktop help shows the command for your current private subnet when you use UFW. To allow just one phone, use `ghostpad-allow-phone PHONE_WIFI_IPV4 --dry-run`, inspect the command, then rerun without `--dry-run`.
4. Find the **phone's** IPv4 address in its Wi-Fi settings. A rule for an old phone or address does not allow a new one.

The helper refuses public/routed targets. It does not support firewalld or nftables directly. For those firewalls, create an equivalent inbound rule limited to the phone, private interface, and Ghostpad TCP port. Never disable the entire firewall to troubleshoot Ghostpad.

To deliberately allow all devices on your computer's current private LAN subnet with UFW:

```sh
ghostpad-allow-phone --lan COMPUTER_LAN_IPV4 --dry-run
ghostpad-allow-phone --lan COMPUTER_LAN_IPV4
```

Use the computer's IP address from the pairing page for `--lan`. The rule is scoped to the interface, subnet, and Ghostpad TCP port, and survives address changes within that subnet. Devices still need the pairing key to control input. Use it on trusted networks and update the rule for a different subnet or interface. Add `--port PORT` for a custom receiver port.

Ghostpad accepts private IPv4 addresses and loopback only. `127.0.0.1` is for tests on the computer and cannot be opened from the phone. A private bind address does not make an untrusted network safe or prevent router port forwarding. VPN-only, public-address, IPv6-only, and routed discovery setups are outside this release's supported path.

If `/health` also fails on the computer, check the process, address, port, and HTTP/HTTPS scheme. To get connection diagnostics, stop the receiver and restart with `ghostpad --verbose`. Terminal pairing output contains a private key; share only redacted diagnostics. No incoming connection log usually means the request never reached the receiver.

## The page opens but will not pair

Use the complete QR/link including its `#key=…` fragment. Open it in Safari on iPhone or Chrome on Android. A manually typed address without the fragment cannot pair a new browser. Refresh the phone after installing a receiver update.

If the key was rotated, scan the new QR. If Ghostpad says it is busy, tap **Use this phone** to transfer control. The receiver requires the exact IP origin or the hostname configured with `--hostname`.

After an IP change, scan the refreshed QR if your phone was using an IP link. Restart receivers pinned with `--address` or using TLS if their IP binding changes. Browser storage belongs to an origin, so changing the address, port, or HTTP/HTTPS scheme can require pairing again. A working `.local` hostname or a router DHCP reservation can keep the browser address stable.

## No QR code

Install `qrencode` on the computer, then restart the receiver and reopen Ghostpad. An unavailable QR result is cached for that process. **Copy pairing link** still works without QR generation. Some browsers restrict clipboard access over LAN HTTP, so Ghostpad also offers a selectable link.

## Phone says connected, but the cursor does not move

Check for **Preview** on the phone or computer. Preview intentionally disables native input; stop it and start without `--preview` to control the computer.

If the receiver cannot create Linux input devices, run `ghostpad-setup --persistent` or use temporary `ghostpad-setup`. Run the receiver as your normal desktop user. If persistent setup does not apply immediately, log out and back in, then run diagnostics. Session/udev support is required for persistent `uaccess`; use the temporary ACL path otherwise.

Pinch behavior depends on native touchpad gesture support in the desktop/application. Super+drag window actions depend on your existing window manager bindings. Ghostpad does not install those bindings.

## Wrong typed characters

Set the computer's keyboard layout to US and turn Caps Lock off. Non-ASCII text and emoji are unsupported. Check the focused computer window. Use the key grid for shortcuts and keep the phone page foregrounded.

## HTTPS will not connect

The phone must trust the certificate issuer, and the certificate's subject alternative name must include the exact LAN IP shown by Ghostpad. HTTP links cannot access an HTTPS receiver. An untrusted self-signed certificate is not a seamless Safari pairing solution. See [HTTPS setup](../SECURITY.md#https).

## An update appears unchanged, or the port is already used

Stop Ghostpad in the desktop page or original terminal, reinstall, reopen it, then refresh the phone. Replacing the executable does not restart an old process. A second normal HTTP launch reuses the existing receiver, so new flags and assets do not take effect until it exits. Changing flags, rotating the key, or using TLS requires stopping the old receiver first.

If another application owns the port, identify it before stopping anything, or choose `--port 8766` and update the firewall rule. Do not kill an unknown process.

## Reporting a bug

Include Ghostpad version (`ghostpad --version`), Linux distribution/compositor, phone OS/browser versions, what you did, what you expected, and whether `/health` works on each device. Do not post pairing URLs, QR codes, private keys, or journal output containing credentials. Report vulnerabilities [privately](../SECURITY.md#report-a-vulnerability).
