# Frontend architecture

Ghostpad uses plain TypeScript, CSS, and SVG. There are no browser runtime dependencies. React, Motion, WebGL, Tailwind, and the component demos were removed from the performance-focused implementation.

| Purpose | Path |
| --- | --- |
| Gesture/network controller | `web/src/app.ts` |
| Gesture recognition | `web/src/gestures.ts` |
| Decorative Super fill | `web/src/super-fill.ts` |
| Styles | `web/src/style.css` |
| Static orb SVG and interface | `web/index.html` |
| Generated browser assets | `web/*.js`, `web/style.css` |

Run `npm ci`, then `npm run build:web`. The build compiles TypeScript and copies the source stylesheet. Run `npm test` and `npm run test:browser` for verification. Rebuild the embedded receiver with `cargo build --release --offline`, restart it, and refresh the phone.

The Super effect retains the expanding black circle, 0.5-second duration, and original easing. CSS animates only the transform; JavaScript measures geometry when the hold starts or the held pad resizes. The SVG face changes color and eye shape on Super activation. It has no idle animation, gaze tracking, canvas, or blend mode. Reduced motion disables transitions. Decoration ignores pointer input, preserving the original zone boundaries, cancellation, and modifier ordering.

Pointer sensitivity is cached when preferences change. Drag labels and visibility update only on state changes. Gesture timing, the 8 ms motion-send interval, and network backpressure policy are unchanged pending real-device latency measurements.

## Phone keyboard layout

The keyboard panel opens and focuses native typing in the same user gesture. Phone mode has a short text field and six accessory keys along the bottom. Accessory pointer-down prevents focus transfer, and touch-end sends exactly one tap; arrows, Tab, Escape, Return, and Backspace start a new remote typing context without dismissing the phone keyboard. Composition must commit before accessory navigation can run.

Grid mode has 44 px-tall keys in a scrollable center, with the mode switch above and modifier/navigation controls pinned below. The main dock is hidden in both modes. Short visible viewports hide the touchpad before shrinking these controls.

The fixed app frame follows `visualViewport.height` and `offsetTop` on both `resize` and `scroll`, with `innerHeight` as a fallback. Height classes use the visual viewport because CSS media queries can retain the full layout height while the OS keyboard is visible. See [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) and [focus with preventScroll](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus).

Browser regressions check one-tap opening, touch/mouse accessory focus, packet ordering, minimum accessory sizes, short/landscape views, simulated viewport panning, and pinned grid controls. These simulations do not open a real iOS/Android keyboard; physical-device verification is still needed.

## Performance verification

Browser tests check touch behavior, fill coverage/reversal, reduced motion, small-screen layouts, and absence of idle animation-frame requests. They deliberately reject canvas creation. The embedded-page test limits the served page to 70 KB to prevent large runtime dependencies returning unnoticed.

These checks do not measure finger-to-desktop latency. Compare releases on the same phone, Wi-Fi, and desktop, including sustained use. Record latency distributions (median, p95, p99), stalls/reconnects, input processing time, and battery/thermal behavior. The settings RTT is a network/application round trip, not end-to-end cursor latency. High-frame-rate video of the finger and desktop can establish visible response time without synchronizing device clocks. Only adjust gesture thresholds, send intervals, or transport after that comparison.

Run the optional local comparison after the browser regression suite:

```bash
npm run test:browser -- --profile --compare 586da29
```

Omit `--compare` to profile only the working tree. The harness performs three runs per version in alternating order and writes `artifacts/performance.json`. It records startup-to-controller time, idle animation-frame requests, renderer task time, synchronous touch-handler durations, and synthetic movement-to-WebSocket-send durations. It uses a local mocked peer and does not inject input into the desktop.

To compare against a saved copy of uncommitted web assets, use `--profile --baseline-assets /path/to/saved/web` instead of `--compare`. This writes `artifacts/cursor-performance.json`. Synthetic touches are requested every 4 ms to exercise cursor batching; this does not imply that a real phone browser delivers events at that rate.

The cursor update comparison against the working tree before these fixes is recorded in [cursor-performance.json](artifacts/cursor-performance.json). Across three alternating runs, median synthetic movement-to-send delay fell from 5.3–5.4 ms to 0.1–0.2 ms; p95 fell from 7.3–7.4 ms to 0.3–0.7 ms. All 160 synthetic samples produced cursor sends in each new run, compared with 93–94 coalesced sends before. Both versions scheduled zero idle animation frames. Unit tests also replay 60, 90, 120, 144, and 240 Hz samples, verify bounded output for 1,000 Hz input, and check that the full distance arrives before release. These results cover local client dispatch, not phone-to-desktop latency or physical touchpad equivalence.

The recorded comparison against `586da29` reduced the served page from 492,052 to 58,717 bytes (88.1%). The effects script shrank from 410,854 to 1,803 bytes. Over roughly two idle seconds per run, the previous version requested 120–121 animation frames; the optimized version requested zero. Median startup-to-controller time across three runs was 344.7 ms before and 59.1 ms after. These are desktop Chromium results with a phone-sized viewport; the old orb used SwiftShader software rendering. They do not establish iPhone performance, battery savings, or end-to-end cursor latency. Raw per-run timings and limitations are retained in the JSON report.
