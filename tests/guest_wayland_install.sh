#!/bin/sh
set -u

report_url=${1:-http://10.0.2.2:8765/report}
report_file=/tmp/stickymd-guest-install-report.txt
install_status=0

: > "$report_file"
{
    printf 'session=%s\n' "${XDG_SESSION_TYPE:-unset}"
    printf 'desktop=%s\n' "${XDG_CURRENT_DESKTOP:-unset}"
    gnome-shell --version
    printf '%s\n' '--- installer output ---'
    ./install.sh || install_status=$?
    printf '%s\n' '--- installed extension ---'
    test -f "$HOME/.local/share/gnome-shell/extensions/stickymd@local/extension.js"
    test -f "$HOME/.local/share/gnome-shell/extensions/stickymd@local/wayland-core.js"
    "$HOME/.local/bin/stickymd" --version
    gsettings get org.gnome.shell enabled-extensions
    gnome-extensions info stickymd@local || true
    printf 'install_status=%s\n' "$install_status"
} >> "$report_file" 2>&1

wget -qO- --post-file="$report_file" "$report_url" >/dev/null
exit "$install_status"
