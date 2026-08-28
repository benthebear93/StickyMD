#!/usr/bin/python3
"""Exercise live multi-note controls and all eight X11 resize directions."""

from __future__ import annotations

import ctypes
import json
from pathlib import Path
import re
import subprocess
import time


BUTTON1 = 1
CLIENT_MESSAGE = 33
SUBSTRUCTURE_NOTIFY_MASK = 1 << 19
SUBSTRUCTURE_REDIRECT_MASK = 1 << 20
MIN_WIDTH = 160
MIN_HEIGHT = 120


class ClientMessageData(ctypes.Union):
    _fields_ = [
        ("b", ctypes.c_char * 20),
        ("s", ctypes.c_short * 10),
        ("l", ctypes.c_long * 5),
    ]


class ClientMessageEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("serial", ctypes.c_ulong),
        ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p),
        ("window", ctypes.c_ulong),
        ("message_type", ctypes.c_ulong),
        ("format", ctypes.c_int),
        ("data", ClientMessageData),
    ]


class XEvent(ctypes.Union):
    _fields_ = [
        ("type", ctypes.c_int),
        ("xclient", ClientMessageEvent),
        ("padding", ctypes.c_long * 24),
    ]


def load_libraries() -> tuple[ctypes.CDLL, ctypes.CDLL]:
    x11 = ctypes.CDLL("libX11.so.6")
    xtst = ctypes.CDLL("libXtst.so.6")
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XDefaultScreen.argtypes = [ctypes.c_void_p]
    x11.XDefaultScreen.restype = ctypes.c_int
    x11.XRootWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XRootWindow.restype = ctypes.c_ulong
    x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    x11.XInternAtom.restype = ctypes.c_ulong
    x11.XSendEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_long,
        ctypes.POINTER(XEvent),
    ]
    x11.XSendEvent.restype = ctypes.c_int
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
    x11.XStringToKeysym.restype = ctypes.c_ulong
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XKeysymToKeycode.restype = ctypes.c_uint
    xtst.XTestFakeMotionEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    xtst.XTestFakeButtonEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    xtst.XTestFakeKeyEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    return x11, xtst


def state_path() -> Path:
    return Path.home() / ".local" / "state" / "simple-sticky" / "state.json"


def read_state() -> dict:
    return json.loads(state_path().read_text(encoding="utf-8"))


def find_windows() -> dict[str, int]:
    tree = subprocess.check_output(
        ["xwininfo", "-root", "-tree"], text=True, encoding="utf-8"
    )
    pattern = re.compile(
        r'^\s*(0x[0-9a-f]+) "StickyMD \[([^]]+)\]": '
        r'\("stickymd" "StickyMD"\)',
        re.MULTILINE,
    )
    return {note_id: int(xid, 16) for xid, note_id in pattern.findall(tree)}


def wait_for_ids(expected: set[str], timeout: float = 4.0) -> dict[str, int]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        windows = find_windows()
        if set(windows) == expected:
            return windows
        time.sleep(0.1)
    raise RuntimeError(f"Window IDs did not become {sorted(expected)}")


def geometry(window_id: int) -> tuple[int, int, int, int]:
    output = subprocess.check_output(
        ["xwininfo", "-id", hex(window_id)], text=True, encoding="utf-8"
    )

    def value(label: str) -> int:
        match = re.search(rf"^\s*{re.escape(label)}:\s+(-?\d+)$", output, re.MULTILINE)
        if match is None:
            raise RuntimeError(f"Missing {label} in xwininfo output")
        return int(match.group(1))

    return (
        value("Absolute upper-left X"),
        value("Absolute upper-left Y"),
        value("Width"),
        value("Height"),
    )


def showing_desktop() -> int:
    output = subprocess.check_output(
        ["xprop", "-root", "_NET_SHOWING_DESKTOP"], text=True, encoding="utf-8"
    )
    match = re.search(r"=\s+(\d+)", output)
    if match is None:
        raise RuntimeError("Window manager does not expose _NET_SHOWING_DESKTOP")
    return int(match.group(1))


