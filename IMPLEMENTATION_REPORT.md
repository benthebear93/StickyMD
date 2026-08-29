# Implementation Report

## Scope and target environment

StickyMD 0.1.0 established multiple independent notes, recoverable deletion,
eight-direction resizing, raw Markdown persistence, external-file reload, login
autostart, agent-friendly note references, and a GNOME top-panel control for
creating, stopping, and restoring notes. It also includes protection against
delayed filesystem-monitor events restoring a character just removed with
Backspace. Version 0.2.0 adds in-place live styling
for level-one through level-three headings, bold spans, and clickable task
checkboxes. It does not add direct coding-agent integration, project links, MCP
integration, a separate preview mode, themes, Electron, or a normal-window
fallback. Version 0.3.0 adds a GNOME Shell 45–50 Wayland backend, a
session-aware launcher and installer, and shared data compatibility between the
Wayland and X11 backends.

Detected and tested environment:

- Distribution: Ubuntu 22.04.5 LTS
- Desktop: `XDG_CURRENT_DESKTOP=ubuntu:GNOME`
- GNOME Shell: 42.9
- Session: `XDG_SESSION_TYPE=x11`, `DISPLAY=:0`
- GTK: 3.24.33
- PyGObject: 3.42.1

Additional live Wayland verification environment:

- Distribution: Ubuntu 24.04 LTS virtual machine
- Desktop: `XDG_CURRENT_DESKTOP=ubuntu:GNOME`
- GNOME Shell: 46.0
- Session: `XDG_SESSION_TYPE=wayland`
- Display: 925×1006 logical pixels

The host remains the live X11 verification target. The Ubuntu 24.04 virtual
machine is the live GNOME 46 Wayland target. StickyMD never substitutes an
ordinary Wayland application window.

## Modified files

- `simple-sticky`: multi-note application manager, state migration, one window
  and file monitor per note, exact self-written snapshot tracking, recoverable
  deletion, local control socket, `stickymd new/start/quit`, hover controls,
  generic note-reference copying, live Markdown tags, clickable checkboxes, and
  eight-direction resizing.
- `stickymd`: session-aware shell launcher. On Wayland it calls the Shell
  extension over a private session D-Bus interface; on X11 it executes the
  installed GTK backend.
- `gnome-shell-extension/stickymd@local/extension.js`: legacy GNOME Shell 42–44
  panel controller for the X11 backend.
- `gnome-shell-extension/stickymd@local/extension-modern.js`: GNOME Shell 45–50
  ESM implementation. It renders notes inside the Shell on Wayland and remains
  a process controller on X11.
- `gnome-shell-extension/stickymd@local/wayland-core.js`: GI-independent state,
  Markdown, Unicode-offset, file-event, and eight-direction geometry helpers.
- `gnome-shell-extension/stickymd@local/stylesheet.css`: fixed note, editor,
  hover-control, and resize-hit styling for the Wayland actors.
- `install.sh`: detects GNOME version and session, installs the correct legacy
  or modern extension, adds X11 autostart only when required, and preserves
  unrelated enabled extensions.
- `package-extensions.sh`: builds separate GNOME 42–44 and GNOME 45–50 bundles,
  including the modern helper module that `gnome-extensions pack` otherwise
  omits unless explicitly listed.
- `uninstall.sh`: disables and removes the Shell extension, commands, and
  launchers while preserving user data by default.
- `simple-sticky.desktop.in`: updated login autostart metadata.
- `stickymd.desktop.in`: GNOME application-grid launcher for starting StickyMD
  or restoring existing notes without a terminal.
- `stickymd-new.desktop.in`: new launcher that executes `stickymd new`.
- `tests/test_simple_sticky.py`: version-2 persistence, migration, Trash, ID,
  reference formatting, live-Markdown parsing and presentation tags, clamping,
  minimum-size, and eight-direction resize tests.
- `tests/test_wayland_core.mjs`: equivalent registry, migration, Unicode,
  Markdown, Backspace-race, reference, and resize coverage for Wayland.
- `tests/install_smoke.sh`: isolated-home installation and removal checks for
  GNOME 42 X11, GNOME 50 Wayland, and the rejected GNOME 42 Wayland case.
