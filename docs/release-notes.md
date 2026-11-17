Ghostpad turns a phone browser into a wireless trackpad and keyboard for Linux. This is an early public preview.

Download the archive matching your architecture and its `.sha256` file. Verify with `sha256sum -c`, extract it, run `./install.sh`, then `~/.local/bin/ghostpad-setup --persistent`. Open Ghostpad from the app launcher and scan the pairing QR. No Rust, Node, or phone app is needed for a binary release. Both architectures require glibc 2.35+ and OpenSSL 3; see the installation guide for runtime packages and source builds.

Use only trusted private Wi-Fi. The default HTTP connection is unencrypted, and anyone with the pairing code can control the computer. HTTPS needs a manually configured certificate trusted by the phone. Do not expose the port publicly. Read SECURITY.md before use.

Known limitations: Linux receiver only; US-layout ASCII typing; no individual device revocation; keep the phone page foregrounded and unlocked; pinch and window gestures depend on native desktop support. Chromium mobile emulation does not establish real Safari compatibility or latency/battery guarantees. Review the maintainer's physical-device test results for this release.

See README.md, CHANGELOG.md, docs/installation.md, and SECURITY.md in the archive or repository for details.
