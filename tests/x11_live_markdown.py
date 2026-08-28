#!/usr/bin/python3
"""Verify live Markdown styling with isolated temporary note data."""

from __future__ import annotations

from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path
import tempfile


SOURCE = Path(__file__).resolve().parents[1] / "simple-sticky"
LOADER = SourceFileLoader("stickymd_live_markdown", str(SOURCE))
SPEC = spec_from_loader(LOADER.name, LOADER)
assert SPEC is not None
MODULE = module_from_spec(SPEC)
LOADER.exec_module(MODULE)

NOTE_ID = "abcdef123456"
INITIAL_TEXT = "# Live title\n\n- [ ] task\n\nThis is **bold text**.\n"
EXTERNAL_TEXT = "## External title\n\n- [x] done\n\n**changed**\n"


def main() -> int:
    if not MODULE.gtk_init_ok():
        raise RuntimeError("Cannot connect to the active X11 display")
    failures: list[BaseException] = []

    with tempfile.TemporaryDirectory(prefix="stickymd-live-markdown-") as directory:
        root = Path(directory)
        notes = root / "notes"
        state = root / "state.json"
        notes.mkdir()
        note_path = notes / f"note-{NOTE_ID}.md"
        MODULE.atomic_write_text(note_path, INITIAL_TEXT)
        geometry = {"x": 620, "y": 100, "width": 320, "height": 320}
        MODULE.save_registry(
            state,
            {NOTE_ID: {"file": note_path.name, **geometry}},
            [NOTE_ID],
        )
        application = MODULE.StickyApplication(notes, state)
        window = application.windows[NOTE_ID]
        buffer = window.text_view.get_buffer()

        def has_tag(offset: int, name: str) -> bool:
            return window._markdown_tags[name] in buffer.get_iter_at_offset(
                offset
            ).get_tags()

        def finish(error: BaseException | None = None) -> bool:
            if error is not None:
                failures.append(error)
            application.shutdown()
            return MODULE.GLib.SOURCE_REMOVE

        def verify_external() -> bool:
            try:
                if window._buffer_text() != EXTERNAL_TEXT:
                    raise RuntimeError("External Markdown text did not reload")
                window._apply_markdown_styles()
                if not has_tag(EXTERNAL_TEXT.index("External"), "heading-2"):
                    raise RuntimeError("Externally loaded heading was not styled")
                if not has_tag(EXTERNAL_TEXT.index("changed"), "bold"):
                    raise RuntimeError("Externally loaded bold text was not styled")
                if not has_tag(EXTERNAL_TEXT.index("[x]"), "checkbox-checked"):
                    raise RuntimeError("Externally loaded checkbox was not styled")
                print("PASS: external Markdown edits reloaded and restyled.")
                return finish()
            except BaseException as error:
                return finish(error)

        def verify_initial() -> bool:
            try:
                buffer.place_cursor(buffer.get_end_iter())
                window._apply_markdown_styles()
                if not has_tag(INITIAL_TEXT.index("Live title"), "heading-1"):
                    raise RuntimeError("Heading was not styled")
                if not has_tag(INITIAL_TEXT.index("bold text"), "bold"):
                    raise RuntimeError("Bold text was not styled")
                checkbox_offset = INITIAL_TEXT.index("[ ]")
                if not has_tag(checkbox_offset, "checkbox-unchecked"):
                    raise RuntimeError("Unchecked checkbox was not styled")
                if not has_tag(0, "syntax-hidden"):
                    raise RuntimeError("Inactive heading syntax was not hidden")
                bold_marker = INITIAL_TEXT.index("**")
                if not has_tag(bold_marker, "syntax-hidden"):
                    raise RuntimeError("Inactive bold syntax was not hidden")
                checkbox = MODULE.checkbox_span_at_offset(
                    window._markdown_spans, checkbox_offset + 1
                )
                if checkbox is None:
                    raise RuntimeError("Checkbox hit range was not available")
                window._toggle_checkbox(checkbox)
                window.flush_content()
                toggled = INITIAL_TEXT.replace("- [ ] task", "- [x] task")
                if note_path.read_text(encoding="utf-8") != toggled:
                    raise RuntimeError("Checkbox toggle did not save raw Markdown")
                print("PASS: heading, bold, and checkbox live tags were applied.")
                print("PASS: checkbox toggle saved the original Markdown syntax.")
                MODULE.atomic_write_text(note_path, EXTERNAL_TEXT)
                MODULE.GLib.timeout_add(450, verify_external)
            except BaseException as error:
                return finish(error)
            return MODULE.GLib.SOURCE_REMOVE

        MODULE.GLib.timeout_add(150, verify_initial)
        MODULE.Gtk.main()

    if failures:
        raise failures[0]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
