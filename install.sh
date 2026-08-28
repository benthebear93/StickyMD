#!/bin/sh
set -eu

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
executable="$HOME/.local/bin/stickymd"
compatibility_executable="$HOME/.local/bin/simple-sticky"
autostart="$HOME/.config/autostart/simple-sticky.desktop"
application_launcher="$HOME/.local/share/applications/stickymd.desktop"
new_launcher="$HOME/.local/share/applications/stickymd-new.desktop"
extension_uuid="stickymd@local"
extension_source="$source_dir/gnome-shell-extension/$extension_uuid"
extension_dir="$HOME/.local/share/gnome-shell/extensions/$extension_uuid"

python3 -c "import gi; gi.require_version('Gtk', '3.0'); from gi.repository import Gtk"

mkdir -p \
    "$HOME/.local/bin" \
    "$HOME/.config/autostart" \
    "$HOME/.local/share/applications" \
    "$extension_dir"
install -m 0755 "$source_dir/simple-sticky" "$executable"
install -m 0755 "$source_dir/simple-sticky" "$compatibility_executable"
install -m 0644 "$extension_source/metadata.json" "$extension_dir/metadata.json"
install -m 0644 "$extension_source/extension.js" "$extension_dir/extension.js"

temporary_desktop=$(mktemp "$HOME/.config/autostart/.simple-sticky.desktop.XXXXXX")
temporary_application=$(mktemp "$HOME/.local/share/applications/.stickymd.desktop.XXXXXX")
temporary_launcher=$(mktemp "$HOME/.local/share/applications/.stickymd-new.desktop.XXXXXX")
trap 'rm -f "$temporary_desktop" "$temporary_application" "$temporary_launcher"' EXIT HUP INT TERM
escaped_executable=$(printf '%s' "$executable" | sed 's/[&|]/\\&/g')
sed "s|@EXECUTABLE@|$escaped_executable|g" \
    "$source_dir/simple-sticky.desktop.in" > "$temporary_desktop"
sed "s|@EXECUTABLE@|$escaped_executable|g" \
    "$source_dir/stickymd.desktop.in" > "$temporary_application"
sed "s|@EXECUTABLE@|$escaped_executable|g" \
    "$source_dir/stickymd-new.desktop.in" > "$temporary_launcher"
chmod 0644 "$temporary_desktop"
chmod 0644 "$temporary_application"
chmod 0644 "$temporary_launcher"
mv -f "$temporary_desktop" "$autostart"
mv -f "$temporary_application" "$application_launcher"
mv -f "$temporary_launcher" "$new_launcher"
trap - EXIT HUP INT TERM

python3 -c '
import sys
from gi.repository import Gio
settings = Gio.Settings.new("org.gnome.shell")
enabled = list(settings.get_strv("enabled-extensions"))
if sys.argv[1] not in enabled:
    enabled.append(sys.argv[1])
    settings.set_strv("enabled-extensions", enabled)
' "$extension_uuid"

if command -v gdbus >/dev/null 2>&1 && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    gdbus call --session \
        --dest org.gnome.Shell.Extensions \
        --object-path /org/gnome/Shell/Extensions \
        --method org.gnome.Shell.Extensions.ReloadExtension \
        "$extension_uuid" >/dev/null 2>&1 || true
fi
if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "$extension_uuid" >/dev/null 2>&1 || true
fi

printf 'Installed StickyMD and its GNOME panel button.\nStart: %s start\nNew note: %s new\nStop without deleting notes: %s quit\n' \
    "$executable" "$executable" "$executable"
if command -v gnome-extensions >/dev/null 2>&1 \
    && ! gnome-extensions info "$extension_uuid" >/dev/null 2>&1; then
    printf 'The panel button is enabled for the next login. On GNOME X11, Alt+F2 then r loads it now.\n'
fi