- `tests/x11_properties.sh`: validates every note's EWMH properties and checks
  that an available normal application window is stacked above all notes.
- `tests/x11_interaction.py`: XTest coverage for hover creation, `Ctrl+N`, all
  four edges and four corners, minimum size, and one-note deletion.
- `tests/x11_backspace_regression.py`: live XTest reproduction for the save,
  delayed monitor event, and Backspace ordering; it also confirms that a true
  external atomic replacement still reloads the editor.
- `tests/x11_reference_copy.py`: live hover, accessibility, immediate-save, and
  clipboard verification for the generic note-reference control.
- `tests/x11_live_markdown.py`: isolated `/tmp` X11 integration coverage for
  live tags, checkbox persistence, and external-edit restyling.
- `tests/libvirt_type.py`: libvirt/QEMU keyboard and monitor-input helper used
  for repeatable GNOME 46 guest verification.
- `tests/vm_http_bridge.py`: local VM artifact server and guest report/upload
  receiver used by the Wayland test workflow.
- `README.md`: install, update, use, storage, recovery, and test instructions.
- `CHANGELOG.md`: concise public release history through version 0.3.0.
- `docs/images/stickymd-live-markdown.png`: isolated demo-window screenshot for
  the public README; it contains no user note content or desktop details.
- `.github/workflows/ci.yml`: read-only GitHub Actions checks on Ubuntu 22.04
  for both core test suites, session-aware installation, source syntax, both
  extension generations, shell scripts, and generated desktop entries.
- `.gitignore`: excludes local Python and packaging build artifacts.

The X11 source executable retains its original `simple-sticky` filename to
extend the existing project safely. It is installed under
`~/.local/lib/stickymd/`; the public `~/.local/bin/stickymd` command selects the
backend without requiring Python on Wayland.

## Architecture and storage

Both backends use the same version-2 registry and Markdown filenames. Switching
between a supported X11 and Wayland session does not migrate, rename, or copy
note content.

`StickyApplication` owns the versioned registry and a collection of
`StickyWindow` objects. Each `StickyWindow` independently owns its GTK text
buffer, 400 ms save debounce, filesystem monitor, pending reload, Markdown path,
and geometry on X11.

On Wayland, `WaylandNoteManager` owns a `St.Widget` note layer inserted into
`global.window_group` immediately above GNOME Shell's background group. Normal
`Meta.WindowActor` children remain above the entire StickyMD layer. Notes are
therefore not application windows, never enter Alt+Tab or the Dock, remain
global across workspaces, and stay visible when application windows are hidden.
Each `StickyNote` actor owns an editable multiline `Clutter.Text`, its own save
and reload debounce, live Pango attributes, geometry, controls, and resize hit
areas.

Content remains ordinary UTF-8 text:

```text
~/StickyNotes/note.md
~/StickyNotes/note-<12-hex-character-stable-id>.md
```

Live Markdown is presentation-only. A 50 ms debounce reparses the small note
buffer and applies GTK text tags on X11 or Pango attributes on Wayland without
replacing source characters. The active line shows its editable syntax markers;
inactive heading, bold, and task prefix markers are hidden. Checkbox clicks
change only the single source character between `[ ]` and `[x]`. Applying or
removing presentation attributes does not trigger an autosave loop.

On GNOME Shell, `St.Entry` reapplies CSS-derived Pango attributes whenever its
style changes, including inherited hover and focus changes. Each Wayland note
therefore uses an after-handler for `style-changed` and restores its Markdown
attributes in the same frame, after the default CSS pass but before painting.
Focus and cursor changes still use the short parser debounce. Only the focused
note exposes syntax on its active line; unfocused notes remain fully styled.
GNOME 46 may also report a null event source during capture, so the blank-editor
fallback uses actor coordinates and propagates clicks inside the allocated text
actor. This preserves normal cursor placement, selection, and checkbox hit
testing.

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

