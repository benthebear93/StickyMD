# Implementation Report

## Scope and target environment

StickyMD 0.1.0 is the initial public release. It includes multiple independent
notes, recoverable deletion, eight-direction resizing, raw Markdown persistence,
external-file reload, login autostart, Codex-friendly note references, and a
GNOME top-panel control for creating, stopping, and restoring notes. The release
also includes protection against delayed filesystem-monitor events restoring a
character just removed with Backspace. It does not add direct Codex integration,
project links, MCP integration, Markdown rendering, themes, Electron, or a
normal-window fallback.

Detected and tested environment:

- Distribution: Ubuntu 22.04.5 LTS
- Desktop: `XDG_CURRENT_DESKTOP=ubuntu:GNOME`
- GNOME Shell: 42.9
- Session: `XDG_SESSION_TYPE=x11`, `DISPLAY=:0`
- GTK: 3.24.33
- PyGObject: 3.42.1

The implementation intentionally targets GNOME on X11. It rejects Wayland at
startup because an ordinary Wayland client cannot request GNOME Shell's desktop
layer.

## Modified files

- `simple-sticky`: multi-note application manager, state migration, one window
  and file monitor per note, exact self-written snapshot tracking, recoverable
  deletion, local control socket, `stickymd new/start/quit`, hover controls,
  Codex reference copying, and eight-direction resizing.
- `gnome-shell-extension/stickymd@local/`: minimal GNOME Shell 42 panel button
  with running/stopped indication, contextual start/new/quit menu commands, and
  primary-click new-or-restore behavior.
- `install.sh`: installs the `stickymd` command, compatibility command,
  autostart entry, New Sticky Note launcher, and user Shell extension; it also
  persists the extension UUID without replacing unrelated enabled extensions.
- `uninstall.sh`: disables and removes the Shell extension, commands, and
  launchers while preserving user data by default.
- `simple-sticky.desktop.in`: updated login autostart metadata.
- `stickymd.desktop.in`: GNOME application-grid launcher for starting StickyMD
  or restoring existing notes without a terminal.
- `stickymd-new.desktop.in`: new launcher that executes `stickymd new`.
- `tests/test_simple_sticky.py`: version-2 persistence, migration, Trash, ID,
  reference formatting, clamping, minimum-size, and eight-direction resize
  tests.
- `tests/x11_properties.sh`: validates every note's EWMH properties and checks
  that an available normal application window is stacked above all notes.
- `tests/x11_interaction.py`: XTest coverage for hover creation, `Ctrl+N`, all
  four edges and four corners, minimum size, and one-note deletion.
- `tests/x11_backspace_regression.py`: live XTest reproduction for the save,
  delayed monitor event, and Backspace ordering; it also confirms that a true
  external atomic replacement still reloads the editor.
- `tests/x11_reference_copy.py`: live hover, accessibility, immediate-save, and
  clipboard verification for the Codex reference control.
- `README.md`: install, update, use, storage, recovery, and test instructions.
- `.github/workflows/ci.yml`: read-only GitHub Actions checks on Ubuntu 22.04
  for Python tests, source syntax, extension metadata, shell scripts, and
  generated desktop entries.
- `.gitignore`: excludes local Python and packaging build artifacts.

The source executable retains its original `simple-sticky` filename to extend
the existing project safely. Installation exposes the preferred command as
`~/.local/bin/stickymd`.

## Architecture and storage

`StickyApplication` owns the versioned registry and a collection of
`StickyWindow` objects. Each `StickyWindow` independently owns its GTK text
buffer, 400 ms save debounce, filesystem monitor, pending reload, Markdown path,
and geometry.

Content remains ordinary UTF-8 text:

```text
~/StickyNotes/note.md
~/StickyNotes/note-<12-hex-character-stable-id>.md
```

The original file maps to stable ID `primary`; new note IDs are generated once
and persisted. UI state is separate:

```json
{
  "version": 2,
  "notes": {
    "primary": {
      "file": "note.md",
      "x": 2632,
      "y": 363,
      "width": 402,
      "height": 361
    }
  },
  "order": ["primary"]
}
```

All content and registry writes use a temporary file in the destination
directory, file `fsync`, `os.replace`, and directory `fsync`. A monitor watches
the note directory rather than one inode, so external atomic replacements are
also detected. A reload is applied only to the note whose filename generated
the event. Each content write records a signature containing device, inode,
size, and nanosecond modification time from the same descriptor that was
flushed. If its monitor event arrives after another local keystroke, that exact
self-written snapshot is ignored without cancelling the newer pending save.
An actually different disk snapshot remains authoritative.

