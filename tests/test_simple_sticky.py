"""Headless tests for StickyMD persistence, migration, trash, and resize math."""

from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import json
from pathlib import Path
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "simple-sticky"
LOADER = SourceFileLoader("stickymd_source", str(SOURCE))
SPEC = spec_from_loader(LOADER.name, LOADER)
assert SPEC is not None
MODULE = module_from_spec(SPEC)
LOADER.exec_module(MODULE)


class PersistenceTests(unittest.TestCase):
    def test_atomic_write_creates_plain_utf8_without_temporary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "note.md"
            text = "# Plain Markdown\n\n한글 and text\n"
            MODULE.atomic_write_text(path, text)
            self.assertEqual(path.read_text(encoding="utf-8"), text)
            self.assertEqual([item.name for item in path.parent.iterdir()], ["note.md"])

    def test_atomic_write_replaces_existing_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "note.md"
            MODULE.atomic_write_text(path, "first")
            MODULE.atomic_write_text(path, "second")
            self.assertEqual(path.read_bytes(), b"second")

    def test_atomic_write_signature_matches_the_read_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "note.md"
            written_signature = MODULE.atomic_write_text(path, "snapshot")
            text, read_signature = MODULE.read_utf8_snapshot(path)
            self.assertEqual(text, "snapshot")
            self.assertEqual(written_signature, read_signature)

    def test_delayed_self_event_does_not_restore_backspaced_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "note.md"
            self_signature = MODULE.atomic_write_text(path, "abcdef")
            disk_text, disk_signature = MODULE.read_utf8_snapshot(path)
            self.assertEqual(
                MODULE.classify_disk_snapshot(
                    disk_text, "abcde", disk_signature, self_signature
                ),
                "self",
            )

    def test_new_external_snapshot_still_wins_over_local_edits(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "note.md"
            self_signature = MODULE.atomic_write_text(path, "abcdef")
            MODULE.atomic_write_text(path, "external")
            disk_text, disk_signature = MODULE.read_utf8_snapshot(path)
            self.assertNotEqual(disk_signature, self_signature)
            self.assertEqual(
                MODULE.classify_disk_snapshot(
                    disk_text, "abcde", disk_signature, self_signature
                ),
                "external",
            )

    def test_legacy_state_migrates_without_touching_note_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            notes = root / "StickyNotes"
            state = root / "state" / "state.json"
            notes.mkdir()
            state.parent.mkdir()
            original = "Existing user content\nDo not lose this."
            (notes / "note.md").write_text(original, encoding="utf-8")
            legacy = {"x": -20, "y": 30, "width": 402, "height": 361}
            state.write_text(json.dumps(legacy), encoding="utf-8")

            records, order, changed = MODULE.load_registry(state, notes)

            self.assertTrue(changed)
            self.assertEqual(order, ["primary"])
            self.assertEqual(records["primary"], {"file": "note.md", **legacy})
            self.assertEqual((notes / "note.md").read_text(encoding="utf-8"), original)
            self.assertEqual(
                json.loads((state.parent / "state.v1.json.bak").read_text()), legacy
            )

    def test_v2_registry_round_trip_keeps_stable_ids_and_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            notes = root / "notes"
            state = root / "state.json"
            notes.mkdir()
            (notes / "note.md").write_text("primary", encoding="utf-8")
            (notes / "note-a1b2c3d4e5f6.md").write_text("second", encoding="utf-8")
            records = {
                "primary": {
                    "file": "note.md",
                    "x": 10,
                    "y": 20,
                    "width": 320,
                    "height": 320,
                },
                "a1b2c3d4e5f6": {
                    "file": "note-a1b2c3d4e5f6.md",
                    "x": 40,
                    "y": 50,
                    "width": 360,
                    "height": 280,
                },
            }
            order = ["primary", "a1b2c3d4e5f6"]
            MODULE.save_registry(state, records, order)
            loaded, loaded_order, changed = MODULE.load_registry(state, notes)
            self.assertFalse(changed)
            self.assertEqual(loaded, records)
            self.assertEqual(loaded_order, order)

    def test_explicit_empty_v2_registry_stays_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            notes = root / "notes"
            state = root / "state.json"
            notes.mkdir()
            MODULE.save_registry(state, {}, [])
            records, order, changed = MODULE.load_registry(
                state, notes, create_if_fresh=True
            )
            self.assertEqual(records, {})
            self.assertEqual(order, [])
            self.assertFalse(changed)
            self.assertFalse((notes / "note.md").exists())

    def test_restored_primary_file_is_enrolled_from_empty_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            notes = root / "notes"
            state = root / "state.json"
            notes.mkdir()
            MODULE.save_registry(state, {}, [])
            (notes / "note.md").write_text("restored", encoding="utf-8")
            records, order, changed = MODULE.load_registry(state, notes)
            self.assertTrue(changed)
            self.assertEqual(order, ["primary"])
            self.assertEqual(records["primary"]["file"], "note.md")

    def test_orphaned_stable_file_is_recovered_without_content_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            notes = root / "notes"
            state = root / "state.json"
            notes.mkdir()
            MODULE.save_registry(state, {}, [])
            orphan = notes / "note-012345abcdef.md"
            orphan.write_text("recover me", encoding="utf-8")
            records, order, changed = MODULE.load_registry(state, notes)
            self.assertTrue(changed)
            self.assertEqual(order, ["012345abcdef"])
            self.assertEqual(records["012345abcdef"]["file"], orphan.name)
            self.assertEqual(orphan.read_text(encoding="utf-8"), "recover me")

    def test_fallback_trash_is_recoverable_and_never_unlinks_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            note = root / "note-012345abcdef.md"
            fallback = root / ".trash"
            note.write_text("recoverable content", encoding="utf-8")
            destination = Path(
                MODULE.trash_note_file(note, fallback, try_system_trash=False)
            )
            self.assertFalse(note.exists())
            self.assertTrue(destination.is_file())
            self.assertEqual(destination.parent, fallback)
            self.assertEqual(destination.read_text(encoding="utf-8"), "recoverable content")

    def test_note_filename_accepts_only_supported_stable_ids(self):
        self.assertEqual(MODULE.note_filename("primary"), "note.md")
        self.assertEqual(
            MODULE.note_filename("012345abcdef"), "note-012345abcdef.md"
        )
        with self.assertRaises(ValueError):
            MODULE.note_filename("../../escape")

    def test_short_reference_is_stable_and_derived_from_the_note_id(self):
        self.assertEqual(MODULE.short_note_reference("primary"), "#MAIN")
        self.assertEqual(MODULE.short_note_reference("012345abcdef"), "#012345")
        with self.assertRaises(ValueError):
            MODULE.short_note_reference("not-a-note-id")

    def test_reference_title_uses_the_first_non_empty_normalized_line(self):
        self.assertEqual(
            MODULE.note_reference_title("\n   Weekly   plan  \nsecond"),
            "Weekly plan",
        )
        self.assertEqual(MODULE.note_reference_title(" \n\t"), "Untitled")
        self.assertEqual(MODULE.note_reference_title("abcdefgh", limit=6), "abcde…")

    def test_codex_reference_contains_title_code_and_exact_plain_file_path(self):
        path = Path("/home/example/StickyNotes/note-012345abcdef.md")
        self.assertEqual(
            MODULE.codex_reference_text(
                "012345abcdef", path, '장보기 "금요일"\n우유'
            ),
            'Read StickyMD note "장보기 \\"금요일\\"" (#012345).\n'
            "File: /home/example/StickyNotes/note-012345abcdef.md\n",
        )


class LiveMarkdownTests(unittest.TestCase):
    def test_parser_styles_only_titles_bold_and_checkboxes(self):
        text = (
            "# Main title\n"
            "## Second title\n"
            "### Third title\n"
            "#### Plain fourth level\n"
            "Use **bold text** here.\n"
            "- [ ] open task\n"
            "- [x] done task\n"
            "- ordinary list\n"
        )
        spans = MODULE.parse_live_markdown(text)
        by_kind = {kind: [] for kind in {
            span.kind for span in spans
        }}
        for span in spans:
            by_kind[span.kind].append(text[span.start:span.end])

        self.assertEqual(by_kind["heading-1"], ["Main title"])
        self.assertEqual(by_kind["heading-2"], ["Second title"])
        self.assertEqual(by_kind["heading-3"], ["Third title"])
        self.assertEqual(by_kind["bold"], ["bold text"])
        self.assertEqual(by_kind["checkbox-unchecked"], ["[ ]"])
        self.assertEqual(by_kind["checkbox-checked"], ["[x]"])
        self.assertNotIn("heading-4", by_kind)

    def test_parser_keeps_exact_source_ranges_for_unicode(self):
        text = "# 제목\n한글 **굵게** 표시\n"
        original = text
        spans = MODULE.parse_live_markdown(text)
        heading = next(span for span in spans if span.kind == "heading-1")
        bold = next(span for span in spans if span.kind == "bold")

        self.assertEqual(text[heading.start:heading.end], "제목")
        self.assertEqual(text[bold.start:bold.end], "굵게")
        self.assertEqual(
            [text[start:end] for start, end in bold.syntax], ["**", "**"]
        )
        self.assertEqual(text, original)

    def test_incomplete_markdown_remains_plain(self):
        text = "#\n## \n**unfinished\n- [y] not a checkbox\n"
        self.assertEqual(MODULE.parse_live_markdown(text), [])

    def test_checkbox_hit_testing_is_limited_to_the_marker(self):
        text = "- [ ] task"
        spans = MODULE.parse_live_markdown(text)
        checkbox = next(span for span in spans if span.kind.startswith("checkbox-"))

        self.assertIs(
            MODULE.checkbox_span_at_offset(spans, checkbox.start + 1), checkbox
        )
        self.assertIsNone(MODULE.checkbox_span_at_offset(spans, len(text) - 1))

    def test_presentation_tags_do_not_emit_content_changes(self):
        buffer = MODULE.Gtk.TextBuffer()
        tags = MODULE.StickyWindow._create_markdown_tags(buffer)
        buffer.set_text("# Heading\n**bold**\n- [ ] task")
        change_count = 0

        def on_changed(_buffer):
            nonlocal change_count
            change_count += 1

        buffer.connect("changed", on_changed)
        buffer.apply_tag(
            tags["heading-1"],
            buffer.get_iter_at_offset(2),
            buffer.get_iter_at_offset(9),
        )
        buffer.apply_tag(
            tags["syntax-hidden"],
            buffer.get_iter_at_offset(0),
            buffer.get_iter_at_offset(2),
        )

        self.assertEqual(change_count, 0)
        self.assertEqual(
            buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), True),
            "# Heading\n**bold**\n- [ ] task",
        )
        self.assertTrue(tags["syntax-hidden"].get_property("invisible"))