The X11 backend writes through a same-directory temporary file, file `fsync`,
`os.replace`, and directory `fsync`. The Wayland backend uses
`Gio.File.replace_contents`, which provides atomic destination replacement.
Both monitor the note directory rather than one inode, so external atomic
replacements are detected and routed only to the matching note. X11 records an
exact inode snapshot; Wayland records the last replacement's text plus file ID,
size, and microsecond modification time. A matching self snapshot is retained
across all duplicate Gio monitor events instead of being forgotten after the
first acknowledgement. In both paths, a delayed self-write event is ignored
without cancelling a newer pending local edit. An actually different disk
snapshot remains authoritative.

Deletion first calls the GIO system Trash API. If unavailable, it atomically
moves the Markdown file to `~/StickyNotes/.trash/` with a timestamp and unique
suffix. The note's registry entry is removed only after the recoverable move
succeeds. No UI delete path calls `rm`.

On X11, the local mode-0600 UNIX socket at
`~/.local/state/simple-sticky/control.sock` lets `stickymd new` create a note in
the running process. If the process is absent, the command starts it with an
explicit create-on-start request. The process remains alive when the registry is
empty, so the same command also works after the last note is deleted. A plain
interactive `stickymd` invocation now performs an `ensure` request: it creates a
note if the running process is empty, or reports that existing notes can be seen
with GNOME Show Desktop. Login autostart does not recreate intentionally deleted
notes.

On Wayland, the public launcher sends the same `start`, `new`, and `quit`
commands to the enabled Shell extension over the user session bus. The D-Bus
object has no note-content methods; content remains accessible only through the
plain Markdown files.

On X11, `stickymd quit` sends a local `quit` request instead of killing the
process. The GTK main loop first flushes every note, captures current geometry,
atomically saves the registry, cancels file monitors, closes the control socket,
and then exits. On Wayland, the same command flushes and destroys the note
actors while leaving the panel extension enabled. `stickymd start` restores the
registered notes without creating a new one in either backend. Quitting always
leaves every Markdown file and registry entry intact.

## GNOME panel and session integration

GNOME Shell 42 does not expose a native legacy tray to GTK applications. The
installed Ubuntu AppIndicator extension was detected, but no AppIndicator GI
binding was installed and its interaction model opens a menu rather than
performing the requested one-click action. StickyMD therefore uses a narrowly
scoped user Shell extension instead of changing the note windows or adding a
second daemon.

Both extension generations create one `PanelMenu.Button` in the right status
area with the standard `document-edit-symbolic` icon. It observes only the
existence of the mode-0600 control socket on X11 and the internal actor-manager
state on Wayland.
The icon is fully opaque while running and dim while stopped. Primary click
creates a note when running and restores the registered notes when stopped. The
secondary-click menu contains current status/start, New note, and Quit StickyMD
entries. The panel control remains available after all notes stop because it
belongs to GNOME Shell.

On X11, `~/.config/autostart/simple-sticky.desktop` starts the Python process
after login. On Wayland, the enabled Shell extension itself restores the notes,
so no Python process or separate autostart entry is installed. Registered notes
are created without an intentional focus request in either backend. Deleting
the last note does not disable the panel control.

## Coding-agent reference UX

The existing hover control box now contains a stable reference label and a
standard `edit-copy-symbolic` button before the unchanged `+` and `×` buttons.
`primary` is shown as `#MAIN`; another stable ID such as `a1b2c3d4e5f6` is shown
as `#A1B2C3`. No filename, ID, or state format is changed.

The copy action derives a compact title from the first non-empty line, flushes
that note's pending content save, and copies a request containing the title,
short reference, and absolute Markdown path. The path is authoritative, so the
very unlikely case of two six-character prefixes matching remains unambiguous.
The action uses the standard desktop clipboard through GTK on X11 or St on
Wayland and does not communicate with any coding agent or external service.

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

The Wayland actor uses the same pure geometry calculation. Eight transparent
reactive actors surround the editor; corners are inserted above edges in the
Clutter pick order. A stage grab captures one immutable starting geometry and
logical stage-pointer position, so scaling is handled in GNOME Shell's own
coordinate space. Only the note actor moves or resizes, and the registry is
saved after release with the same 400 ms debounce.

## Verification record

### Automated and live checks completed

