#!/usr/bin/env python3
"""Type ASCII text directly into a libvirt QEMU guest through HMP sendkey."""

from __future__ import annotations

import argparse
import ctypes
import json
import time


SCANCODES = {
    "1": 0x02,
    "2": 0x03,
    "3": 0x04,
    "4": 0x05,
    "5": 0x06,
    "6": 0x07,
    "7": 0x08,
    "8": 0x09,
    "9": 0x0A,
    "0": 0x0B,
    "-": 0x0C,
    "=": 0x0D,
    "\b": 0x0E,
    "\t": 0x0F,
    "q": 0x10,
    "w": 0x11,
    "e": 0x12,
    "r": 0x13,
    "t": 0x14,
    "y": 0x15,
    "u": 0x16,
    "i": 0x17,
    "o": 0x18,
    "p": 0x19,
    "[": 0x1A,
    "]": 0x1B,
    "\n": 0x1C,
    "a": 0x1E,
    "s": 0x1F,
    "d": 0x20,
    "f": 0x21,
    "g": 0x22,
    "h": 0x23,
    "j": 0x24,
    "k": 0x25,
    "l": 0x26,
    ";": 0x27,
    "'": 0x28,
    "`": 0x29,
    "\\": 0x2B,
    "z": 0x2C,
    "x": 0x2D,
    "c": 0x2E,
    "v": 0x2F,
    "b": 0x30,
    "n": 0x31,
    "m": 0x32,
    ",": 0x33,
    ".": 0x34,
    "/": 0x35,
    " ": 0x39,
}

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
    "_": "-",
    "+": "=",
    "{": "[",
    "}": "]",
    "|": "\\",
    ":": ";",
    '"': "'",
    "~": "`",
    "<": ",",
    ">": ".",
    "?": "/",
}


class QemuMonitor:
    HMP_FLAG = 1

    def __init__(self, uri: str, uuid: str) -> None:
        self.libvirt = ctypes.CDLL("libvirt.so.0")
        self.qemu = ctypes.CDLL("libvirt-qemu.so.0")
        self.libvirt.virConnectOpen.argtypes = [ctypes.c_char_p]
        self.libvirt.virConnectOpen.restype = ctypes.c_void_p
        self.libvirt.virDomainLookupByUUIDString.argtypes = [
            ctypes.c_void_p,
            ctypes.c_char_p,
        ]
        self.libvirt.virDomainLookupByUUIDString.restype = ctypes.c_void_p
        self.libvirt.virDomainFree.argtypes = [ctypes.c_void_p]
        self.libvirt.virConnectClose.argtypes = [ctypes.c_void_p]
        self.qemu.virDomainQemuMonitorCommand.argtypes = [
            ctypes.c_void_p,
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_char_p),
            ctypes.c_uint,
        ]
        self.qemu.virDomainQemuMonitorCommand.restype = ctypes.c_int

        self.connection = self.libvirt.virConnectOpen(uri.encode("ascii"))
        if not self.connection:
            raise RuntimeError(f"Could not open libvirt connection {uri}")
        self.domain = self.libvirt.virDomainLookupByUUIDString(
            self.connection, uuid.encode("ascii")
        )
        if not self.domain:
            self.libvirt.virConnectClose(self.connection)
            raise RuntimeError(f"Could not find libvirt domain {uuid}")

    def close(self) -> None:
        self.libvirt.virDomainFree(self.domain)
        self.libvirt.virConnectClose(self.connection)

    def hmp(self, command: str) -> str:
        return self._monitor_command(command, self.HMP_FLAG)

    def qmp(self, command: dict[str, object]) -> str:
        return self._monitor_command(json.dumps(command), 0)

    def _monitor_command(self, command: str, flags: int) -> str:
        output = ctypes.c_char_p()
        result = self.qemu.virDomainQemuMonitorCommand(
            self.domain,
            command.encode("ascii"),
            ctypes.byref(output),
            flags,
        )
        if result < 0:
            raise RuntimeError(f"QEMU monitor command failed: {command}")
        return output.value.decode("utf-8", errors="replace") if output.value else ""


def qemu_key(char: str) -> str:
    shift = False
    base = char
    if char in SHIFTED:
        shift = True
        base = SHIFTED[char]
    elif char.isupper():
        shift = True
        base = char.lower()
    if base not in SCANCODES:
        raise ValueError(f"Unsupported character: {char!r}")
    raw = f"0x{SCANCODES[base]:x}"
    return f"shift-{raw}" if shift else raw


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uuid", required=True)
    parser.add_argument("--uri", default="qemu:///session")
    parser.add_argument("--hotkey", action="append", default=[])
    parser.add_argument("--text", default="")
    parser.add_argument("--enter", action="store_true")
    parser.add_argument("--delay", type=float, default=0.035)
    parser.add_argument("--hold-ms", type=int, default=20)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    monitor = QemuMonitor(args.uri, args.uuid)
    try:
        for keys in args.hotkey:
            monitor.hmp(f"sendkey {keys} {args.hold_ms}")
            time.sleep(1.5)
        for char in args.text:
            monitor.hmp(f"sendkey {qemu_key(char)} {args.hold_ms}")
            time.sleep(args.delay)
        if args.enter:
            monitor.hmp(f"sendkey 0x1c {args.hold_ms}")
    finally:
        monitor.close()


if __name__ == "__main__":
    main()