Deletion first calls the GIO system Trash API. If unavailable, it atomically
moves the Markdown file to `~/StickyNotes/.trash/` with a timestamp and unique
suffix. The note's registry entry is removed only after the recoverable move
succeeds. No UI delete path calls `rm`.

The local mode-0600 UNIX socket at
`~/.local/state/simple-sticky/control.sock` lets `stickymd new` create a note in
the running process. If the process is absent, the command starts it with an
explicit create-on-start request. The process remains alive when the registry is
empty, so the same command also works after the last note is deleted. A plain
interactive `stickymd` invocation now performs an `ensure` request: it creates a
note if the running process is empty, or reports that existing notes can be seen
with GNOME Show Desktop. Login autostart does not recreate intentionally deleted
notes.

`stickymd quit` sends a local `quit` request instead of killing the process.
The GTK main loop first flushes every note, captures current geometry, atomically
saves the registry, cancels file monitors, closes the control socket, and then
exits. `stickymd start` launches the same login restore path without creating a
new note. Quitting therefore hides all notes and stops the Python process while
leaving every Markdown file and registry entry intact.

## GNOME panel integration

GNOME Shell 42 does not expose a native legacy tray to GTK applications. The
installed Ubuntu AppIndicator extension was detected, but no AppIndicator GI
binding was installed and its interaction model opens a menu rather than
performing the requested one-click action. StickyMD therefore uses a narrowly
scoped user Shell extension instead of changing the note windows or adding a
second daemon.

The extension creates one `PanelMenu.Button` in the right status area with the
standard `document-edit-symbolic` icon. It observes only the existence of the
mode-0600 control socket: the icon is fully opaque while running and dim while
stopped. Primary click invokes `stickymd new` when running and `stickymd start`
when stopped. The secondary-click menu contains current status/start, New note,
and Quit StickyMD entries. The panel control remains available after the GTK
process exits because it belongs to GNOME Shell, not to the application process.
Other panel or Shell behavior is not patched.

`~/.config/autostart/simple-sticky.desktop` starts the Python process after
login. Registered notes are mapped without an intentional focus request. When
the registry is empty, `--autostart` keeps the process alive with no note
windows, so the panel click can create the next one immediately. Deleting the
last note does not terminate this process.

## Codex reference UX

The existing hover control box now contains a stable reference label and a
standard `edit-copy-symbolic` button before the unchanged `+` and `×` buttons.
`primary` is shown as `#MAIN`; another stable ID such as `a1b2c3d4e5f6` is shown
as `#A1B2C3`. No filename, ID, or state format is changed.

The copy action derives a compact title from the first non-empty line, flushes
that note's pending content save, and copies a request containing the title,
short reference, and absolute Markdown path. The path is authoritative, so the
very unlikely case of two six-character prefixes matching remains unambiguous.
The action uses the standard X11 clipboard and does not communicate with Codex
or any external service.

## Legacy migration

The legacy flat geometry object is recognized automatically. Existing
`~/StickyNotes/note.md` is registered as `primary` at the same geometry; the
Markdown file is never rewritten, renamed, moved, or copied as part of
migration. Before replacing legacy state, its exact text is stored in
`~/.local/state/simple-sticky/state.v1.json.bak` if that backup does not already
exist.

On the implementation system, the pre-migration and post-migration `note.md`
SHA-256 values were both:

```text
1b5d6dacf5a5326bf991619cb325126ff2920d072e7565eee7e959f9c6d93980
```

The original 402×361 size and `(2632, 363)` position were also restored exactly.
Missing registry entries for supported Markdown filenames are re-enrolled on a
later restart without changing their content. This makes Trash restoration
recoverable.

During post-test cleanup, an automated pointer sequence also activated the
`primary` delete control after the three intended test notes. The resulting
empty registry explained a later “already running” process with no windows. The
system Trash entry `trash:///note.md` was restored immediately; its SHA-256
matched the pre-migration backup exactly, and the original
`(2632, 363, 402, 361)` geometry was restored through the live window so the app
persisted it atomically. No original note content was lost. The cleanup helper
is not part of the installed application.

## Resize implementation

The content is surrounded by a GTK 3×3 grid of separate 8 px event boxes:

```text
NW       N       NE
W     content     E
SW       S       SE
```

The corner widgets occupy their own cells, so they win over edge hit areas.
Each cell has the corresponding X11 resize cursor. Text selection, scrolling,
top-strip movement, and hover buttons remain outside these hit cells.

