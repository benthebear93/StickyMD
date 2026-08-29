#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
launcher="$HOME/.local/bin/stickymd"
compatibility_launcher="$HOME/.local/bin/simple-sticky"
backend_dir="$HOME/.local/lib/stickymd"
x11_backend="$backend_dir/x11_backend.py"
legacy_x11_backend="$backend_dir/simple-sticky"
autostart="$HOME/.config/autostart/stickymd.desktop"
legacy_autostart="$HOME/.config/autostart/simple-sticky.desktop"
application_launcher="$HOME/.local/share/applications/stickymd.desktop"
new_launcher="$HOME/.local/share/applications/stickymd-new.desktop"
extension_uuid="stickymd@local"
extension_source="$project_dir/src/gnome-shell/$extension_uuid"
extension_dir="$HOME/.local/share/gnome-shell/extensions/$extension_uuid"

if ! command -v gnome-shell >/dev/null 2>&1; then
    printf 'StickyMD requires GNOME Shell.\n' >&2
    exit 1
fi
if ! command -v gnome-extensions >/dev/null 2>&1; then
    printf 'StickyMD requires the gnome-extensions command.\n' >&2
    exit 1
fi
if ! command -v gdbus >/dev/null 2>&1; then
    printf 'StickyMD requires the gdbus command from GLib.\n' >&2
    exit 1
fi

shell_major=$(gnome-shell --version | awk '{split($3, parts, "."); print parts[1]}')
case "$shell_major" in
    ''|*[!0-9]*)
        printf 'Could not detect the GNOME Shell major version.\n' >&2
        exit 1
        ;;
esac
session_type=${XDG_SESSION_TYPE:-}
case "$session_type" in
    x11|wayland) ;;
    *)
        printf 'StickyMD must be installed from a GNOME X11 or Wayland session.\n' >&2
        exit 1
        ;;
esac

if [ "$shell_major" -ge 45 ] && [ "$shell_major" -le 50 ]; then
    extension_implementation="$extension_source/extension-modern.js"
    extension_metadata="$extension_source/metadata-modern.json"
    extension_generation=modern
elif [ "$shell_major" -ge 42 ] && [ "$shell_major" -le 44 ]; then
    extension_implementation="$extension_source/extension.js"
    extension_metadata="$extension_source/metadata.json"
    extension_generation=legacy
else
    printf 'Unsupported GNOME Shell version: %s. Supported versions are 42-50.\n' \
        "$shell_major" >&2
    exit 1
fi

if [ "$session_type" = wayland ] && [ "$extension_generation" = legacy ]; then
    printf '%s\n' \
        'StickyMD Wayland support requires GNOME Shell 45 or newer.' \
        'The existing GTK backend remains available in an X11 session.' >&2
    exit 1
fi

if [ "$session_type" = x11 ]; then
    python3 -c '
import sys
if sys.version_info < (3, 9):
    raise SystemExit("StickyMD X11 requires Python 3.9 or newer")
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk
'
fi

mkdir -p \
    "$HOME/.local/bin" \
    "$backend_dir" \
    "$HOME/.config/autostart" \
    "$HOME/.local/share/applications" \
    "$extension_dir"
install -m 0755 "$project_dir/src/stickymd" "$launcher"
install -m 0755 "$project_dir/src/stickymd" "$compatibility_launcher"
install -m 0755 "$project_dir/src/x11_backend.py" "$x11_backend"
install -m 0644 "$extension_implementation" "$extension_dir/extension.js"
install -m 0644 "$extension_metadata" "$extension_dir/metadata.json"
install -m 0644 "$extension_source/wayland-core.js" \
    "$extension_dir/wayland-core.js"
install -m 0644 "$extension_source/stylesheet.css" \
    "$extension_dir/stylesheet.css"

temporary_application=$(mktemp "$HOME/.local/share/applications/.stickymd.desktop.XXXXXX")
temporary_launcher=$(mktemp "$HOME/.local/share/applications/.stickymd-new.desktop.XXXXXX")
temporary_autostart=''
trap 'rm -f "$temporary_application" "$temporary_launcher" "$temporary_autostart"' \
    EXIT HUP INT TERM
escaped_launcher=$(printf '%s' "$launcher" | sed 's/[&|]/\\&/g')
sed "s|@EXECUTABLE@|$escaped_launcher|g" \
    "$project_dir/data/applications/stickymd.desktop.in" \
    > "$temporary_application"
sed "s|@EXECUTABLE@|$escaped_launcher|g" \
    "$project_dir/data/applications/stickymd-new.desktop.in" \
    > "$temporary_launcher"
chmod 0644 "$temporary_application" "$temporary_launcher"
mv -f "$temporary_application" "$application_launcher"
mv -f "$temporary_launcher" "$new_launcher"

if [ "$session_type" = x11 ]; then
    temporary_autostart=$(mktemp "$HOME/.config/autostart/.stickymd.desktop.XXXXXX")
    sed "s|@EXECUTABLE@|$escaped_launcher|g" \
        "$project_dir/data/autostart/stickymd.desktop.in" \
        > "$temporary_autostart"
    chmod 0644 "$temporary_autostart"
    mv -f "$temporary_autostart" "$autostart"
else
    rm -f "$autostart"
fi
rm -f "$legacy_x11_backend" "$legacy_autostart"
trap - EXIT HUP INT TERM

enabled_extensions=$(gsettings get org.gnome.shell enabled-extensions)
case "$enabled_extensions" in
    *"'$extension_uuid'"*) ;;
    "@as []"|"[]")
        gsettings set org.gnome.shell enabled-extensions "['$extension_uuid']"
        ;;
    *)
        updated_extensions=$(printf '%s' "$enabled_extensions" |
            sed "s/]$/, '$extension_uuid']/")
        gsettings set org.gnome.shell enabled-extensions "$updated_extensions"
        ;;
esac

if [ "$session_type" = x11 ] && [ "$extension_generation" = legacy ]; then
    if [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
        gdbus call --session \
            --dest org.gnome.Shell.Extensions \
            --object-path /org/gnome/Shell/Extensions \
            --method org.gnome.Shell.Extensions.ReloadExtension \
            "$extension_uuid" >/dev/null 2>&1 || true
    fi
    gnome-extensions enable "$extension_uuid" >/dev/null 2>&1 || true
fi

printf 'Installed StickyMD 0.3.0 for GNOME %s on %s.\n' \
    "$shell_major" "$session_type"
if [ "$session_type" = wayland ] || [ "$extension_generation" = modern ]; then
    printf 'Log out and back in once to load the GNOME Shell extension.\n'
else
    printf 'On X11, press Alt+F2, enter r, and press Enter to reload the panel button.\n'
fi
printf 'Start: %s start\nNew note: %s new\nStop without deleting notes: %s quit\n' \
    "$launcher" "$launcher" "$launcher"
