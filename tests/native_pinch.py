"""Real uinput -> libinput test. Requires /dev/uinput and read access to its event node.
Build: rustc --edition=2024 tests/support/native_pinch.rs -o /tmp/ghostpad-native-pinch
Run: python3 tests/native_pinch.py /tmp/ghostpad-native-pinch
The libinput test context exclusively grabs ONLY the new Ghostpad gestures device
before sending anything, so test events never reach desktop applications.
"""
import ctypes as C
import errno
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import time

lib = C.CDLL('libinput.so.10')
P = C.c_void_p
OPEN = C.CFUNCTYPE(C.c_int, C.c_char_p, C.c_int, P)
CLOSE = C.CFUNCTYPE(None, C.c_int, P)
class Interface(C.Structure):
    _fields_ = [('open_restricted', OPEN), ('close_restricted', CLOSE)]
def api(name, result, *args):
    fn = getattr(lib, name); fn.restype = result; fn.argtypes = args; return fn
create = api('libinput_path_create_context', P, C.POINTER(Interface), P)
add = api('libinput_path_add_device', P, P, C.c_char_p)
dispatch = api('libinput_dispatch', C.c_int, P)
get = api('libinput_get_event', P, P)
kind = api('libinput_event_get_type', C.c_int, P)
gesture = api('libinput_event_get_gesture_event', P, P)
scale = api('libinput_event_gesture_get_scale', C.c_double, P)
fingers = api('libinput_event_gesture_get_finger_count', C.c_int, P)
destroy = api('libinput_event_destroy', None, P)
unref = api('libinput_unref', P, P)
tap = api('libinput_device_config_tap_set_enabled', C.c_int, P, C.c_int)
has_capability = api('libinput_device_has_capability', C.c_int, P, C.c_int)

before = set(Path('/sys/class/input').glob('event*'))
proc = subprocess.Popen([sys.argv[1]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
ctx = None
try:
    assert proc.stdout.readline().strip() == 'ready', 'Could not create test touchpad'
    path = None
    for _ in range(100):
        for entry in set(Path('/sys/class/input').glob('event*')) - before:
            if (entry/'device/name').read_text().strip() == 'Ghostpad gestures':
                path = '/dev/input/' + entry.name
        if path and os.path.exists(path): break
        time.sleep(.02)
    assert path, 'No event node appeared for the test touchpad'
    # Give udev time to classify the device before libinput reads its properties.
    subprocess.run(['udevadm', 'settle', '--timeout=3'], check=True)
    @OPEN
    def open_device(name, flags, _):
        if os.fsdecode(name) != path: return -errno.EPERM
        try:
            fd = os.open(name, flags)
            try: fcntl.ioctl(fd, 0x40044590, 1)  # EVIOCGRAB
            except OSError:
                os.close(fd); raise
            return fd
        except OSError as error:
            print(f'Cannot exclusively read test device: {error}', file=sys.stderr)
            return -error.errno
    @CLOSE
    def close_device(fd, _): os.close(fd)
    interface = Interface(open_device, close_device)
    ctx = create(C.byref(interface), None)
    assert ctx, 'Could not create libinput context'
    device = add(ctx, path.encode())
    assert device, 'libinput did not accept the touchpad (or event-node access is denied)'
    assert has_capability(device, 5), 'Touchpad lacks native gesture capability'
    tap(device, 0)
    def collect():
        dispatch(ctx); events = []
        while event := get(ctx):
            k = kind(event)
            if k in (803,804,805):
                g = gesture(event); events.append((k,scale(g),fingers(g)))
            elif 300 <= k < 500:
                raise AssertionError(f'Unexpected pointer, wheel, or touch event: {k}')
            destroy(event)
        return events
    collect()
    def send(value):
        proc.stdin.write(str(value)+'\n'); proc.stdin.flush()
        assert proc.stdout.readline().strip() == 'ok'
        time.sleep(.012)
        return collect()
    for direction in (1,-1):
        events = []
        for i in range(1,41): events += send(1 + direction * i * .012)
        events += send('end')
        assert events[0][0] == 803 and events[-1][0] == 805, events
        updates = [e[1] for e in events if e[0] == 804]
        assert len(updates) >= 20, f'Too few continuous pinch updates: {events}'
        assert all(e[2] == 2 for e in events), events
        assert all(direction*(b-a) >= -1e-6 for a,b in zip(updates,updates[1:])), updates
        assert direction*(updates[-1]-1) > .25, updates
        print(f'Native pinch {"out" if direction>0 else "in"}: begin, {len(updates)} continuous updates, end; final scale {updates[-1]:.3f}')
    print('PASS: production uinput events produce native libinput pinches, without Ctrl or wheel events.')
finally:
    # Destroy the device while it is still exclusively grabbed.
    if proc.poll() is None:
        proc.stdin.close()
        try: proc.wait(timeout=3)
        except subprocess.TimeoutExpired: proc.kill(); proc.wait()
    if ctx: unref(ctx)