At button press, resize captures an immutable starting geometry, root-pointer
position, direction, and monitor work area. Every motion recomputes the result
from that same snapshot instead of accumulating intermediate positions. West
and north operations therefore move the origin while keeping the opposite edge
fixed, without drift or pointer-rounding accumulation. GDK root coordinates are
rounded only when converted to integer X11 geometry, which keeps behavior stable
under logical/fractional desktop scaling.

The calculation enforces 160×120 minimum size and clamps the dragged edge to the
monitor work area. Configure events update only that note's registry entry after
a 400 ms debounce.

## Verification record

### Automated and live checks completed

- PASS — the GitHub Actions workflow syntax parsed locally, and every command
  used by the workflow completed successfully against the release tree.
- PASS — Python compilation completed for the application and four Python test
  files; shell syntax completed for install, uninstall, and property scripts.
- PASS — 22 headless unit tests covered atomic UTF-8 replacement, exact written
  snapshot identity, delayed self-event classification, true external-event
  classification, stable short-reference derivation, first-line title
  normalization, exact clipboard payload construction, v1 migration without
  content mutation, v2 registry round-trip, explicit empty registry,
  restored/orphan enrollment, recoverable fallback Trash, stable filename
  validation, all eight resize directions, fixed west/north opposite edges,
  minimum size, work-area clamping, the zero-note `ensure` control command,
  graceful quit dispatch, and public `new/start/quit` command parsing.
- PASS — `stickymd quit` removed the control socket and every StickyMD X11
  window after flushing. The active `note.md` and state-file SHA-256 values were
  unchanged. `stickymd start` restored exactly one registered `primary` window
  at `(118, 75, 414, 431)` without creating another note.
- PASS — after a GNOME X11 Shell reload, the installed extension exposed
  `StickyMD: running; click to create a note` through the
  accessibility tree. Its secondary-click menu exposed running status, New
  note, and Quit StickyMD entries.
- PASS — the original failure was reproduced in the live GTK editor by typing
  `abcdef`, waiting 430 ms for the 400 ms save, pressing Backspace before the
  delayed monitor reload, and observing the old build restore `abcdef` in both
  the UI and `note.md`.
- PASS — the initial public build passed that same live timing test: both the
  accessibility text and `note.md` remained `abcde`, and the new 400 ms save
  completed normally.
- PASS — an external atomic replacement immediately after that regression test
  still updated the live editor. The test restored the original note content
  and prior GNOME Show Desktop state in a `finally` block.
- PASS — the installed window exposed `#MAIN` and `Copy Codex reference`
  through GTK accessibility while hovered.
- PASS — the live reference test changed editor text and clicked copy after
  only 50 ms. The Markdown file already contained the new text, proving the
  action flushed the pending 400 ms debounce before updating the clipboard.
- PASS — the live clipboard payload contained the normalized first-line title,
  `#MAIN`, and the exact absolute `note.md` path. The test restored the original
  note and clipboard text afterward.
- PASS — a root-window crop was visually inspected with the note temporarily
  placed in an uncovered area. `#MAIN`, the copy icon, `+`, and `×` were compact
  and aligned in the existing top strip without shifting the editor. The note
  was restored exactly to `(72, 27, 425, 376)`.
- PASS — isolated user-local install, update, normal uninstall, and purge flows
  were exercised with a temporary home layout. Generated installed `.desktop`
  files passed `desktop-file-validate`.
- PASS — a live `stickymd new` invocation created stable ID `b0eb2f489671` and
  its independent Markdown file.
- PASS — the live interaction test created two notes through hover `+` and a
  third through `Ctrl+N`, for at least three simultaneously created notes.
- PASS — the interaction test resized one real X11 window from all four edges
  and four corners. Every relevant opposite edge remained fixed.
- PASS — shrinking far past the limit stopped at exactly 160×120.
- PASS — deleting only stable ID `dee2179b8b66` removed only its window and state
  entry. `gio trash --list` reported
  `trash:///note-dee2179b8b66.md`; other note windows and files remained.
- PASS — external terminal writes to three distinct test Markdown files caused
  three independent reload log entries with their matching stable IDs and
  different content digests. No note overwrote another.
- PASS — XTest key input in the topmost test note produced
  `uiautosavetest` in that note's ordinary Markdown file after the save
  debounce.
- PASS — after graceful shutdown and restart, four registered file hashes were
  unchanged, all content digests matched, and every live geometry equaled its
  state entry exactly:

  ```text
  primary       (2632, 363, 402, 361)
  b0eb2f489671  (2660, 391, 320, 320)
  ddddcd7d33f5  (2688, 419, 320, 320)
  bfc6c596d7a9  (2716, 447, 320, 320)
  ```

