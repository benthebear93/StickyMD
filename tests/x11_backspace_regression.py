#!/usr/bin/python3
"""Reproduce the delayed self-monitor event race in the live GTK editor."""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
import time

import pyatspi

from x11_interaction import (
    key,
    load_libraries,
    send_show_desktop,
    showing_desktop,
    tap_key,
    wait_for_ids,
    wait_show_desktop,
    click,
    geometry,
)


NOTE_PATH = Path.home() / "StickyNotes" / "note.md"
TEST_TEXT = "abcdef"
EXPECTED_AFTER_BACKSPACE = "abcde"
EXTERNAL_MARKER = "\nExternal edit regression"


def atomic_external_write(path: Path, text: str) -> None:
    """Replace a test file atomically in the same way a capable editor would."""
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.live-", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass
        raise


def descendants(node):
    """Yield an accessibility node and all its descendants."""
    if node is None:
        return
    yield node
    for index in range(node.childCount):
        yield from descendants(node.getChildAtIndex(index))


def editor_accessible():
    """Return the editable text node belonging to the primary sticky note."""
    desktop = pyatspi.Registry.getDesktop(0)
    for application in descendants(desktop):
        if application.getRole() != pyatspi.ROLE_APPLICATION:
            continue
        if application.name != "stickymd":
            continue
        for node in descendants(application):
            if node.getRole() != pyatspi.ROLE_TEXT:
                continue
            if node.getState().contains(pyatspi.STATE_EDITABLE):
                return node
    raise RuntimeError("Could not find the StickyMD editable text accessibility node")


def editor_text() -> str:
    node = editor_accessible()
    return node.queryText().getText(0, -1)


def wait_for_editor_text(expected: str, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    last_text = ""
    while time.monotonic() < deadline:
        last_text = editor_text()
        if last_text == expected:
            return
        time.sleep(0.05)
    raise RuntimeError(f"Editor text did not become {expected!r}; got {last_text!r}")


def main() -> int:
    if not NOTE_PATH.is_file():
        raise RuntimeError(f"Primary note does not exist: {NOTE_PATH}")
    original_text = NOTE_PATH.read_text(encoding="utf-8")
    x11, xtst = load_libraries()
    display = x11.XOpenDisplay(None)
    if not display:
        raise RuntimeError("Cannot connect to the active X11 display")
    screen = x11.XDefaultScreen(display)
    root = x11.XRootWindow(display, screen)
    original_showing_desktop = showing_desktop()

    try:
        send_show_desktop(x11, display, root, True)
        wait_show_desktop(1)
        window_id = wait_for_ids({"primary"})["primary"]
        x, y, _width, _height = geometry(window_id)
        click(xtst, x11, display, screen, x + 45, y + 75)

        key(xtst, x11, display, "Control_L", True)
        tap_key(xtst, x11, display, "a")
        key(xtst, x11, display, "Control_L", False)
        for character in TEST_TEXT:
            tap_key(xtst, x11, display, character)

        # Let the 400 ms save complete, then edit before its delayed 120 ms
        # filesystem-monitor reload. This timing reproduced the old bug.
        time.sleep(0.43)
        tap_key(xtst, x11, display, "BackSpace")
        time.sleep(0.75)

        disk_text = NOTE_PATH.read_text(encoding="utf-8")
        live_text = editor_text()
        if disk_text != EXPECTED_AFTER_BACKSPACE:
            raise RuntimeError(
                f"Backspace was not preserved on disk: expected "
                f"{EXPECTED_AFTER_BACKSPACE!r}, got {disk_text!r}"
            )
        if live_text != EXPECTED_AFTER_BACKSPACE:
            raise RuntimeError(
                f"Backspace was restored in the UI: expected "
                f"{EXPECTED_AFTER_BACKSPACE!r}, got {live_text!r}"
            )

        external_text = EXPECTED_AFTER_BACKSPACE + EXTERNAL_MARKER
        atomic_external_write(NOTE_PATH, external_text)
        wait_for_editor_text(external_text)
        print("PASS: delayed self-monitor event did not restore Backspaced text.")
        print("PASS: the debounced Backspace edit was atomically saved to note.md.")
        print("PASS: a true external atomic replacement still updated the live editor.")
    finally:
        atomic_external_write(NOTE_PATH, original_text)
        try:
            wait_for_editor_text(original_text)
        except RuntimeError:
            pass
        if original_showing_desktop == 0:
            send_show_desktop(x11, display, root, False)
            wait_show_desktop(0)
        x11.XCloseDisplay(display)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
