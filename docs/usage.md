# Using Ghostpad

Open Ghostpad from your Linux app launcher. The computer page displays a pairing QR and link, connection status, and a gesture guide. Scan with your own phone on the same trusted Wi-Fi and open the complete link in Safari (iPhone) or Chrome (Android). A QR scanner's embedded preview may not support the required browser features.

The paired phone gets control immediately. The desktop page never takes the phone's controller connection. Once connected, the QR is hidden; **Show pairing code** reveals it again. Closing the desktop page keeps the receiver running. Reopen Ghostpad to return, or choose **Stop Ghostpad** to stop it and disconnect the phone.

## Trackpad

| Action | Gesture |
| --- | --- |
| Move cursor | Slide one finger |
| Left-click / double-click | Tap once / twice |
| Right-click | Tap two fingers, or tap the bottom-right corner |
| Drag / select text | Tap then quickly touch again and slide; lift to release |
| Alternative drag | Hold one finger still for about 0.4 seconds, then slide |
| Scroll | Slide two fingers vertically/horizontally |
| Scroll strip | Slide one finger along the right edge; choose Left in Settings if preferred |
| Scroll momentum | Flick and lift; touch again to stop |
| Zoom | Pinch two fingers; requires native touchpad pinch support |
| Super / Windows key | Hold the bottom-left corner; lift to release |

A stroke stays in the zone where it began. Tapping the scroll strip does not click. Pinching uses a separate virtual multitouch touchpad; there is no Ctrl+wheel fallback. Your compositor and focused application decide how native pinch behaves.

On desktops configured for Super+mouse window actions, hold the bottom-left Super corner with one finger and use another finger to drag a window. Two other fingers resize it using right-button dragging. These actions depend on your existing window manager bindings; Ghostpad does not change them. See the [zone illustration](images/thumb-zones.svg).

## Keyboard

Open the keyboard icon in the phone's bottom dock. **Phone keyboard** uses your phone's native keyboard and sends supported text as you type. The accessory keys include Escape, Tab, arrows, Backspace, Return, and Space. Press and hold navigation keys to use the computer's normal repeat behavior.

Typing currently uses physical US-layout key events. Set the computer to a US keyboard layout and turn Caps Lock off. ASCII text, tabs, and newlines are supported; smart quotes, dashes, and ellipsis are normalized. Emoji and other non-ASCII text are rejected with a visible error. The local typing context is limited to 512 characters; pointer actions and navigation start a new context. Ghostpad is not a clipboard synchronizer.

**Key grid** exposes desktop keys and shortcuts:

- Tap Ctrl, Alt, or Shift to arm them for the next key. They clear after that shortcut. Tap again to cancel.
- Hold Super while tapping other keys with another finger. It stays down until you lift.
- For Ctrl+C, tap Ctrl, then c. For Super+Shift+3, tap Shift, hold Super, tap 3, then lift.
- The dedicated `+` key supplies Shift automatically.

Keyboard input goes to the computer's focused window. Disconnecting or closing the panel discards pending text; it is never replayed after reconnecting. Phone autocorrection, dictation, IME presentation, and keyboard size depend on the phone's browser and operating system.

## Settings and connection lifecycle

Settings offers tracking speed, natural scrolling, scroll-strip side, Light/Dark/System appearance, a gesture guide, and disconnect/reconnect. Preferences and the phone's credential are saved locally when browser storage is available. System appearance follows your device's theme.

Keep the phone page foregrounded and the phone unlocked. Safari and Chrome may suspend background tabs or networking when locked. Ghostpad reconnects when the page returns; it does not promise background operation or a wake lock. Buttons, keys, and pinch contacts release on cancellation/disconnect; the receiver's read deadline also releases an idle failed controller after about five seconds.

Only one phone can control at a time. On a second phone, tap **Use this phone** to switch. The previous phone releases any held input and waits for you to tap **Use this phone** there if you want to switch back.

With the default HTTP setup, the desktop pairing page stays open across network changes and refreshes its link and QR. A phone using an IP-based link needs the new link when the IP changes. If your computer already advertises a `.local` name, start with `ghostpad --desktop --hostname computer.local` and pair through that link to keep the same browser address. Choose **Use IP address** in the desktop pairing page if the phone cannot resolve the name.

Measured round trip in Settings includes browser, network, and receiver scheduling. Adaptive pacing reduces queued input on slow Wi-Fi.

## Forget or revoke pairing

**Forget pairing** removes the current phone browser's saved credential. It does not revoke a copied QR or another browser's credential.

To revoke every previous phone, stop Ghostpad and start a new receiver with:

```sh
~/.local/bin/ghostpad --desktop --rotate-key
```

Scan the new QR on each phone you want to use. There are no per-device credentials or individual revocation yet. See [Security](../SECURITY.md) for HTTPS and credential handling.
