#!/bin/sh
set -eu

executable="$HOME/.local/bin/stickymd"
compatibility_executable="$HOME/.local/bin/simple-sticky"
x11_backend="$HOME/.local/lib/stickymd/simple-sticky"
backend_dir="$HOME/.local/lib/stickymd"
autostart="$HOME/.config/autostart/simple-sticky.desktop"
application_launcher="$HOME/.local/share/applications/stickymd.desktop"
new_launcher="$HOME/.local/share/applications/stickymd-new.desktop"
extension_uuid="stickymd@local"
extension_dir="$HOME/.local/share/gnome-shell/extensions/$extension_uuid"

if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$extension_uuid" >/dev/null 2>&1 || true
fi
if command -v gsettings >/dev/null 2>&1; then
    enabled_extensions=$(gsettings get org.gnome.shell enabled-extensions)
    updated_extensions=$(printf '%s\n' "$enabled_extensions" | sed \
        -e "s/'$extension_uuid', //g" \
        -e "s/, '$extension_uuid'//g" \
        -e "s/'$extension_uuid'//g")
    if [ "$updated_extensions" != "$enabled_extensions" ]; then
        gsettings set org.gnome.shell enabled-extensions "$updated_extensions"
    fi
fi
rm -f \
    "$executable" \
    "$compatibility_executable" \
    "$x11_backend" \
    "$autostart" \
    "$application_launcher" \
    "$new_launcher"
rm -f \
    "$extension_dir/extension.js" \
    "$extension_dir/metadata.json" \
    "$extension_dir/wayland-core.js" \
    "$extension_dir/stylesheet.css"
rmdir "$extension_dir" 2>/dev/null || true
rmdir "$backend_dir" 2>/dev/null || true
printf 'Removed the application, panel button, and login autostart entry.\n'

if [ "${1:-}" = "--purge" ]; then
    rm -f "$HOME/StickyNotes/note.md"
    for note_file in "$HOME/StickyNotes"/note-*.md; do
        if [ -f "$note_file" ]; then
            rm -f "$note_file"
        fi
    done
    rm -f "$HOME/.local/state/simple-sticky/state.json"
    rm -f "$HOME/.local/state/simple-sticky/state.v1.json.bak"
    rm -f "$HOME/.local/state/simple-sticky/app.lock"
    rm -f "$HOME/.local/state/simple-sticky/control.sock"
    rm -f "$HOME/.local/state/simple-sticky/stickymd.log"
    rmdir "$HOME/StickyNotes" 2>/dev/null || true
    rmdir "$HOME/.local/state/simple-sticky" 2>/dev/null || true
    printf 'Also removed active note content and UI state (--purge).\n'
    printf 'System Trash and ~/StickyNotes/.trash remain recoverable.\n'
else
    printf 'Preserved all ~/StickyNotes/*.md files, Trash, and UI state.\n'
fi
