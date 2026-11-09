# Ghostpad reliability and performance audit

2026-11-08. Compared with the working tree at the start of this audit, including its existing keyboard and viewport fixes.

Reviewed the Rust receiver, HTTP/WebSocket framing, TLS transport, controller ownership and release paths, Linux input and native pinch delivery, browser connection lifecycle, flow control, gesture and scroll state, typing queues, appearance/layout scripts, startup, setup scripts, and build/test configuration. Changes target reproduced failures and measurable recurring work.

## Changes

- A failed or suspended WebSocket is retired immediately, even if the browser never dispatches its close event. Reconnecting, quickly returning to the page, and pressing Disconnect/Reconnect no longer depend on that event. Old events and queued input cannot affect a replacement connection.
- Online, page restoration, and visibility events clean up closed/closing controllers before opening a replacement. This also clears stale authentication deadlines, acknowledgement timers, and heartbeat intervals.
- Heartbeat expiry uses monotonic elapsed time, avoiding false results when the phone's wall clock changes. Heartbeat periods and safety deadlines retain their existing values.
- Large cursor/scroll bursts are divided into valid packets, preserving total distance and diagonal direction. Previously, each axis was clipped at 2,048 units. Motion still precedes button release.
- WebSocket frames reuse a fixed 125-byte payload buffer. Native Linux event serialization and pinch positions use stack arrays. Releasing held keyboard keys no longer clones their set.
- A fixed 1 KiB read buffer replaces individual socket/TLS reads for each header byte and frame field. It returns available input immediately and forwards each existing read deadline. Acknowledgements and other writes bypass this buffer.
- HTTP and upgrade headers are written together, reducing small writes during connection establishment.

No dependencies, gesture thresholds, sensitivity settings, authentication rules, receiver input limits, flow-control window sizes, protocol negotiation, or desktop configuration changed. Existing uncommitted UI, CSS, and browser/control-test changes were preserved. Test-generated screenshot changes were removed from the final diff.

## Receiver measurements

Five alternating runs used optimized temporary builds and a counting Rust allocator. The source baseline was captured in `/tmp/ghostpad-audit-baseline`. Counts include Rust reallocations; they do not measure process RSS or allocations internal to OpenSSL. Event serialization writes to `/dev/null`, and pinch updates use preview mode. No desktop input was injected.

| Workload | Before | After |
| --- | ---: | ---: |
| Allocations for 100,000 WebSocket frame parses | 100,000 | 0 |
| Allocations for 100,000 native scroll frames | 100,000 | 0 |
| Allocations for 100,000 steady pinch-position updates | 100,000 | 0 |
| Allocations per controller session with 200 moves | 225 | 26 |
| Total requested heap bytes per such session | 3,258 | 2,620 |
| Underlying read calls for one available batch containing a complete 200-move session | 791 | 4 |
| Underlying write calls for that session, using the legacy protocol | 6 | 3 |
| Underlying read/write calls for a health request | 46 / 12 | 1 / 2 |

The I/O counts use an in-memory stream containing already available input. Actual socket reads depend on packet arrival and fragmentation. The extra read storage is bounded to 1 KiB per connection and avoids repeated system calls; it does not wait to fill before returning input.

Median diagnostic times across five runs:

| Workload | Before | After |
| --- | ---: | ---: |
| 500 controller sessions, each with 200 moves | 15.935 ms | 14.774 ms |
| 100,000 WebSocket frame parses | 4.846 ms | 2.286 ms |
| 100,000 native scroll frames to `/dev/null` | 93.220 ms | 83.592 ms |
| 100,000 preview pinch-position updates | 3.230 ms | 0.322 ms |

These timings include allocation instrumentation and are microbenchmarks, not phone or desktop cursor latency. Full samples: [receiver-performance.json](receiver-performance.json).

## Browser and weak-link checks

Three alternating Chromium runs compared the exact pre-audit assets with the updated assets. Both versions requested zero idle animation frames. Median synchronous touch handling was 0.3 ms in both versions. Median synthetic movement-to-send time was 0.2 ms before and 0.3 ms after; these small, noisy mocked-network timings do not establish a browser speedup. The self-contained page increased from 72,902 to 73,602 bytes and remains below its 75,000-byte budget. Full samples and measurement limitations: [browser-performance.json](browser-performance.json).

The existing simulation with 50-packet/s capacity, 80 ms base RTT, and intermittent 100 ms stalls still preserves all 750 input samples using 79 motion packets, at most four outstanding packets, and 61 ms of catch-up after the last sample. These results were already achieved by the existing flow-control algorithm; that algorithm was preserved.

Additional drag simulations cover 160, 500, and 900 ms RTT, a 25-packet/s service rate, and intermittent 250 ms stalls. Each preserves all movement, keeps movement between button-down and button-up, releases the button, stays within the existing eight-packet control window, and leaves no timers running after acknowledgements finish. These are controlled simulations, not measurements of physical radio range.

## Validation

- `npm run build:web`: passed.
- `npm test`: 208 frontend tests passed, including 16 new regression cases.
- `cargo fmt --check`: passed.
- `cargo clippy --all-targets --offline -- -D warnings`: passed.
- `cargo test --offline`: 42 tests passed, including four new receiver regressions.
- `cargo build --offline` and `cargo build --release --offline`: passed.
- `python3 tests/integration.py`: all nine real local TCP/TLS tests passed, including authentication, controller exclusion, acknowledgements, timeout recovery, pairing persistence/rotation, and TLS.
- `npm run test:browser`: the complete mobile-browser suite and all 16 control regressions passed without page errors.
- `git diff --check`: passed.

New regressions cover missing/late socket events, interrupted upgrades, suspension/restoration, stale controller recovery, heartbeat expiry, failed sends/backpressure, large cursor/scroll bursts, slow-link drag ordering, one-byte through batched receiver reads, reused payload storage, truncated frames, and Linux event byte layout and synchronization.

## Practical limits and applying the build

Ghostpad communicates over the local Wi-Fi/LAN; internet download speed is not the determining factor. These changes reduce receiver work and improve connection recovery. Router coverage, interference, client isolation, operating-system suspension, and a broken network still impose limits. Physical Wi-Fi range and real iPhone/Android/compositor behavior were not measured in this audit; the privileged libinput/device test was not rerun. Absolute lag-free operation cannot be guaranteed.

The release binary is rebuilt at `target/release/ghostpad`. Restart the receiver using the same options as before, then refresh the phone page to load it. The running receiver and system configuration were not changed by this audit.
