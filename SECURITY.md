# Security

Ghostpad gives a paired browser mouse and keyboard control of your Linux desktop. Treat its pairing QR/link like a password for your computer. This is an early project with a narrow custom HTTP/WebSocket implementation; it has not received an independent security audit.

## Supported versions

Security fixes target the latest published 0.3.x release and current `main`. Older snapshots are not maintained. Until the first public release exists, use current `main` and review its limitations below.

## Trust model

The intended environment is your own Linux desktop and phone on a trusted private Wi-Fi network. The computer's user account, phone/browser, router, and other local software are trusted. Ghostpad is not an internet remote-desktop service and is not designed for hostile networks or untrusted shared computers.

**HTTP is the default and provides no transport encryption or server authentication.** A network attacker able to read or modify traffic can steal the bearer credential, substitute the served application, and control the computer. Host/Origin validation and a URL fragment do not prevent this. A private IP address is not proof of a trusted network. Use trusted HTTPS when you need protection against network interception; do not use unencrypted Ghostpad on public/guest Wi-Fi.

Never forward the port, expose it through a public tunnel, or configure a reverse proxy to publish it. The receiver accepts private RFC 1918 IPv4 or loopback addresses and binds to the selected address only. It rejects public, multicast, link-local, and wildcard binding. Router forwarding can still expose a privately bound service, so this guard is not an internet firewall. IPv6 and public/VPN-only address setups are outside the supported path.

## Pairing credentials

- The receiver generates 32 random bytes from the operating system and saves their 64-character hex representation at `$XDG_CONFIG_HOME/ghostpad/pairing-key`, normally `~/.config/ghostpad/pairing-key`.
- The directory is owned by the receiver user with mode 700; new keys have mode 600. Loading rejects directory/file symlinks, wrong ownership, shared permissions, extra hard links, wrong length, and malformed values. Key reads are bounded. Rotation writes/syncs a replacement before atomically replacing the old file.
- The QR carries the credential in `#key=…`. URL fragments are not sent in HTTP request targets. The browser removes the fragment from its current address and retains the phone's credential in local storage when available. The desktop uses tab-local session storage.
- The phone authenticates in the first WebSocket message. The desktop's QR/status APIs require a bearer Authorization header; stopping also requires an exact same-origin POST. Public HTML/assets do not contain the pairing secret.
- The credential is shared across all paired browsers. Only one authenticated phone holds input control at a time. There is no per-device approval, expiry, identity, or individual revocation yet. Anyone possessing the key can connect, see the pairing QR/status, or stop the receiver.

To revoke **all** old copies, stop the receiver, restart with `ghostpad --desktop --rotate-key`, and rescan on each wanted phone. A second launch cannot rotate the credential of a receiver that still owns that port. **Forget pairing** clears the current browser's copy only. Clear browser site storage if you no longer trust that device.

Do not share pairing screenshots, terminal pairing output, browser storage, QR codes, copied links, certificate private keys, or saved key files. Browser-launch URLs can briefly appear in local process arguments, browser history/sync, extensions, and desktop opener logs. Removing the fragment from the current address does not guarantee removal from every such system. Local processes running as your user are outside Ghostpad's security boundary.

## HTTPS

Provide a certificate whose issuer is trusted by the phone and whose subject alternative name includes the exact LAN IPv4 address. For example, after obtaining and trusting that certificate:

```sh
ghostpad --desktop --address 192.168.1.42 \
  --cert /path/to/certificate.pem --key /path/to/private-key.pem
```

Ghostpad uses system OpenSSL and TLS 1.2 or newer; phone traffic then uses HTTPS/WSS. Keep the certificate private key readable only by its intended owner. Certificate issuance, renewal, local CA setup, and phone trust installation are not automated. An untrusted self-signed certificate is not seamless Safari pairing. Use the HTTPS pairing link; there is no automatic HTTP upgrade, insecure certificate bypass, or HTTP fallback on that listener.

Install operating-system/OpenSSL updates. Prebuilt receivers dynamically link system OpenSSL; keeping the Rust executable unchanged does not keep its TLS library patched. HTTPS protects transport, not a compromised phone/browser or local account.

## Input permissions and fail-safe behavior

Run the receiver as your normal desktop user. Real input mode refuses root. Setup uses sudo only to load `uinput`, grant a user ACL, or install the explicit `uaccess` rule/module configuration. It does not put all users into an input group or make `/dev/uinput` world-writable. This permission allows other processes running as the permitted user to create virtual input devices too; it is not restricted to Ghostpad.

The receiver validates Host and WebSocket Origin against its configured address, rejects duplicate headers and malformed frames, bounds headers (8 KiB), WebSocket payloads (125 bytes), concurrent connection workers (16), and input rate (300 frames/second), and validates input values. Responses use a restrictive CSP, no-store caching, MIME protection, and no-referrer policy. These limit some misuse; they do not guarantee availability against a LAN attacker. Unauthenticated peers can still reach the service, consume bounded worker slots, or interfere with networking.

Disconnects, invalid input, cancellations, and read-deadline failures release held buttons, keys, and pinch contacts. A silent connection failure can take about five seconds to expire. Process exit removes the virtual devices. Preview mode disables native input, but still creates a real network service and uses a real saved credential; it needs the same network precautions.

## Data and diagnostics

Ghostpad has no application telemetry, accounts, analytics, external browser assets, clipboard synchronization, or cloud backend. Input goes directly to the receiver; it is not intentionally recorded. Browser and operating-system behavior (including extensions, history/sync, clipboard managers, and system journals) is outside this claim.

Terminal pairing mode deliberately prints its credential/QR. Use `--desktop` for browser pairing, or `--no-pairing-output` for a service that must keep it out of stdout/journals. The optional service template uses that flag. Verbose logs include peer IP addresses and connection/protocol diagnostics, not input contents or pairing values. A keyboard-layout logger is disabled unless explicitly started with `--keyboard-debug`; its accepted samples are bounded numeric geometry, not text/key contents. `ghostpad-doctor` does not read pairing files or change system settings.

## Report a vulnerability

Use [GitHub's private vulnerability report](https://github.com/dmesgus/ghostpad/security/advisories/new). The maintainer must enable private vulnerability reporting for the public repository before this channel is available. Do not post exploit details or credentials in a public issue. If the private form is unavailable, open an issue asking the maintainer to enable private reporting without including sensitive details.

Include affected version/commit, prerequisites, reproduction steps, impact, and a proposed fix if you have one. Use disposable credentials and preview mode wherever possible. This project has no guaranteed response-time SLA. General connection/setup problems belong in ordinary bug reports with secrets removed.