def send_show_desktop(
    x11: ctypes.CDLL, display: int, root: int, enabled: bool
) -> None:
    atom = x11.XInternAtom(display, b"_NET_SHOWING_DESKTOP", False)
    event = XEvent()
    event.xclient.type = CLIENT_MESSAGE
    event.xclient.send_event = True
    event.xclient.display = display
    event.xclient.window = root
    event.xclient.message_type = atom
    event.xclient.format = 32
    event.xclient.data.l[0] = 1 if enabled else 0
    result = x11.XSendEvent(
        display,
        root,
        False,
        SUBSTRUCTURE_NOTIFY_MASK | SUBSTRUCTURE_REDIRECT_MASK,
        ctypes.byref(event),
    )
    x11.XFlush(display)
    if result == 0:
        raise RuntimeError("XSendEvent rejected _NET_SHOWING_DESKTOP")


def wait_show_desktop(expected: int) -> None:
    for _attempt in range(30):
        if showing_desktop() == expected:
            return
        time.sleep(0.1)
    raise RuntimeError(f"_NET_SHOWING_DESKTOP did not become {expected}")


def motion(
    xtst: ctypes.CDLL, x11: ctypes.CDLL, display: int, screen: int, x: int, y: int
) -> None:
    xtst.XTestFakeMotionEvent(display, screen, x, y, 0)
    x11.XFlush(display)
    time.sleep(0.08)


def button(
    xtst: ctypes.CDLL, x11: ctypes.CDLL, display: int, pressed: bool
) -> None:
    xtst.XTestFakeButtonEvent(display, BUTTON1, pressed, 0)
    x11.XFlush(display)
    time.sleep(0.08)


def click(
    xtst: ctypes.CDLL,
    x11: ctypes.CDLL,
    display: int,
    screen: int,
    x: int,
    y: int,
) -> None:
    motion(xtst, x11, display, screen, x, y)
    button(xtst, x11, display, True)
    button(xtst, x11, display, False)


def key(
    xtst: ctypes.CDLL,
    x11: ctypes.CDLL,
    display: int,
    name: str,
    pressed: bool,
) -> None:
    keysym = x11.XStringToKeysym(name.encode("ascii"))
    keycode = x11.XKeysymToKeycode(display, keysym)
    if keycode == 0:
        raise RuntimeError(f"No X11 keycode for {name}")
    xtst.XTestFakeKeyEvent(display, keycode, pressed, 0)
    x11.XFlush(display)
    time.sleep(0.025)


def tap_key(
    xtst: ctypes.CDLL, x11: ctypes.CDLL, display: int, name: str
) -> None:
    key(xtst, x11, display, name, True)
    key(xtst, x11, display, name, False)


def ctrl_n(xtst: ctypes.CDLL, x11: ctypes.CDLL, display: int) -> None:
    key(xtst, x11, display, "Control_L", True)
    tap_key(xtst, x11, display, "n")
    key(xtst, x11, display, "Control_L", False)


def drag(
    xtst: ctypes.CDLL,
    x11: ctypes.CDLL,
    display: int,
    screen: int,
    start: tuple[int, int],
    delta: tuple[int, int],
) -> None:
    motion(xtst, x11, display, screen, *start)
    button(xtst, x11, display, True)
    motion(xtst, x11, display, screen, start[0] + delta[0], start[1] + delta[1])
    button(xtst, x11, display, False)
    time.sleep(0.45)


def resize_point(direction: str, current: tuple[int, int, int, int]) -> tuple[int, int]:
    x, y, width, height = current
    horizontal = x + width // 2
    vertical = y + height // 2
    point_x = x + 3 if "w" in direction else x + width - 4 if "e" in direction else horizontal
    point_y = y + 3 if "n" in direction else y + height - 4 if "s" in direction else vertical
    return point_x, point_y


def assert_fixed_edges(
    direction: str,
    before: tuple[int, int, int, int],
    after: tuple[int, int, int, int],
) -> None:
    bx, by, bw, bh = before
    ax, ay, aw, ah = after
    if "w" in direction and bx + bw != ax + aw:
        raise RuntimeError(f"{direction}: east edge drifted")
    if "e" in direction and bx != ax:
        raise RuntimeError(f"{direction}: west edge drifted")
    if "n" in direction and by + bh != ay + ah:
        raise RuntimeError(f"{direction}: south edge drifted")
    if "s" in direction and by != ay:
        raise RuntimeError(f"{direction}: north edge drifted")


