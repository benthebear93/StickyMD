#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mock_bin="$project_dir/tests/fixtures/mock-gnome-bin"
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM

run_install() {
    target_home=$1
    session_type=$2
    shell_version=$3
    mkdir -p "$target_home"
    HOME="$target_home" \
    XDG_SESSION_TYPE="$session_type" \
    MOCK_GNOME_VERSION="$shell_version" \
    PATH="$mock_bin:/usr/bin:/bin" \
        "$project_dir/scripts/install.sh" >/dev/null
}

x11_home="$test_root/x11-home"
run_install "$x11_home" x11 42
cmp "$project_dir/src/stickymd" "$x11_home/.local/bin/stickymd"
cmp "$project_dir/src/x11_backend.py" \
    "$x11_home/.local/lib/stickymd/x11_backend.py"
cmp "$project_dir/src/gnome-shell/stickymd@local/extension.js" \
    "$x11_home/.local/share/gnome-shell/extensions/stickymd@local/extension.js"
test -f "$x11_home/.config/autostart/stickymd.desktop"

wayland_home="$test_root/wayland-home"
run_install "$wayland_home" wayland 50
cmp "$project_dir/src/gnome-shell/stickymd@local/extension-modern.js" \
    "$wayland_home/.local/share/gnome-shell/extensions/stickymd@local/extension.js"
cmp "$project_dir/src/gnome-shell/stickymd@local/metadata-modern.json" \
    "$wayland_home/.local/share/gnome-shell/extensions/stickymd@local/metadata.json"
test -f "$wayland_home/.local/share/gnome-shell/extensions/stickymd@local/wayland-core.js"
test ! -e "$wayland_home/.config/autostart/stickymd.desktop"
HOME="$wayland_home" \
XDG_SESSION_TYPE=wayland \
MOCK_GDBUS_LOG="$test_root/gdbus.log" \
PATH="$mock_bin:/usr/bin:/bin" \
    "$wayland_home/.local/bin/stickymd" new
HOME="$wayland_home" \
XDG_SESSION_TYPE=wayland \
MOCK_GDBUS_LOG="$test_root/gdbus.log" \
PATH="$mock_bin:/usr/bin:/bin" \
    "$wayland_home/.local/bin/stickymd"
grep -q 'org.stickymd.StickyMD.New' "$test_root/gdbus.log"
grep -q 'org.stickymd.StickyMD.Ensure' "$test_root/gdbus.log"

HOME="$wayland_home" \
XDG_SESSION_TYPE=wayland \
MOCK_GNOME_VERSION=50 \
PATH="$mock_bin:/usr/bin:/bin" \
    "$project_dir/scripts/uninstall.sh" >/dev/null
test ! -e "$wayland_home/.local/bin/stickymd"
test ! -e "$wayland_home/.local/lib/stickymd/x11_backend.py"
test ! -e "$wayland_home/.local/share/gnome-shell/extensions/stickymd@local"

unsupported_home="$test_root/unsupported-home"
if run_install "$unsupported_home" wayland 42 2>/dev/null; then
    printf 'GNOME 42 Wayland installation unexpectedly succeeded\n' >&2
    exit 1
fi

printf 'Installer smoke tests passed for GNOME 42 X11 and GNOME 50 Wayland.\n'