- PASS — 18 Node tests cover Wayland-compatible v1 migration, explicit empty
  state, orphan enrollment, stable filenames and references, serialized v2
  state, Unicode character/UTF-8 offsets, the supported Markdown subset,
  checkbox hit testing, delayed self-event suppression, all resize directions,
  fixed opposite edges, and minimum size.
- PASS — isolated installer smoke tests selected the legacy files and X11
  autostart for GNOME 42 X11, selected the ESM actor backend with no autostart
  for GNOME 50 Wayland, removed all installed program files while preserving
  data, and rejected GNOME 42 Wayland instead of falling back to a normal
  window.
- PASS — Node parsed the modern ESM extension and pure helper module; Python
  compiled the X11 backend; POSIX shell syntax checks passed for the launcher,
  installer, uninstaller, and X11 property test; both metadata files parsed as
  JSON.
- PASS — `package-extensions.sh` produced separate legacy and modern extension
  archives. Archive inspection confirmed that the modern bundle contains
  `extension.js`, `metadata.json`, `stylesheet.css`, and `wayland-core.js`.
- PASS — the session-aware installer updated the live GNOME 42 X11 system,
  placed the Python backend at `~/.local/lib/stickymd/simple-sticky`, and the
  public launcher reported version 0.3.0. A graceful quit/start replaced the
  old process with that installed backend. `note.md` and `state.json` hashes
  were identical before installation and after restart.
- PASS — the restarted 0.3.0 X11 window still advertised desktop, below,
  sticky, skip-taskbar, skip-pager, and all-workspace EWMH properties. A live
  normal application window remained above it in the stacking list.
- PASS — Ubuntu 24.04 GNOME Shell 46.0 Wayland loaded extension version 9 as
  enabled and active after a full guest reboot. Existing note files and version-2
  geometry state were restored without a Python process.
- PASS — a real host XTest click was mapped through the visible GNOME Boxes
  window to a zero-byte Wayland `note.md`. The empty note gained keyboard focus,
  displayed its caret at the top, accepted `FINAL8`, and atomically autosaved the
  text. The test text was then removed, `note.md` was confirmed as zero bytes,
  and another real click displayed the caret again while the file stayed empty.
- PASS — live GNOME 46 diagnostics reproduced the earlier empty-note failure:
  `Clutter.Event.get_source()` returned `null` during capture. The final handler
  distinguishes allocated text from blank viewport space by coordinates. A real
  click on loaded heading text placed the cursor on that exact line, while a
  real click in an empty note still focused the editor and displayed its caret.
- PASS — after a version-9 session restart, an existing note was styled before
  its first edit. A second note was populated with headings, bold text, and an
  unchecked task. Repeated real clicks between the two notes preserved both
  notes' rendering; only the focused note exposed syntax on its active line.
- PASS — a real pointer click changed the temporary task from `- [ ]` to
  `- [x]`, and the exact checked Markdown source was observed in `note.md` after
  autosave. The temporary content was then selected and removed with Backspace.
  Moving focus to the other note did not resurrect it, and `note.md` was
  confirmed as a zero-byte file after the monitor events had settled.
- PASS — version 10 replaces the 50 ms hover-time style repair with a GObject
  after-handler, so inherited `St.Entry` style changes restore Markdown Pango
  attributes before that frame is painted. Source checks assert the after-handler
  path and reject the previous delayed connection. After a normal GNOME 46
  login, version 10 reported `Enabled: Yes` and `State: ACTIVE`. Two 120 fps
  captures covered hover entry plus an entry/exit/re-entry round trip. All 285
  round-trip frames retained the rendered heading, checkbox, and bold text while
  the hover controls appeared and disappeared; no raw Markdown frame was
  observed.
- PASS — the GitHub Actions workflow syntax parsed locally, and every command
  used by the workflow completed successfully against the release tree.
- PASS — Python compilation completed for the application and five Python test
  files; shell syntax completed for install, uninstall, and property scripts.
