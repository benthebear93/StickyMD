# StickyMD

StickyMD is a small native GTK3 sticky-note application for the detected target
environment: Ubuntu 22.04.5 LTS, GNOME Shell 42.9, and X11. It supports multiple
independent plain-text Markdown notes without rendering Markdown.

After a one-time install, no terminal is needed for normal use. A small
StickyMD button remains in the GNOME top-right panel while the background
process is available. A primary-button click creates a new note. Login
autostart restores all registered notes; deleting the final note leaves the
process and panel control running.

Every note is a real X11 desktop-layer window. StickyMD requests
`_NET_WM_WINDOW_TYPE_DESKTOP`, `BELOW`, `STICKY`, `SKIP_TASKBAR`, and
`SKIP_PAGER`; it never uses always-on-top. Consequently, notes remain above the
wallpaper and visible in Show Desktop, while ordinary application windows remain
above them. They are also omitted from Alt+Tab, the Dock, the taskbar, and the
workspace switcher.

This implementation deliberately supports GNOME X11 only. It exits with an
error on Wayland instead of silently substituting a normal application window.

## Dependencies

Runtime dependencies:

- Python 3.10 or newer
- `python3-gi`
- `gir1.2-gtk-3.0`
- `libgtk-3-0`
- GNOME Shell 42 with the `gnome-extensions` command
- an X11 GNOME session

On Ubuntu 22.04, install missing runtime packages with:

```bash
sudo apt install python3-gi gir1.2-gtk-3.0 libgtk-3-0
```

The optional live tests also require `x11-utils` and `libxtst6`.

## Install, update, and run

Install into the current user's home directory and start StickyMD:

```bash
./install.sh
~/.local/bin/stickymd
```

No `sudo` is used by the installer. It installs:

- `~/.local/bin/stickymd`
- `~/.local/bin/simple-sticky` as a compatibility command
- `~/.config/autostart/simple-sticky.desktop` for login startup
- `~/.local/share/applications/stickymd.desktop` as the main **StickyMD** app
  launcher
- `~/.local/share/applications/stickymd-new.desktop` as the **New Sticky Note**
  launcher
- `~/.local/share/gnome-shell/extensions/stickymd@local/` as the top-panel
  button

The installer enables the panel extension persistently. GNOME Shell 42 may not
discover a newly installed local extension until the next login. On the first
install only, press `Alt+F2`, type `r`, and press Enter to reload GNOME Shell in
the current X11 session. Updates to an already discovered extension are reloaded
automatically.

To update an existing installation, run `./install.sh` again. If StickyMD is
already running, restart that process so it loads the new executable:

```bash
kill -TERM "$(cat ~/.local/state/simple-sticky/app.lock)"
~/.local/bin/stickymd
```

Login startup maps restored notes without deliberately taking keyboard focus.
Starting a second ordinary instance is harmless; the application uses one
process and one window per registered note.

Diagnostics are available without opening a window:

```bash
~/.local/bin/stickymd --diagnose
```

## Use

- Launch **StickyMD** from the GNOME application grid to start the background
  process and restore existing notes without opening a terminal. If it is
  already running, existing notes are left unchanged.
- Primary-click the small document/edit icon in the GNOME top-right panel to
  create a note. This also starts StickyMD if the process is not running.
- Edit Markdown source directly as plain multiline text.
- Hover over a note to reveal its stable short reference, a copy icon, `+`, and
  `×`. The first note is `#MAIN`; later notes use the first six uppercase
  characters of their stable ID, such as `#A1B2C3`.
- Click the copy icon to place a paste-ready Codex request on the clipboard:

  ```text
  Read StickyMD note "Weekly plan" (#A1B2C3).
  File: /home/user/StickyNotes/note-a1b2c3d4e5f6.md
  ```

  The title comes from the first non-empty content line. Copying synchronously
  finishes any pending debounced save, so the referenced file already contains
  the latest editor text when the request is pasted into Codex.
