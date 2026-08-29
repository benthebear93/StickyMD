#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
output_dir="$test_root/output"

"$project_dir/scripts/package-release.sh" "$output_dir" >/dev/null
version=$("$project_dir/src/stickymd" --version)
version=${version#StickyMD }
package_name="stickymd-$version"
archive="$output_dir/$package_name.tar.gz"
release_dir="$test_root/$package_name"

test -f "$archive"
tar -C "$test_root" -xzf "$archive"

for required in \
    README.md \
    scripts/install.sh \
    scripts/uninstall.sh \
    src/stickymd \
    src/x11_backend.py \
    data/autostart/stickymd.desktop.in \
    data/applications/stickymd.desktop.in \
    data/applications/stickymd-new.desktop.in \
    docs/images/stickymd-live-markdown.png \
    src/gnome-shell/stickymd@local/extension.js \
    src/gnome-shell/stickymd@local/extension-modern.js \
    src/gnome-shell/stickymd@local/metadata.json \
    src/gnome-shell/stickymd@local/metadata-modern.json \
    src/gnome-shell/stickymd@local/wayland-core.js \
    src/gnome-shell/stickymd@local/stylesheet.css
do
    test -f "$release_dir/$required"
done

for excluded in \
    .github \
    .gitignore \
    CHANGELOG.md \
    IMPLEMENTATION_REPORT.md \
    package.json \
    tests
do
    test ! -e "$release_dir/$excluded"
done

if grep -q '^## Development$' "$release_dir/README.md"; then
    printf 'Release README unexpectedly contains the development section.\n' >&2
    exit 1
fi

test ! -e "$release_dir/scripts/package-extensions.sh"
test ! -e "$release_dir/scripts/package-release.sh"
test -x "$release_dir/scripts/install.sh"
test -x "$release_dir/scripts/uninstall.sh"
test -x "$release_dir/src/stickymd"
test -x "$release_dir/src/x11_backend.py"
sh -n \
    "$release_dir/scripts/install.sh" \
    "$release_dir/scripts/uninstall.sh" \
    "$release_dir/src/stickymd"

mock_bin="$project_dir/tests/fixtures/mock-gnome-bin"
target_home="$test_root/home"
mkdir -p "$target_home"
HOME="$target_home" \
XDG_SESSION_TYPE=wayland \
MOCK_GNOME_VERSION=50 \
PATH="$mock_bin:/usr/bin:/bin" \
    "$release_dir/scripts/install.sh" >/dev/null
cmp "$release_dir/src/stickymd" "$target_home/.local/bin/stickymd"
cmp \
    "$release_dir/src/gnome-shell/stickymd@local/extension-modern.js" \
    "$target_home/.local/share/gnome-shell/extensions/stickymd@local/extension.js"

HOME="$target_home" \
XDG_SESSION_TYPE=wayland \
MOCK_GNOME_VERSION=50 \
PATH="$mock_bin:/usr/bin:/bin" \
    "$release_dir/scripts/uninstall.sh" >/dev/null
test ! -e "$target_home/.local/bin/stickymd"

printf 'Release archive contents and installation passed.\n'