- PASS — 27 headless unit tests covered atomic UTF-8 replacement, exact written
  snapshot identity, delayed self-event classification, true external-event
  classification, stable short-reference derivation, first-line title
  normalization, exact clipboard payload construction, v1 migration without
  content mutation, v2 registry round-trip, explicit empty registry,
  restored/orphan enrollment, recoverable fallback Trash, stable filename
  validation, all eight resize directions, fixed west/north opposite edges,
  minimum size, work-area clamping, the zero-note `ensure` control command,
  graceful quit dispatch, public `new/start/quit` command parsing, the supported
  live-Markdown subset, Unicode offsets, incomplete syntax, checkbox hit ranges,
  and content-neutral GTK presentation tags.
- PASS — the isolated live X11 Markdown test applied heading, bold, unchecked,
  and hidden-syntax tags without using user note data. Toggling the checkbox
  saved the exact `- [x]` Markdown source, and an external atomic replacement
  reloaded and restyled the correct heading, bold span, and checked checkbox.
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
- PASS — the installed window exposed `#MAIN` and `Copy note reference`
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

Before a public Wayland release, install from a GNOME 45–50 Wayland session,
log out and back in, and complete this release gate:

1. Confirm the existing `note.md` content appears without a Python process.
2. Put a normal terminal over every note and confirm it fully covers them.
   Confirm the notes are absent from Alt+Tab, the Dock, and the workspace list.
3. Use Show Desktop and switch workspaces; confirm the same note actors remain
   above the wallpaper in the same logical positions.
4. Create three notes from hover `+`, `Ctrl+N`, the panel, and `stickymd new`.
   Restart the session and confirm all content and geometry returns.
5. Resize from all eight directions, especially north and west, and confirm the
   opposite edges remain fixed and the minimum size is 160×120.
6. Run `printf '\nExternal edit test\n' >> ~/StickyNotes/note.md` and confirm
   only the primary note updates. Press Backspace during autosave and confirm
   the deleted character does not return.
7. Delete one note and confirm its Markdown file is in system Trash or
   `~/StickyNotes/.trash/`. Quit and restore from the panel without deleting any
   remaining files.

For the already tested X11 backend, the final Show Desktop composition has been
captured and inspected, but the Shell switcher, pointer cursor shapes, and login
behavior still require a brief visual confirmation:

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
6. Enter `# Title`, `**bold**`, and `- [ ] task` on separate lines. Move the
   cursor between lines and confirm inactive syntax hides while the text remains
   styled. Click `[ ]` and confirm it changes to `[x]` in the Markdown file.
7. For an optional last-note test, move every note to Trash with `×`, run
   `~/.local/bin/stickymd new`, and confirm one blank note appears. Restore the
   prior files from Trash and restart StickyMD afterward.

## Remaining limitations

- Live-tested support includes GNOME 42 X11 and Ubuntu 24.04 GNOME 46 Wayland.
  Other declared GNOME 45–50 versions retain automated compatibility coverage
  but have not each received the full live GUI gate.
- GNOME 42–44 Wayland, KDE Plasma, Cinnamon, and other desktop environments are
  unsupported. The installer exits instead of substituting a normal window.
- The Wayland backend locates Mutter's `Meta.BackgroundGroup` within the public
  Shell window group and places its actor layer immediately above it. The
  installer pins declared compatibility to reviewed Shell versions 45–50; a
  future Shell actor-tree change may still require a small port.
- GNOME 45 introduced ESM extensions, so separate legacy and modern source
  files are installed according to the detected Shell version.
- X11 requires Python 3.9+, PyGObject, and GTK 3. Wayland uses only GNOME
  Shell/GJS/Gio and has no Python runtime dependency. A pip package would not
  remove the X11 backend's native GTK/PyGObject system dependencies.
- On X11, panel running state is inferred from the local control socket once per
  second. A hard crash can leave the icon looking active briefly; normal
  panel/CLI quit removes the socket before exit.
- Concurrent edits to the same note are not merged. An external disk edit wins
  over pending unsaved UI content for that one file.
- Live styling intentionally supports only `#` through `###`, `**bold**`, and
  line-leading `- [ ]`/`- [x]` checkboxes. Other Markdown stays plain text.
- Restoring a deleted file while StickyMD is running requires an application
  restart before the restored filename is re-enrolled.
- Final Alt+Tab, Dock, all-workspace, Show Desktop, and eight-way cursor visuals
  still require the manual Wayland checklist on each additional Shell version.
