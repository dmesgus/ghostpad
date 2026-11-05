# Control and keyboard audit

Tested the restored implementation without changing application code. Ran the existing unit and browser suites plus 32 audit scenarios (22 main, 8 follow-up, 2 double-tap). All existing suites passed. The audit recorded no page JavaScript errors; its scenarios record behavior rather than treating every observed problem as a test-run failure.

Environment: desktop Chromium with mobile/touch emulation and a mocked receiver. Tested 320×568, 390×844, 430×932, 640×360 and 320×220 layouts. Software-keyboard resizing/panning and a 34 px bottom safe area were simulated. These results do not establish the exact behavior or smoothness of a physical iPhone or Android keyboard.

## Findings

1. **First tap on keyboard × can miss after the button moves.** With the 34 px safe-area simulation and a 480 px visual viewport, pressing × blurs native typing. Losing `native-focused` restores bottom padding, moving × from y=230.61 to y=196.61 before release. The release/click reaches another element, leaving the keyboard section open. Reproduced with touch and mouse. A second tap succeeds. Switching to Key grid can fail on the first tap for the same reason. Raw event order and geometry are in `results.json` and `follow-up.json`.

2. **Viewport thresholds cause large jumps in the pad and toolbar.** At 380 px visual height in phone mode, the pad is 120.61 px tall and × starts at y=130.61. At 379 px the pad disappears and × jumps to y=4. In grid mode, changing 559→560 px makes a 110 px pad appear and moves × from y=8 to y=120. A touch started on × before the 380→379 change and released afterward did not close the section. During real keyboard movement, crossing these thresholds could cause visible jumps and missed taps.

3. **Closing and native viewport recovery happen as separate layout changes.** At 390×844, opening the phone panel changes the pad from 748 to 584.61 px immediately; closing restores it immediately. When a native keyboard is still occupying the screen, closing first restores the pad/dock inside that smaller viewport, then each viewport expansion resizes them again. This reproduces staged movement, rather than one coordinated transition. Adding decorative animation alone would not resolve the button targeting and threshold problems.

4. **Dock clips during very short viewport dismissal.** After closing at a simulated 220 px visible height, the pad keeps its 150 px minimum; pad + grabber + dock need 246 px. The dock extends 26 px beyond the app frame and is clipped. At 240 px it extends 6 px beyond. At 320 px it fits. This occurs while the CSS layout viewport remains tall; a fully resized landscape layout has different media-query sizing.

5. **Reselecting Phone keyboard unnecessarily blurs and refocuses typing.** Both touch and mouse traces show native-input → mode button → native-input. The selected mode does not change. This also invokes the input-focus cleanup again. The actual OS keyboard flicker/dismissal caused by this sequence needs physical-device verification.

6. **Quick repeat taps on the keyboard opener can send an unintended remote key.** At 390×844, the second tap at the original opener position lands on the newly visible Right Arrow accessory key. Captured packets include key-down `[9,79]` and key-up `[10,79]`. This is a real input packet from the browser test, not just a visual effect. Repeating × at its original position landed on the scroll strip in this layout and sent no extra remote click/key.

7. **Settings handle swipe behavior is inconsistent.** A normal 50 px upward swipe releases outside the handle; it never reaches the handle's pointer-up handler, so settings does not open. A 22 px swipe kept within the handle opens settings on pointer-up, then the following compatibility click immediately closes it. Bubble-event traces show settings=true at pointer-up and settings=false at click. Ordinary handle taps work.

8. **Closing leaves focus on a hidden close button.** Immediately after both keyboard × and settings ×, activeElement remains the now-hidden close control. Focus is not restored to the opener. This is principally a keyboard/accessibility issue, rather than the cause of the touch animation complaint.

9. **Typing errors survive close/reopen.** Entering unsupported Japanese text displays the US-character error. Closing clears the input. Reopening shows an empty input with the same old error message until another valid input event changes it. This makes a fresh panel appear to remain in an error state.

10. **Reopening always returns to Phone keyboard.** Choosing Key grid, closing, and reopening selects Phone keyboard and focuses typing. This is current documented behavior, not an implementation failure, but it introduces extra mode switching and native keyboard presentation for someone using the key grid repeatedly.

11. **Escape does not dismiss either panel.** Confirmed for settings and keyboard. This is a desktop/hardware-keyboard convenience gap; phone users use ×.

## Checks that behaved correctly

- Ordinary settings icon/handle taps and × closures at standard layouts.
- Ordinary keyboard opening, native focus, grid/native selection, and × closure without simulated safe-area movement.
- Settings handle tap while settings is open closes it.
- 100 repeated keyboard open/close and settings open/close cycles: no incorrect final state, no remaining animations.
- Normal controls remained reachable in the tested phone and landscape layouts.
- Returning from a scrolled grid to a reopened phone panel reset the local scroll position.
- Existing browser suite passed pairing, touch gestures, accessory key holds/releases/cancellation, modifier cleanup, simulated viewport panning, appearance, settings, reconnect and forgetting.
- Existing unit suite passed.

## Evidence and replay

- `results.json`: 22 main scenarios, focus/pointer events, and geometry.
- `follow-up.json`: 8 targeted reproductions.
- `double-taps.json`: remote packets and events for repeated taps.
- `close-220.png`, `close-240.png`, `close-320.png`: closing while the visible viewport remains short.
- `cross-first-tap.png`: panel still open after the first safe-area close tap.

Replay from the project root:

```sh
npm test
npm run test:browser
node tests/ui-controls-audit.mjs
node tests/ui-controls-audit.mjs --follow-up
node tests/ui-controls-audit.mjs --double-taps
```

The audit only adds test and report files. It does not restore or introduce any animation or change the app's behavior.