- Click `+` or press `Ctrl+N` to create a blank 320×320 note.
- Run `~/.local/bin/stickymd new` to create a note even when no note windows
  exist. The installed **New Sticky Note** launcher runs the same command.
- Running `~/.local/bin/stickymd` again creates a note when the running process
  has zero notes. If notes already exist, it prints a reminder to use GNOME Show
  Desktop because ordinary windows intentionally cover the desktop-note layer.
- Click `×` to remove only that note and move its Markdown file to a recoverable
  Trash location. The application process and panel button remain available
  after the final note is removed.
- Drag the empty part of the 24 px top strip to move a note.
- Drag the 8 px border on any of four edges or four corners to resize. Minimum
  size is 160×120.

Clicking an overlapped note raises it only within the desktop-note layer. It
does not raise the note over ordinary application windows.

## Data layout and migration

Each note owns one human-readable UTF-8 Markdown file:

```text
~/StickyNotes/
├── note.md
├── note-<stable-id>.md
└── note-<stable-id>.md
```

The original `~/StickyNotes/note.md` remains the `primary` note. Migration never
renames, moves, truncates, or rewrites that file. New notes receive a stable
12-character hexadecimal ID that remains unchanged across restarts.
The hover short reference is derived from this existing ID and requires no new
metadata. The exact Markdown path in the copied request remains the canonical
identifier.

Position, size, ordering, stable IDs, and filenames are stored separately in:

```text
~/.local/state/simple-sticky/state.json
```

The old single-note geometry object is migrated to state format version 2. Its
geometry is assigned to `primary`, and the original state text is preserved as
`state.v1.json.bak` before the new registry is written.

Every note has an independent 400 ms content-save debounce and directory
monitor. Content and state writes use an atomic temporary-file replacement with
`fsync`. Direct edits and atomic replacements by a terminal, editor, or Codex
reload only the matching note. Each content save records the exact filesystem
snapshot it wrote. A delayed self-generated monitor event is ignored even when
the editor already contains a newer unsaved keystroke, so a quick Backspace or
other edit cannot be replaced by the preceding saved text.

For example:

```bash
printf '\nExternal edit test\n' >> ~/StickyNotes/note.md
```

If an external edit races with pending unsaved UI text for the same file, the
external file is authoritative. Other notes are unaffected.

## Recover a deleted note

StickyMD first uses the desktop's system Trash API. Open Trash in GNOME Files,
or inspect and restore files from a terminal:

```bash
gio trash --list
gio trash --restore 'trash:///note-<stable-id>.md'
```

Use the exact Trash URI shown by `gio trash --list`. If the system Trash API is
unavailable, StickyMD moves the file to:

```text
~/StickyNotes/.trash/
```

Move a fallback file back to `~/StickyNotes/`, then restart StickyMD. A restored
supported filename is automatically enrolled without changing its content.

## Uninstall

```bash
./uninstall.sh
```

The default uninstall disables and removes the panel extension, executables,
and launchers but preserves every Markdown file, state, and recoverable Trash
file. The following explicit option permanently removes active note files and
state; it does not empty system Trash or `~/StickyNotes/.trash`:

```bash
./uninstall.sh --purge
```

## Tests

Headless persistence, migration, Trash fallback, and resize tests:

```bash
python3 -m unittest -v tests/test_simple_sticky.py
```

With StickyMD running in the active X11 session:

```bash
./tests/x11_properties.sh
./tests/x11_interaction.py
python3 tests/x11_backspace_regression.py
python3 tests/x11_reference_copy.py
```

The interaction test creates test notes, changes one note's geometry, and moves
one test Markdown file to Trash. The Backspace regression test temporarily
edits the primary note, exercises a real external atomic replacement, and
restores the original content and Show Desktop state in a `finally` block. The
reference-copy test temporarily changes the primary editor, verifies an
immediate save and the clipboard payload, then restores its content, clipboard
text, and Show Desktop state. See
[`IMPLEMENTATION_REPORT.md`](IMPLEMENTATION_REPORT.md) for recorded results and
the short visual checklist.
