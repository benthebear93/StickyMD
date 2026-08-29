#!/usr/bin/env python3
"""Send deterministic keyboard input to one X11 window for VM smoke tests."""

from __future__ import annotations

import argparse
import ctypes
import time


X11 = ctypes.CDLL("libX11.so.6")
XTST = ctypes.CDLL("libXtst.so.6")

X11.XOpenDisplay.restype = ctypes.c_void_p
X11.XStringToKeysym.argtypes = [ctypes.c_char_p]
X11.XStringToKeysym.restype = ctypes.c_ulong
X11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
X11.XKeysymToKeycode.restype = ctypes.c_ubyte
X11.XGetGeometry.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_uint),
    ctypes.POINTER(ctypes.c_uint),
    ctypes.POINTER(ctypes.c_uint),
    ctypes.POINTER(ctypes.c_uint),
]
X11.XGetGeometry.restype = ctypes.c_int
X11.XTranslateCoordinates.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.c_ulong,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_ulong),
]
X11.XTranslateCoordinates.restype = ctypes.c_int
X11.XRaiseWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
X11.XSetInputFocus.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.c_int,
    ctypes.c_ulong,
]
X11.XFlush.argtypes = [ctypes.c_void_p]
XTST.XTestFakeKeyEvent.argtypes = [
    ctypes.c_void_p,
    ctypes.c_uint,
    ctypes.c_int,
    ctypes.c_ulong,
]
XTST.XTestFakeButtonEvent.argtypes = [
    ctypes.c_void_p,
    ctypes.c_uint,
    ctypes.c_int,
    ctypes.c_ulong,
]
XTST.XTestFakeMotionEvent.argtypes = [
    ctypes.c_void_p,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_ulong,
]


SHIFTED = {
    "!": "1",
    "@": "2",
    "#": "3",
    "$": "4",
    "%": "5",
    "^": "6",
    "&": "7",
    "*": "8",
    "(": "9",
    ")": "0",
    "_": "minus",
    "+": "equal",
    "{": "bracketleft",
    "}": "bracketright",
    "|": "backslash",
    ":": "semicolon",
    '"': "apostrophe",
    "<": "comma",
    ">": "period",
    "?": "slash",
    "~": "grave",
}

NAMED = {
    " ": "space",
    "-": "minus",
    "=": "equal",
    "[": "bracketleft",
    "]": "bracketright",
    "\\": "backslash",
    ";": "semicolon",
    "'": "apostrophe",
    ",": "comma",
    ".": "period",
    "/": "slash",
    "`": "grave",
    "\n": "Return",
    "\t": "Tab",
}


def keycode(display: int, name: str) -> int:
    keysym = X11.XStringToKeysym(name.encode("ascii"))
    code = X11.XKeysymToKeycode(display, keysym)
    if not code:
        raise ValueError(f"No X11 keycode for {name!r}")
    return code


def key_event(display: int, name: str, pressed: bool) -> None:
    XTST.XTestFakeKeyEvent(display, keycode(display, name), pressed, 0)


def tap(display: int, name: str, shift: bool = False) -> None:
    if shift:
        key_event(display, "Shift_L", True)
    key_event(display, name, True)
    key_event(display, name, False)
    if shift:
        key_event(display, "Shift_L", False)


def type_text(display: int, value: str, delay: float) -> None:
    for char in value:
        if char in SHIFTED:
            tap(display, SHIFTED[char], shift=True)
        elif char in NAMED:
            tap(display, NAMED[char])
        elif char.isupper():
            tap(display, char.lower(), shift=True)
        elif char.isascii() and char.isalnum():
            tap(display, char)
        else:
            raise ValueError(f"Unsupported character: {char!r}")
        time.sleep(delay)


def hotkey(display: int, specification: str) -> None:
    names = {
        "ctrl": "Control_L",
        "alt": "Alt_L",
        "shift": "Shift_L",
        "super": "Super_L",
        "enter": "Return",
        "esc": "Escape",
    }
    keys = [names.get(part.lower(), part) for part in specification.split("+")]
    for name in keys:
        key_event(display, name, True)
    for name in reversed(keys):
        key_event(display, name, False)


def focus_and_click(display: int, window: int) -> None:
    root = ctypes.c_ulong()
    x = ctypes.c_int()
    y = ctypes.c_int()
    width = ctypes.c_uint()
    height = ctypes.c_uint()
    border = ctypes.c_uint()
    depth = ctypes.c_uint()
    if not X11.XGetGeometry(
        display,
        window,
        ctypes.byref(root),
        ctypes.byref(x),
        ctypes.byref(y),
        ctypes.byref(width),
        ctypes.byref(height),
        ctypes.byref(border),
        ctypes.byref(depth),
    ):
        raise RuntimeError(f"Could not read X11 window 0x{window:x}")

    translated_x = ctypes.c_int()
    translated_y = ctypes.c_int()
    child = ctypes.c_ulong()
    X11.XTranslateCoordinates(
        display,
        window,
        root.value,
        width.value // 2,
        height.value // 2,
        ctypes.byref(translated_x),
        ctypes.byref(translated_y),
        ctypes.byref(child),
    )
    X11.XRaiseWindow(display, window)
    X11.XSetInputFocus(display, window, 1, 0)
    XTST.XTestFakeMotionEvent(
        display, -1, translated_x.value, translated_y.value, 0
    )
    XTST.XTestFakeButtonEvent(display, 1, True, 0)
    XTST.XTestFakeButtonEvent(display, 1, False, 0)
    X11.XFlush(display)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--window", required=True, type=lambda value: int(value, 0))
    parser.add_argument("--hotkey", action="append", default=[])
    parser.add_argument("--text", default="")
    parser.add_argument("--enter", action="store_true")
    parser.add_argument("--initial-delay", type=float, default=1.0)
    parser.add_argument("--key-delay", type=float, default=0.004)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    display = X11.XOpenDisplay(None)
    if not display:
        raise SystemExit("Could not open the X11 display")

    focus_and_click(display, args.window)
    time.sleep(args.initial_delay)
    for specification in args.hotkey:
        hotkey(display, specification)
        X11.XFlush(display)
        time.sleep(1.0)
    type_text(display, args.text, args.key_delay)
    if args.enter:
        tap(display, "Return")
    X11.XFlush(display)
    time.sleep(0.5)


if __name__ == "__main__":
    main()
