# Control audit fixes

The original evidence remains in `artifacts/ui-controls-audit/`. Assertions for the fixes are in `tests/control-regressions.mjs`, included in `npm run test:browser`.

- Toolbar pointer capture preserves the original target and typing focus through release, including viewport movement and canceled gestures. Duplicate browser clicks are suppressed even if closing reveals a different target underneath.
- Continuous flex layout and viewport-based sizing replace the 380/560 px pad visibility thresholds. The pad can shrink enough to keep the dock inside very short viewports.
- Closing native typing reserves the panel's extra space during viewport recovery, then releases it with a bounded fallback. Both visual-only and layout viewport resizing are covered. Grid mode and the restored dock keep bottom safe-area spacing.
- Reselecting Phone keyboard preserves typing focus. Rapid repeat taps near the opener cannot send remote input; ordinary accessory input works after the guard expires.
- The settings handle captures long swipes and prevents compatibility clicks from toggling the panel again. Touch and mouse paths are covered.
- Both panels restore focus to their opener and support Escape. Reopening clears typing errors and retains the selected mode, including across reloads.

Validation: 177 JavaScript unit tests, the existing browser suite, all 10 targeted regression groups, and 35 Rust tests passed. No browser JavaScript errors were recorded. The generated page remains below its existing 70 KB budget. `results.json` lists the targeted assertions.

These checks use Chromium with touch emulation and simulated viewport/safe-area changes. Actual iOS/Android keyboard presentation, Safari browser chrome, and animation smoothness still require physical-device testing.
