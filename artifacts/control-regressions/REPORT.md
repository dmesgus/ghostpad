# Control audit fixes

The original evidence remains in `artifacts/ui-controls-audit/`. Assertions for the fixes are in `tests/control-regressions.mjs`, included in `npm run test:browser`.

- Toolbar pointer capture preserves the original target and typing focus through release, including viewport movement and canceled gestures. Duplicate browser clicks are suppressed even if closing reveals a different target underneath.
- Continuous flex layout and viewport-based sizing replace the 380/560 px pad visibility thresholds. The pad can shrink enough to keep the dock inside very short viewports.
- Closing native typing blurs the field before hiding its panel; switching to the grid uses the same order. The full app frame and dock return immediately, with safe-area spacing and no spacer below the dock. Tests assert the full-height layout immediately after close, while native viewport metrics are still small and panned.
- Viewport writes coalesce into one animation-frame update. A bounded watch catches missing keyboard opening events. Blur cancels the watch and releases height/offset constraints to CSS synchronously, so delayed keyboard dismissal events cannot compress the closed app. Rapid reopening preserves the new typing session, and closure leaves no idle polling.
- Dismissing the OS keyboard also restores the accessory panel without pressing ×. Window blur clears keyboard sizing immediately. A short watch on every viewport event catches metrics that update after the event, including after a long typing session. A return to full height releases keyboard sizing even if the OS retains textarea focus; tapping the field or mode button reopens typing.
- Tapping the closed typing field focuses it in the same touch gesture while preventing a second Safari scroll toward its old position. Native opening lays out the final keyboard inset once, then animates transforms on the pad, accessory panel, and surface filler. Closing and reduced motion release those temporary layers. The opening comparison records 3 layouts per opening versus 19 with the preceding padding animation in mocked Chromium.
- Settings, keyboard, and dock fades keep touch targets in place. Reduced motion disables their animations and control-color transitions.
- Reselecting Phone keyboard preserves typing focus. Rapid repeat taps near the opener cannot send remote input; ordinary accessory input works after the guard expires.
- The settings handle captures long swipes and prevents compatibility clicks from toggling the panel again. Touch and mouse paths are covered.
- Both panels restore focus to their opener and support Escape. Reopening clears typing errors and retains the selected mode, including across reloads.

Validation: 208 JavaScript unit tests, the existing browser suite, all 22 targeted regression groups, 43 Rust tests, and 9 HTTP/WebSocket/TLS integration tests passed. No browser JavaScript errors were recorded. The generated page is 76,444 bytes within its revised 77 KB budget. `results.json` lists the targeted assertions. The release receiver was rebuilt, restarted with its existing pairing and launch settings, and verified to serve the transform animation.

Automated checks use Chromium with touch emulation and simulated viewport/safe-area changes. They do not measure native keyboard frame rate or establish behavior on other devices.

The user clarified that the remaining problem was rough movement when opening the native keyboard from the typing field. The opening focus change corrected its movement, but the user reported that it was still not smooth. After deployment of the transform animation, the user repeated that opening test on their iPhone and reported “Smooth now.” The explicit `/keyboard-debug` page collects numeric geometry and event timing; normal `/` pages do not load this measurement script. Optional rendering comparisons require `?compare=1` and did not resolve the user's concern.
