#!/bin/sh
set -eu

executable="$HOME/.local/bin/stickymd"
compatibility_executable="$HOME/.local/bin/simple-sticky"
autostart="$HOME/.config/autostart/simple-sticky.desktop"
application_launcher="$HOME/.local/share/applications/stickymd.desktop"
new_launcher="$HOME/.local/share/applications/stickymd-new.desktop"
extension_uuid="stickymd@local"
extension_dir="$HOME/.local/share/gnome-shell/extensions/$extension_uuid"

if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$extension_uuid" >/dev/null 2>&1 || true
fi
python3 -c '
import sys
from gi.repository import Gio
settings = Gio.Settings.new("org.gnome.shell")
enabled = [item for item in settings.get_strv("enabled-extensions") if item != sys.argv[1]]
settings.set_strv("enabled-extensions", enabled)
' "$extension_uuid"
rm -f \
    "$executable" \
    "$compatibility_executable" \
    "$autostart" \
    "$application_launcher" \
    "$new_launcher"
rm -f "$extension_dir/extension.js" "$extension_dir/metadata.json"
rmdir "$extension_dir" 2>/dev/null || true
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
