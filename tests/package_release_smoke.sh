#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
output_dir="$test_root/output"

"$project_dir/package-release.sh" "$output_dir" >/dev/null
version=$("$project_dir/stickymd" --version)
version=${version#StickyMD }
package_name="stickymd-$version"
archive="$output_dir/$package_name.tar.gz"
release_dir="$test_root/$package_name"

test -f "$archive"
tar -C "$test_root" -xzf "$archive"

for required in \
    README.md \
    install.sh \
    uninstall.sh \
    stickymd \
    simple-sticky \
    simple-sticky.desktop.in \
    stickymd.desktop.in \
    stickymd-new.desktop.in \
    docs/images/stickymd-live-markdown.png \
    gnome-shell-extension/stickymd@local/extension.js \
    gnome-shell-extension/stickymd@local/extension-modern.js \
    gnome-shell-extension/stickymd@local/metadata.json \
    gnome-shell-extension/stickymd@local/metadata-modern.json \
    gnome-shell-extension/stickymd@local/wayland-core.js \
    gnome-shell-extension/stickymd@local/stylesheet.css
do
    test -f "$release_dir/$required"
done

for excluded in \
    .github \
    .gitignore \
    CHANGELOG.md \
    IMPLEMENTATION_REPORT.md \
    package.json \
    package-extensions.sh \
    package-release.sh \
    tests
do
    test ! -e "$release_dir/$excluded"
done

if grep -q '^## Development$' "$release_dir/README.md"; then
    printf 'Release README unexpectedly contains the development section.\n' >&2
    exit 1
fi

test -x "$release_dir/install.sh"
test -x "$release_dir/uninstall.sh"
test -x "$release_dir/stickymd"
test -x "$release_dir/simple-sticky"
sh -n \
    "$release_dir/install.sh" \
    "$release_dir/uninstall.sh" \
    "$release_dir/stickymd"

mock_bin="$project_dir/tests/fixtures/mock-gnome-bin"
target_home="$test_root/home"
mkdir -p "$target_home"
HOME="$target_home" \
XDG_SESSION_TYPE=wayland \
MOCK_GNOME_VERSION=50 \
PATH="$mock_bin:/usr/bin:/bin" \
    "$release_dir/install.sh" >/dev/null
cmp "$release_dir/stickymd" "$target_home/.local/bin/stickymd"
cmp \
    "$release_dir/gnome-shell-extension/stickymd@local/extension-modern.js" \
    "$target_home/.local/share/gnome-shell/extensions/stickymd@local/extension.js"

HOME="$target_home" \
XDG_SESSION_TYPE=wayland \
MOCK_GNOME_VERSION=50 \
PATH="$mock_bin:/usr/bin:/bin" \
    "$release_dir/uninstall.sh" >/dev/null
test ! -e "$target_home/.local/bin/stickymd"

printf 'Release archive contents and installation passed.\n'
