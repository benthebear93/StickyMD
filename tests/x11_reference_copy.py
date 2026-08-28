#!/usr/bin/python3
"""Verify the live hover reference and paste-ready clipboard text."""

from __future__ import annotations

from pathlib import Path
import time

import gi
import pyatspi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gtk  # noqa: E402

from x11_backspace_regression import atomic_external_write, descendants
from x11_interaction import (
    click,
    geometry,
    load_libraries,
    send_show_desktop,
    showing_desktop,
    wait_for_ids,
    wait_show_desktop,
)


NOTE_PATH = Path.home() / "StickyNotes" / "note.md"
TEST_TEXT = "Reference copy live test\npending debounce"
EXPECTED_REFERENCE = (
    'Read StickyMD note "Reference copy live test" (#MAIN).\n'
    f"File: {NOTE_PATH}\n"
)


def primary_accessibles():
    """Return the editable text, reference label, and copy button nodes."""
    desktop = pyatspi.Registry.getDesktop(0)
    for application in descendants(desktop):
        if application.getRole() != pyatspi.ROLE_APPLICATION:
            continue
        if application.name != "stickymd":
            continue
        nodes = list(descendants(application))
        editor = next(
            (
                node
                for node in nodes
                if node.getRole() == pyatspi.ROLE_TEXT
                and node.getState().contains(pyatspi.STATE_EDITABLE)
            ),
            None,
        )
        reference = next((node for node in nodes if node.name == "#MAIN"), None)
        copy_button = next(
            (node for node in nodes if node.name == "Copy note reference"), None
        )
        if editor is not None and reference is not None and copy_button is not None:
            return editor, reference, copy_button
    raise RuntimeError("Could not find the primary note reference controls")


def wait_for_disk_text(expected: str, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    last_text = ""
    while time.monotonic() < deadline:
        last_text = NOTE_PATH.read_text(encoding="utf-8")
        if last_text == expected:
            return
        time.sleep(0.05)
    raise RuntimeError(f"note.md did not become {expected!r}; got {last_text!r}")


def main() -> int:
    if not NOTE_PATH.is_file():
        raise RuntimeError(f"Primary note does not exist: {NOTE_PATH}")
    original_text = NOTE_PATH.read_text(encoding="utf-8")
    clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
    original_clipboard_text = clipboard.wait_for_text()
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
        x, y, width, _height = geometry(window_id)
        click(xtst, x11, display, screen, x + width - 66, y + 20)
        editor, reference, copy_button = primary_accessibles()
        if reference.name != "#MAIN":
            raise RuntimeError(f"Unexpected primary short reference: {reference.name!r}")
        if not copy_button.getState().contains(pyatspi.STATE_SENSITIVE):
            raise RuntimeError("Copy reference button did not become active on hover")

        editor.queryEditableText().setTextContents(TEST_TEXT)
        time.sleep(0.05)
        click(xtst, x11, display, screen, x + width - 66, y + 20)
        time.sleep(0.15)

        copied_text = clipboard.wait_for_text()
        if copied_text != EXPECTED_REFERENCE:
            raise RuntimeError(
                f"Unexpected clipboard reference: expected {EXPECTED_REFERENCE!r}, "
                f"got {copied_text!r}"
            )
        wait_for_disk_text(TEST_TEXT)
        print("PASS: hover exposed #MAIN and the generic note reference control.")
        print("PASS: copy flushed pending editor text before the 400 ms debounce.")
        print("PASS: clipboard text contained the title, short code, and exact path.")
    finally:
        try:
            editor.queryEditableText().setTextContents(original_text)
        except (NameError, RuntimeError):
            pass
        atomic_external_write(NOTE_PATH, original_text)
        try:
            wait_for_disk_text(original_text)
        except RuntimeError:
            pass
        if original_clipboard_text is not None:
            clipboard.set_text(original_clipboard_text, -1)
            clipboard.store()
        if original_showing_desktop == 0:
            send_show_desktop(x11, display, root, False)
            wait_show_desktop(0)
        x11.XCloseDisplay(display)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