class ResizeMathTests(unittest.TestCase):
    START = {"x": 100, "y": 100, "width": 300, "height": 240}
    WORKAREA = (0, 0, 1000, 800)

    def test_all_eight_directions_resize(self):
        deltas = {
            "n": (0, -20),
            "s": (0, 20),
            "w": (-20, 0),
            "e": (20, 0),
            "nw": (-20, -20),
            "ne": (20, -20),
            "sw": (-20, 20),
            "se": (20, 20),
        }
        for direction, (dx, dy) in deltas.items():
            with self.subTest(direction=direction):
                result = MODULE.compute_resize_geometry(
                    direction, self.START, dx, dy, self.WORKAREA
                )
                self.assertNotEqual(result, self.START)
                self.assertGreaterEqual(result["width"], MODULE.MIN_WIDTH)
                self.assertGreaterEqual(result["height"], MODULE.MIN_HEIGHT)

    def test_west_and_north_resizes_keep_opposite_edges_fixed(self):
        start_right = self.START["x"] + self.START["width"]
        start_bottom = self.START["y"] + self.START["height"]
        for direction in ("w", "nw", "sw"):
            result = MODULE.compute_resize_geometry(
                direction, self.START, -35, -25, self.WORKAREA
            )
            self.assertEqual(result["x"] + result["width"], start_right)
        for direction in ("n", "nw", "ne"):
            result = MODULE.compute_resize_geometry(
                direction, self.START, -35, -25, self.WORKAREA
            )
            self.assertEqual(result["y"] + result["height"], start_bottom)

    def test_each_axis_stops_at_minimum_size(self):
        cases = {
            "w": (10000, 0),
            "e": (-10000, 0),
            "n": (0, 10000),
            "s": (0, -10000),
            "nw": (10000, 10000),
            "ne": (-10000, 10000),
            "sw": (10000, -10000),
            "se": (-10000, -10000),
        }
        for direction, (dx, dy) in cases.items():
            with self.subTest(direction=direction):
                result = MODULE.compute_resize_geometry(
                    direction, self.START, dx, dy, self.WORKAREA
                )
                if "w" in direction or "e" in direction:
                    self.assertEqual(result["width"], MODULE.MIN_WIDTH)
                if "n" in direction or "s" in direction:
                    self.assertEqual(result["height"], MODULE.MIN_HEIGHT)

    def test_new_note_is_fully_clamped_to_workarea(self):
        result = MODULE.clamp_new_geometry(
            {"x": 980, "y": 790, "width": 320, "height": 320}, self.WORKAREA
        )
        self.assertEqual(result, {"x": 680, "y": 480, "width": 320, "height": 320})


