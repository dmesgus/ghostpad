# Preparing and releasing Ghostpad

The repository can be public before an early preview release, but describe its limits honestly. The release workflow builds drafts only. Publishing a tag or release and changing repository visibility are maintainer actions.

## Before changing repository visibility

- [ ] Review the complete Git history, not just the current checkout. Run `make audit-secrets` with Gitleaks 8.30+ and all relevant refs fetched. The config keeps the default rules and adds pairing-link detection; its only credential exception is deliberately fake test data/the RFC 6455 nonce. Rotate/revoke any real secret before deciding how to remove it from history.
- [ ] Review author emails, deleted files, screenshots/QRs, personal paths, issue/PR text, Actions logs/artifacts, releases, and branch/tag names. Text scanning does not inspect every private-data format or prove absence of secrets. Public history includes commit identities even if a later commit deletes a file.
- [ ] Commit the intended source, all regenerated web assets, documentation, and workflows. Review `git status` first; local/generated `artifacts/` and credential files are ignored, but previously tracked artifacts remain tracked. Do not discard unrelated work or rewrite history just to tidy it.
- [ ] Push the reviewed branch and confirm every Check job passes on GitHub: stable Rust, minimum Rust 1.85, browser/mobile profiles, and history/working-tree secrets.
- [ ] Decide whether existing author identity and the MIT license are appropriate for publication. Avoid claiming an external security audit, supported phone/desktop combinations, or performance measurements that have not happened.

After making the repository public, enable [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) and verify the Security → Advisories → Report a vulnerability form. GitHub provides this for public repositories; SECURITY.md links to that form. Enable available secret scanning/push protection and dependency alerts in the repository's security settings, review Actions permissions, and require the Check jobs for changes to `main`.

## Before publishing the first preview

Run from a reviewed checkout with development/browser prerequisites installed:

```sh
npm ci --ignore-scripts
make web
git diff --exit-code -- web
make check
make test-integration
make test-browser
make audit-secrets
make dist
python3 tests/release-smoke.py dist/ghostpad-0.3.0-x86_64-unknown-linux-gnu.tar.gz
```

The archive name above is an example for 0.3.0/x86_64; use the version and architecture actually built. A local build inherits the local system's glibc/OpenSSL requirements. Official release jobs build both architectures on Ubuntu 22.04; do not label a local Arch-built artifact as having the official compatibility baseline.

Record actual hardware testing before publishing. These are manual gates, not claims made by browser emulation:

| Device / desktop | What to verify | Result |
| --- | --- | --- |
| Physical iPhone + Safari | QR, typing/autocorrect, keyboard open/close, background/lock/reconnect, rotate key | Pending |
| Physical Android + Chrome | Same connection/lifecycle/keyboard checks | Pending |
| Linux desktop in use | Movement, clicks, drag, scrolling/momentum, key release, native pinch in a supported application | Pending |
| Second Linux desktop/compositor | Install, `uaccess`/temporary setup, gestures, launcher, stop/relaunch | Pending |
| Fresh supported x86_64 system | Archive checksum, install, launch without Rust/Node, update/removal | Pending |
| Fresh supported ARM64 system | Same archive/runtime checks on real ARM64 | Pending |

On each phone also test a wrong key, old key after rotation, a second controller, network interruption during a held key/drag, and recovery without replaying input. Confirm no input remains held. Test HTTPS with an actually trusted IP certificate if advertising that configuration as tested.

## Create a draft

1. Keep Cargo.toml/Cargo.lock, package.json/package-lock.json, and visible UI versions consistent. Update CHANGELOG.md and `docs/release-notes.md`; replace the manual test table's pending entries with actual observations or explicitly limited support.
2. Commit and push the reviewed state. Create and push the matching version tag, for example `v0.3.0`. The Draft release workflow refuses a tag that differs from the executable's Cargo version.
3. Wait for all verification and both packaging jobs. Each builds/tests natively, checks an explicit release file allowlist, and installs/starts/removes the actual archive in a disposable prefix using preview input only. Artifacts contain no source checkout, build cache, saved credential, or test screenshots.
4. Inspect the resulting **draft prerelease**, download both archives/checksums, and perform the remaining manual checks. The workflow's write token is scoped to the draft job. It refuses to replace assets on an already published release.
5. Edit the draft notes with the actual device results and known issues. Publish the prerelease only after deciding those limits are acceptable. Repository visibility and release publication remain separate choices.

Action references are pinned to full commit SHAs and updated through Dependabot. The scanner archive has a pinned checksum too; update its version/hash together and verify against the upstream release. Pull-request checks have read-only repository permission and no publication credentials. Do not introduce `pull_request_target` execution of untrusted code.

## Review performed during public-release preparation

The initial local audit inspected all 10 commits reachable at the start, including deleted file content. Gitleaks findings were limited to the public RFC 6455 handshake example nonce used in tests; the exact value is allowlisted. A focused additional scan found no private-key blocks, common provider tokens, concrete pairing links, or personal home paths in that history. This is a bounded local check, not an external audit or a check of GitHub-hosted issues/logs/settings.

Local validation on 2026-11-17 used Rust 1.99.1 and Node 26.13.0 on an x86_64 Linux host:

- `make check`: formatting/Clippy, 50 Rust tests, 208 JavaScript tests, four install/package tests, and four firewall tests passed.
- Real TCP/TLS integration: all 11 tests passed, including authentication, controller exclusion, deadlines, persistence, rotation, and TLS input flow.
- Chromium UI/control/desktop checks passed, including independent QR decoding, relaunch, auth, status/retry, clipboard fallback, appearance, and shutdown.
- Android (Pixel 7) and iPhone 13 Chromium profiles passed pairing, gesture, keyboard, saved-pairing, and controller-handoff checks. These remain emulation results.
- The local x86_64 release archive passed installation into a temporary prefix, preview HTTP/auth/assets, suppressed pairing output, and removal. Packaging determinism and architecture rejection are tested separately.
- Gitleaks 8.30.0 scanned all 10 locally reachable commits and working files with no remaining findings after the exact public test nonce exception. Local documentation links/images, workflow YAML/shell syntax and action SHA pins, and `git diff --check` passed.

GitHub-hosted checks, minimum-toolchain compatibility, both Ubuntu archive baselines, account security settings, and physical-phone/compositor results still need confirmation in their actual environments. The local archive is a host build, not proof of the Ubuntu compatibility baseline.
