# Ghostpad protocol v1

Connect to `/ws` on the receiver's exact HTTP(S) origin. A browser-style `Origin` matching that origin, `Host`, WebSocket version 13, and standard upgrade headers are required. There is no compression, fragmentation, or protocol negotiation in v1. Client frames must be masked and final; payloads are at most 125 bytes. Unknown frame types, malformed input, non-finite values, and excessive rates disconnect.

The first frame is text: the 64-character hexadecimal pairing secret. Within five seconds the receiver replies with one of `ready:linux`, `ready:preview`, `unauthorized`, or `busy`. Unauthorized and busy connections close. Input is accepted only after ready. Do not transmit secrets in query parameters.

After authentication, commands use binary frames:

| Opcode | Payload after opcode | Meaning |
| --- | --- | --- |
| 1 | float32 dx, float32 dy | Relative pointer motion |
| 2 | float32 dx, float32 dy | Relative wheel motion in CSS pixels |
| 3 | none | Left click |
| 4 | none | Right click |
| 5 | none | Left button down |
| 6 | none | Left button up |
| 7 | none | Release and reset fractional motion |
| 8 | none | Heartbeat; text reply `pong` |
| 9 | uint8 HID usage | Key down (including modifier) |
| 10 | uint8 HID usage | Key up |
| 11 | uint8 HID usage | Key tap (down then up) |
| 12 | none | Right button down |
| 13 | none | Right button up |

Floats are little-endian, finite, and bounded to ±2048. Positive pointer x/y means right/down. Wheel x positive means right; y positive means conventional wheel-down. Browser natural scrolling reverses the touch deltas. 48 CSS pixels correspond to one legacy wheel notch (120 high-resolution wheel units). Sensitivity is applied by the client only to pointer movement.

Maintain a heartbeat every 1.5 seconds. The server disconnects after a five-second read deadline and allows at most 300 frames in a one-second window. One active authenticated controller is allowed; other clients receive `busy`. All keyboard keys and mouse buttons release and residual movement resets when a controller disconnects. Complete WebSocket close/ping/pong frames are supported; input is never buffered for replay across reconnects.

A future incompatible revision will use a different endpoint or explicit version negotiation. The current native input implementation is Linux-only; the wire protocol contains no Linux-specific event codes.

Keyboard opcodes are an additive v1 extension introduced in Ghostpad 0.2. HID usages refer to the USB Keyboard/Keypad usage page, not Linux keycodes. Supported usages: 4–49, 51–56, 58–69, 74–82, and 224–227. Unlisted mappings are rejected (see `src/keys.rs`). Left Ctrl/Shift/Alt/Super are 224/225/226/227. Repeated key-down for a held key is ignored; tapping a held key does not release it. `Release` clears all modifiers and both mouse buttons. The Linux receiver creates separate pointer and keyboard uinput devices. Labels assume US QWERTY; the desktop's keyboard layout determines the resulting text.

The browser latches modifiers until tapped again or input is canceled. With Super latched, one-finger motion starts a left drag and two-finger motion starts a right drag; lifting fingers releases the mouse button while preserving Super. A short three-finger tap toggles Super. Pointer buttons release before a modifier changes.