class ControlServerTests(unittest.TestCase):
    class FakeApplication:
        def __init__(self):
            self.windows = {}
            self.shutdown_calls = 0

        def create_note(self, source=None, focus=True):
            self.windows["012345abcdef"] = object()
            return "012345abcdef"

        def shutdown(self):
            self.shutdown_calls += 1

    def test_ensure_creates_only_when_the_running_app_has_no_notes(self):
        application = self.FakeApplication()
        server = MODULE.ControlServer.__new__(MODULE.ControlServer)
        server.application = application
        self.assertEqual(
            server._handle_command("ensure"), "OK created 012345abcdef"
        )
        self.assertEqual(server._handle_command("ensure"), "OK running 1")

    def test_quit_schedules_graceful_application_shutdown(self):
        application = self.FakeApplication()
        server = MODULE.ControlServer.__new__(MODULE.ControlServer)
        server.application = application
        self.assertEqual(server._handle_command("quit"), "OK quitting")
        context = MODULE.GLib.MainContext.default()
        while context.pending():
            context.iteration(False)
        self.assertEqual(application.shutdown_calls, 1)

    def test_start_and_quit_are_public_cli_commands(self):
        self.assertEqual(MODULE.parse_args(["start"]).command, "start")
        self.assertEqual(MODULE.parse_args(["quit"]).command, "quit")


if __name__ == "__main__":
    unittest.main()
