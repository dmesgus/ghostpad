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
| 14 | 1–120 ASCII bytes | US-layout text; accepted only when no keyboard key is held |
| 15 | float32 scale | Native pinch scale relative to the start of this gesture (0.1–6) |
| 16 | none | End native pinch and lift both virtual contacts |

Movement floats are little-endian, finite, and bounded to ±2048. Pinch scale is a finite little-endian float32 bounded to 0.1–6. Positive pointer x/y means right/down. Wheel x positive means right; y positive means conventional wheel-down. Browser natural scrolling reverses the touch deltas. 48 CSS pixels correspond to one legacy wheel notch (120 high-resolution wheel units). Sensitivity is applied by the client only to pointer movement.

Maintain a heartbeat every 1.5 seconds. The server disconnects after a five-second read deadline and allows at most 300 frames in a one-second window. One active authenticated controller is allowed; other clients receive `busy`. All keyboard keys and mouse buttons release and residual movement resets when a controller disconnects. Complete WebSocket close/ping/pong frames are supported; input is never buffered for replay across reconnects.

A future incompatible revision will use a different endpoint or explicit version negotiation. The current native input implementation is Linux-only; the wire protocol contains no Linux-specific event codes.

Keyboard opcodes are an additive v1 extension introduced in Ghostpad 0.2. HID usages refer to the USB Keyboard/Keypad usage page, not Linux keycodes. Supported usages: 4–49, 51–56, 58–69, 74–82, and 224–227. Unlisted mappings are rejected (see `src/keys.rs`). Left Ctrl/Shift/Alt/Super are 224/225/226/227. Repeated key-down for a held key is ignored; tapping a held key does not release it. `Release` clears all modifiers and both mouse buttons. The Linux receiver creates separate pointer and keyboard uinput devices. Labels assume US QWERTY; the desktop's keyboard layout determines the resulting text.

The browser holds Super only while the Super button is physically pressed (pointer down through pointer up/cancel/lost capture). One-finger pad motion starts a left drag and two-finger motion starts a right drag while Super is held. Pointer buttons release before Super when the Super finger lifts. Three-finger taps no longer toggle a modifier. Ctrl, Alt and Shift still latch until toggled or canceled.

Opcode 14 is an additive v1 extension in 0.3. Valid text bytes are ASCII 32–126 plus LF and TAB. The server maps each character to a US physical key, adding Shift only where needed. Unknown characters, empty payloads, or text sent with held keyboard keys are rejected before injection. Clients split text into at most 120-byte chunks and pace edit packets; Backspace remains opcode 11 with usage 42. Text is not clipboard paste and cannot represent arbitrary Unicode. Native edit conversion operates on the local text tail; clients reset that context when remote navigation or pointer actions can change the caret.

Native pinch uses opcodes 15 and 16. The first scale update starts two contacts on a separate type-B multitouch uinput device; subsequent updates change their separation symmetrically about a fixed center. Scale is absolute relative to initial finger separation: 1 is neutral, values above 1 spread, values below 1 contract. Clients coalesce to the latest scale rather than summing updates, then flush the final scale before opcode 16. No Ctrl or wheel events are synthesized. Natural scrolling and pointer/scroll speed do not affect scale. The Super and RC thumb zones are excluded from surface touch counts.

Both contacts lift on opcode 16, opcode 7, disconnect, malformed input, or timeout. The native pinch path requires compositor/browser support for touchpad gestures (libinput pinch on Linux); unsupported applications receive no Ctrl+scroll fallback. The 15/16 extension requires restarting the updated receiver and refreshing the served frontend together. Older v1 receivers reject these opcodes.
