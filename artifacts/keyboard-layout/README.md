# Native Safari keyboard motion

The user clarified that the remaining rough movement occurs when tapping “Tap to start typing” to open the native keyboard. The first opening-specific change corrected the direction of movement, but the user reported that it was still not smooth. Earlier Chromium viewport simulations do not model the native keyboard animation.

[WebKit issue 265578](https://bugs.webkit.org/show_bug.cgi?id=265578) reports delayed visual viewport metrics when the Safari address bar is at the bottom. The phone captures show the same delayed metric update; DOM measurements alone do not establish the exact native painting cause.

`iphone-before.csv` records a 695 px full viewport and a 392 px keyboard viewport. On input blur, the app frame returns to 695 px immediately, while the visual viewport remains at 392 px for another 450–477 ms. `iphone-stable-frame.csv` records the subsequent attempt that keeps the frame at 695 px throughout typing and reserves keyboard space internally. The user still reproduced the visible gap with that build.

The second capture also shows native page panning by 303 px before the visual viewport reports its new offset. Pan compensation now observes the actual frame rectangle and document scroll events, with a regression that replays this ordering. Touch focus briefly hides the field's paint to avoid Safari scrolling toward its old position. Opening now lays out the final keyboard inset once and animates compositor transforms on the pad, panel, and a surface filler; the earlier padding animation recalculated flex layout on each frame.

`opening-performance.json` compares the previously served padding animation with the transform version. Each of two padding runs performed 19 layouts during 400 ms; each transform run performed 3. This is mocked Chromium mobile emulation, not a measurement of iPhone frame rate. After deployment, the user repeated the opening test on their iPhone and reported “Smooth now.” `iphone-opening-compositor.csv` retains the numeric geometry and event timing from that build.

Start the receiver with `--keyboard-debug`, then open `/keyboard-debug`, leave the phone keyboard hidden, and tap the typing field to open it. Only this explicit diagnostic page loads `/keyboard-debug.js`. It samples for eight seconds after relevant events, batching twelve numeric rows per request to `/keyboard-trace`. The receiver prints each batch with the `ghostpad-layout:` prefix. It does not read or transmit the textarea value, pairing key, clipboard, or page contents. Normal app pages are unchanged.

CSV columns, in order:

1. Monotonic time in milliseconds
2. Event code
3. `innerHeight`
4. `visualViewport.height`
5. `visualViewport.offsetTop`
6. `scrollY`
7. App frame top
8. App frame height
9. Pad height
10. Accessory panel top
11. Accessory panel height
12. Independently measured `100dvh`
13. Root client height
14. Textarea has DOM focus
15. App's native-focused class is set
16. Textarea top
17. Textarea bottom
18. `outerHeight`

Event codes: 0 sample, 1 input focus, 2 input blur, 3 input pointer-down, 4 visual resize, 5 visual scroll, 6 window resize, 7 window blur, 8 window focus, 9 initial load, 10 panel pointer-up.

Earlier rendering comparison buttons are available only with `/keyboard-debug?compare=1`:

| Button | Change | Event code |
| --- | --- | --- |
| Base | Current app layout | 11 |
| A | Remove the frame's overflow clipping | 12 |
| B | Unclipped absolute frame in a relative page | 13 |
| C | Unclipped absolute frame in a fixed page | 14 |
| D | Unclipped frame with a compositing transform | 15 |

The measurement script passes its Chromium test with the app's CSP, including validation that requests contain only numeric geometry/timing. The receiver validates the host, bounds diagnostic request length, and rejects nonnumeric content. None of the rendering comparison buttons resolved the user's concern; subsequent work targets opening motion directly.
