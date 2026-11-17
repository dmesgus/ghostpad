# Contributing

Start with a reproducible problem or a small, focused improvement. For larger changes, open an issue explaining the user problem before implementing it. Report security issues through [private vulnerability reporting](SECURITY.md#report-a-vulnerability).

## Development setup

Use Linux, Rust 1.85+, a C linker/OpenSSL development libraries, Python 3.9+, Make, and Node 22+. For browser checks, install Chromium and `qrencode`; set `CHROMIUM_PATH` if the executable is not `/usr/bin/chromium`. [Installation](docs/installation.md) lists system package names.

```sh
npm ci --ignore-scripts
make web
make check
make test-integration
make test-browser
```

`make check` runs Rust formatting/Clippy and Rust, browser-state, installer, packaging, and firewall unit tests. Integration tests start a real TCP/TLS receiver with a temporary config directory in preview mode. Browser tests use Chromium and disposable preview receivers/controlled peers; they must never connect to a user's active receiver or inject real desktop input. Browser-generated screenshots/reports are local artifacts.

Frontend source lives in `web/src/`. Commit both source and regenerated `web/*.js`/CSS/HTML. `make web` only needs the locked Node build dependencies. If changing the canonical `web/icon.svg`, also run `make icons` with `rsvg-convert` installed (`librsvg2-bin` on Debian/Ubuntu, `librsvg` on Arch); commit the PNG/ICO fallbacks. Rasterization is separate because graphics-library versions can change raster output.

Rebuild the receiver, stop the old process, and refresh the phone after asset/protocol changes. The executable embeds the browser assets at compile time. Keep `package.json`, `package-lock.json`, Cargo's manifest/lockfile, and displayed versions consistent when changing release versions.

## Design and security constraints

- Keep the user path local, account-free, and usable without installing a phone app.
- Preserve the single-file receiver and ordinary-user execution. Installation must not silently change firewall rules, gain root input privileges, or enable autostart.
- Preserve exact Host/Origin checks, authenticated desktop APIs, bounded parsing/resource use, and input release on every failure path. Add meaningful regression tests for changes to these boundaries.
- Avoid third-party browser runtime dependencies, external fonts/assets, idle animation work, and speculative gesture delays. Keep the embedded phone page within its tested size budget.
- Keep wire protocol changes compatible or explicitly versioned. Never replay pending input after reconnection. See [PROTOCOL.md](PROTOCOL.md).
- Use disposable credentials in tests. Do not commit pairing screenshots, real links/keys, personal logs, or private host paths. `make audit-secrets` uses an installed [Gitleaks](https://github.com/gitleaks/gitleaks) to scan all local Git refs and working files, with redacted output.

For a pull request, describe the trigger/problem, resulting behavior, and checks run. Include redacted screenshots when helpful. A Chromium iPhone profile is not a substitute for physical Safari testing; label actual device results honestly. Do not claim end-to-end latency or battery improvements from synthetic tests alone.

## Native input testing

Most work needs no `/dev/uinput` permission: use `make preview`. The optional `tests/native_pinch.py` path creates native devices and needs an intentional manual run with appropriate permissions; inspect the test before using it on your desktop. Record phone OS/browser, compositor, application, and test outcome for real-device results.

The project uses the MIT license. By contributing, you agree that your contribution can be distributed under that license. Keep discussion respectful and focused on the work.
