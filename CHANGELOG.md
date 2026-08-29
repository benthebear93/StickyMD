# Changelog

## 0.3.0 - 2026-08-29

- Add a native GNOME Shell desktop-layer backend for Wayland on GNOME 45–50.
- Keep the GTK/EWMH desktop-window backend for GNOME 42–49 on X11.
- Select the correct backend during user-local installation without requiring
  Python on Wayland.
- Preserve the same plain Markdown files and version-2 state across both
  backends.
- Fix empty-note focus, cursor placement, checkbox interaction, Backspace file
  monitor races, cross-note styling, and hover-time Markdown flicker.
- Add automated Wayland core tests and session-aware installation tests.

## 0.2.0 - 2026-08-28

- Add live inline styling for headings, bold spans, and task checkboxes without
  replacing the editable Markdown source.

## 0.1.0 - 2026-08-27

- Initial release with multiple notes, recoverable deletion, eight-direction
  resizing, autosave, external reload, desktop-layer stacking, panel controls,
  and agent-neutral note references.