- PASS — every live note advertised `_NET_WM_WINDOW_TYPE_DESKTOP`, `BELOW`,
  `STICKY`, `SKIP_TASKBAR`, `SKIP_PAGER`, and all-workspace desktop ID
  `4294967295`.
- PASS — `_NET_CLIENT_LIST_STACKING` placed all StickyMD windows below a live
  `_NET_WM_WINDOW_TYPE_NORMAL` Chrome window and two normal terminal windows.
  Raising a note therefore remains constrained to the desktop layer.
- PASS — the interaction test enabled GNOME Show Desktop, continued locating
  and operating the notes there, and restored the original Show Desktop state
  in a `finally` block.
- PASS — a later 3840×2160 root-window capture was visually inspected while
  GNOME Show Desktop was active. It showed the restored white `primary` note and
  its original text above the wallpaper; the script then restored
  `_NET_SHOWING_DESKTOP = 0`.
- PASS — the installed login autostart, main StickyMD launcher, and New Sticky
  Note launcher all passed desktop-entry validation.
- PASS — `gtk-launch stickymd` exercised the terminal-free main launcher while
  one note existed. The background PID and state-file SHA-256 were identical
  before and after, proving it neither restarted the process nor duplicated the
  existing note.
- PASS — the local `stickymd@local` extension was discovered after the standard
  GNOME X11 Shell reload, enabled alongside the existing Ubuntu extensions, and
  reported no errors through `org.gnome.Shell.Extensions`.
- PASS — the accessibility tree exposed `StickyMD: create a new note` in the
  right panel at `(3576, 0, 58, 27)`, and a 3840×2160 screenshot visually
  confirmed the small panel icon.
- PASS — a real XTest primary click at the panel control while the registry was
  empty created exactly one `primary` note, a 320×320 live desktop-layer window,
  one state entry, and `~/StickyNotes/note.md` without a terminal command.
- PASS — the final Show Desktop capture showed the restored note text and the
  small panel control together; the test restored the prior Show Desktop state
  immediately afterward.
- PASS — the pre-existing 21-byte user content was separately confirmed in
  system Trash by SHA-256 and atomically restored to the active `note.md`; the
  Trash recovery copy remains available.
- PASS — after verification, the three remaining test-created Markdown files
  were removed through their live `×` controls and confirmed in system Trash.
  The active registry again contains only `primary`, and its original content
  hash and geometry remain unchanged.

### Short manual visual checklist

The final Show Desktop composition has been captured and inspected, but the
Shell switcher, pointer cursor shapes, and login behavior still require a brief
visual confirmation:

1. Move the pointer away from every note, then over one note. Confirm `+` and
   `×` are hidden normally, appear only on hover, and do not shift text layout.
2. Hover all four edges and four corners and confirm the eight directional
   cursors. Drag the left and top boundaries and visually confirm the right and
   bottom boundaries stay fixed.
3. Put a terminal directly over the notes; confirm it fully covers them. Open
   Alt+Tab and inspect the Dock to confirm StickyMD is absent.
4. Log out and back in once. Confirm registered notes appear at their saved
   positions without taking keyboard focus and the StickyMD panel button is
   present without running a terminal command.
5. Right-click the panel icon and select Quit StickyMD. Confirm all notes
   disappear and the icon dims; left-click the dim icon and confirm the same
   notes return without an extra blank note.
6. For an optional last-note test, move every note to Trash with `×`, run
   `~/.local/bin/stickymd new`, and confirm one blank note appears. Restore the
   prior files from Trash and restart StickyMD afterward.

## Remaining limitations

- GNOME X11 is the only supported desktop/session combination. There is no
  Wayland or cross-desktop fallback.
- The panel helper is intentionally pinned to GNOME Shell 42. A first local
  install can require one `Alt+F2`, `r` Shell reload; subsequent logins load the
  enabled extension automatically.
- Panel running state is inferred from the local control socket once per second.
  A hard crash can leave the icon looking active briefly; normal panel/CLI quit
  removes the socket before exit.
- Concurrent edits to the same note are not merged. An external disk edit wins
  over pending unsaved UI content for that one file.
- Restoring a deleted file while StickyMD is running requires an application
  restart before the restored filename is re-enrolled.
- Final Alt+Tab, Dock, cursor appearance, and login visuals require the manual
  checks above even though their underlying X11 hints and geometry were verified.
