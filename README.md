# StickyMD

Native Markdown sticky notes for GNOME X11, readable and editable by Codex,
Claude, and other coding agents.

StickyMD keeps notes above the wallpaper but behind regular application
windows. Notes stay out of Alt+Tab, the Dock, and the taskbar. Each note is an
ordinary Markdown file in `~/StickyNotes`, so people, terminals, editors, and
coding agents can work with the same text.

## Features

- Multiple independently saved notes
- Automatic saving and live reload after external file edits
- Position and size restoration across logins
- Move and resize from every edge or corner
- Login autostart and a small GNOME panel button for creating notes
- Recoverable deletion through the system Trash
- A hover action that copies the exact note path for Codex or Claude

## Requirements

StickyMD currently supports **GNOME Shell 42 on X11 only**. It has been tested
on Ubuntu 22.04 with Python 3.10 and GTK 3.

Install the runtime packages on Ubuntu:

```bash
sudo apt install python3-gi gir1.2-gtk-3.0 libgtk-3-0
```

Wayland is not supported; StickyMD exits instead of falling back to an ordinary
window with different stacking behavior.

## Install

From the project directory:

```bash
./install.sh
~/.local/bin/stickymd
```

The installer writes only to the current user's home directory and does not use
`sudo`. StickyMD then starts automatically on future logins and is available
from the GNOME application menu.

On the first install, GNOME Shell 42 may require a logout and login. On X11 you
can instead press `Alt+F2`, enter `r`, and press Enter.

To update, run `./install.sh` again and restart the running process:

```bash
kill -TERM "$(cat ~/.local/state/simple-sticky/app.lock)"
~/.local/bin/stickymd
```

## Use

- Click the StickyMD icon in the top panel to create a note.
- Hover a note to reveal its reference, copy, `+`, and `×` controls.
- Click `+`, press `Ctrl+N`, or run `stickymd new` to create another note.
- Drag the empty top strip to move a note.
- Drag any edge or corner to resize it.
- Click `×` to move that note's Markdown file to Trash.

The copy button creates a paste-ready request containing the note's first text
line, stable short reference, and exact file path:

```text
Read StickyMD note "Weekly plan" (#A1B2C3).
File: /home/user/StickyNotes/note-a1b2c3d4e5f6.md
```

## Data

Note content is plain UTF-8 Markdown:

```text
~/StickyNotes/note.md
~/StickyNotes/note-<stable-id>.md
```

Window positions and sizes are stored separately in:

```text
~/.local/state/simple-sticky/state.json
```

External edits appear in the matching open note automatically. Deleted notes
can be restored from GNOME Files Trash. If the system Trash is unavailable,
StickyMD uses `~/StickyNotes/.trash/`.

## Uninstall

```bash
./uninstall.sh
```

This removes the application and autostart integration but preserves notes and
state. To also remove active note files and state permanently:

```bash
./uninstall.sh --purge
```

System Trash and `~/StickyNotes/.trash/` are never emptied by the uninstaller.

## Development

Run the headless test suite with:

```bash
python3 -m unittest -v tests/test_simple_sticky.py
```

Implementation details and the full verification record are in
[`IMPLEMENTATION_REPORT.md`](IMPLEMENTATION_REPORT.md).