def main() -> int:
    x11, xtst = load_libraries()
    display = x11.XOpenDisplay(None)
    if not display:
        raise RuntimeError("Cannot connect to the active X11 display")
    screen = x11.XDefaultScreen(display)
    root = x11.XRootWindow(display, screen)
    original_showing_desktop = showing_desktop()
    created_ids: list[str] = []

    try:
        send_show_desktop(x11, display, root, True)
        wait_show_desktop(1)
        initial_state = read_state()
        initial_ids = set(initial_state["notes"])
        if not initial_ids:
            raise RuntimeError("Run `stickymd new` before the interaction test")
        windows = wait_for_ids(initial_ids)
        source_id = initial_state["order"][-1]

        # Hover over and click the small plus button twice.
        for _index in range(2):
            current = geometry(windows[source_id])
            x, y, width, _height = current
            click(xtst, x11, display, screen, x + width - 43, y + 20)
            new_state = read_state()
            new_ids = set(new_state["notes"]) - set(windows)
            if len(new_ids) != 1:
                raise RuntimeError("Hover plus button did not create exactly one note")
            source_id = new_ids.pop()
            created_ids.append(source_id)
            windows = wait_for_ids(set(new_state["notes"]))

        # Ctrl+N creates another note and gives it editor focus.
        ctrl_n(xtst, x11, display)
        time.sleep(0.5)
        new_state = read_state()
        new_ids = set(new_state["notes"]) - set(windows)
        if len(new_ids) != 1:
            raise RuntimeError("Ctrl+N did not create exactly one note")
        delete_id = new_ids.pop()
        created_ids.append(delete_id)
        windows = wait_for_ids(set(new_state["notes"]))

        # Exercise every edge and corner on the topmost Ctrl+N note.
        resize_id = delete_id
        xid = windows[resize_id]
        deltas = {
            "n": (0, -12),
            "s": (0, 12),
            "w": (-12, 0),
            "e": (12, 0),
            "nw": (-12, -12),
            "ne": (12, -12),
            "sw": (-12, 12),
            "se": (12, 12),
        }
        for direction, delta in deltas.items():
            before = geometry(xid)
            drag(
                xtst,
                x11,
                display,
                screen,
                resize_point(direction, before),
                delta,
            )
            after = geometry(xid)
            if after == before:
                raise RuntimeError(f"{direction}: resize did not change geometry")
            assert_fixed_edges(direction, before, after)

        # Shrink from the lower-right far past the limit.
        before_min = geometry(xid)
        drag(
            xtst,
            x11,
            display,
            screen,
            resize_point("se", before_min),
            (-2000, -2000),
        )
        at_minimum = geometry(xid)
        if at_minimum[2:] != (MIN_WIDTH, MIN_HEIGHT):
            raise RuntimeError(f"Minimum size was not enforced: {at_minimum}")

        # Delete only this test note through the hover delete button.
        state_before_delete = read_state()
        filename = state_before_delete["notes"][delete_id]["file"]
        x, y, width, _height = geometry(xid)
        click(xtst, x11, display, screen, x + width - 20, y + 20)
        expected_ids = set(state_before_delete["notes"]) - {delete_id}
        wait_for_ids(expected_ids)
        deleted_source = Path.home() / "StickyNotes" / filename
        if deleted_source.exists():
            raise RuntimeError("Deleted Markdown file is still in the active note directory")
        state_after_delete = read_state()
        if delete_id in state_after_delete["notes"]:
            raise RuntimeError("Deleted note remains in state.json")
        if not created_ids[:-1]:
            raise RuntimeError("Other notes were unexpectedly removed")

        print("PASS: hover + created two independent notes.")
        print("PASS: Ctrl+N created and focused a third independent note.")
        print("PASS: all four edges and four corners resized with fixed opposite edges.")
        print("PASS: live resize stopped at 160x120.")
        print(f"PASS: deleted only {filename}; other note windows remain.")
        print("CREATED_REMAINING=" + ",".join(created_ids[:-1]))
        print("DELETED_FILE=" + filename)
    finally:
        if original_showing_desktop == 0:
            send_show_desktop(x11, display, root, False)
            wait_show_desktop(0)
        x11.XCloseDisplay(display)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
