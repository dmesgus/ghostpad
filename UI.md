# Frontend architecture

Ghostpad uses plain TypeScript, CSS, and SVG. There are no browser runtime dependencies. React, Motion, WebGL, Tailwind, and the component demos were removed from the performance-focused implementation.

| Purpose | Path |
| --- | --- |
| Gesture/network controller | `web/src/app.ts` |
| Gesture recognition | `web/src/gestures.ts` |
| Decorative Super fill | `web/src/super-fill.ts` |
| Appearance and pre-paint theme selection | `web/src/theme.ts` |
| Styles | `web/src/style.css` |
| Static orb SVG and interface | `web/index.html` |
| Generated browser assets | `web/*.js`, `web/style.css` |

Run `npm ci`, then `npm run build:web`. The build compiles TypeScript without source comments, removes safe indentation from emitted scripts without multiline strings, and compacts the source stylesheet, keeping the embedded page within its 70 KB budget. Run `npm test` and `npm run test:browser` for verification. Rebuild the embedded receiver with `cargo build --release --offline`, restart it, and refresh the phone.

The Super effect retains the expanding black circle, 0.5-second duration, and original easing. CSS animates the fill transform and the browser canvas background; JavaScript measures geometry when the hold starts or the held pad resizes. The SVG face changes color and eye shape on Super activation. It has no idle animation, gaze tracking, canvas, or blend mode. Reduced motion disables transitions. Decoration ignores pointer input, preserving zone hit testing, cancellation, and modifier ordering. Super uses 32% of the pad width (capped at 160 px) and 20% of its height (clamped to 68–136 px). Right-click uses 24% of the width (capped at 108 px) and 14% of the height (clamped to 56–96 px). Above the keyboard their heights are 68 px and 56 px respectively. Each inner shoulder has an elliptical radius of 100% width by 50% height; native rounded-button hit testing makes the cutaway available for tracking. The controls’ full-pad wrapper ignores pointer input, so at least 44% of the width between the corners remains a continuous tracking lane. The scroll strip is 56 px wide and ends at the highest point of the corner on its selected side, allowing the default right strip to extend farther down. Its top inset scales down with the small keyboard pad so the strip never has a negative height. Right-corner touch taps send explicitly on lift and suppress the browser’s compatibility click, which can be lost after a captured Super drag. Movement over 9 px, multiple fingers in the corner, and cancellation suppress the tap; mouse and keyboard activation keep their native click behavior.

The page canvas and `theme-color` match the touchpad surface in each appearance and turn black while the pad Super effect is held. The fixed app frame stays transparent, with a separate backdrop for the controls, so Safari can sample the outer page color. Cancellation restores the current appearance. The canvas transition also respects reduced motion. Browser tests verify these colors; Safari toolbar tinting and animation still need a real iPhone check because browser chrome is outside the test viewport.

Pointer sensitivity is cached when preferences change. Drag labels and visibility update only on state changes. Gesture timing, the 8 ms motion-send interval, and network backpressure policy are unchanged pending real-device latency measurements.

## Phone keyboard layout

The keyboard panel remembers its selected mode. In Phone keyboard mode, opening focuses native typing in the same user gesture. Phone mode has a short text field and two rows of accessory keys: Escape, Tab, Backspace, Return, Space, and all four arrows in an inverted T. Space spans two columns. Targets are at least 44 × 48 px, reducing to 44 px tall in short views. Accessory pointer-down prevents focus transfer while pressing the remote key immediately; pointer-up releases it without an extra click. Captured pointers may drift outside the key without switching keys. Essential keys in both modes, including grid Home and Delete, share this behavior. The receiver enables EV_REP for the virtual keyboard, leaving repeat timing to the native input stack. There are no browser repeat timers or extra repeat packets.

Held usages are reference-counted across fingers and shortcut chords. One-shot modifiers remain pressed until their held key lifts, while Super has its own independent hold. Pointer cancellation, lost capture, mode changes, panel closure, suspension, disconnect, and native typing clear held keys. Keyboard Enter/Space activation follows the same down/up lifecycle; an accessibility click remains a tap. Other grid keys retain touch-end taps so the grid can scroll. Composition and pending text must finish before a new hold can start; a pending-text message tells the user to retry. All accessory keys reset the local typing context without dismissing the phone keyboard.

Grid mode has 44 px-tall keys in a scrollable center, with the mode switch above and modifier/navigation controls pinned below. The main dock is hidden in both modes. The touchpad shrinks continuously to make room for the controls. Phone mode keeps accessory keys pinned below the scrollable typing field and status message. Control sizing interpolates with visible height without threshold jumps.

The fixed app frame follows `visualViewport.height` and `offsetTop` on both `resize` and `scroll`, with `innerHeight` as a fallback. A CSS height variable uses the visual viewport because media queries can retain the full layout height while the OS keyboard is visible. Phone keyboard spacing stays stable across focus changes; grid mode and the dock retain bottom safe-area spacing. Closing during viewport recovery briefly reserves panel space, releasing it as viewport height returns, with a bounded fallback and reduced-motion support. See [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) and [focus with preventScroll](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus).

Both panels support Escape and return focus to their opener. Keyboard mode persists across reopening and reloads; reopening clears typing errors. Toolbar presses retain pointer capture and typing focus until release. The settings handle captures swipes and activates only once. Repeated pointer taps within 32 px of the keyboard opener are suppressed for 450 ms so newly exposed keys cannot receive accidental input.

Browser regressions check one-tap opening, touch/mouse accessory focus, press/hold/release and cancellation, multiple held fingers, keyboard activation, packet ordering, curved corner hit areas, boundary crossings, minimum accessory sizes, short/landscape views, simulated viewport panning, and pinned grid controls. These simulations do not open a real iOS/Android keyboard; physical-device verification is still needed.

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
