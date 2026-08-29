#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir=${1:-"$project_dir/dist"}
version=$("$project_dir/src/stickymd" --version)
version=${version#StickyMD }

case "$version" in
    ''|*[!0-9.]*|.*|*.)
        printf 'Could not determine a valid StickyMD version: %s\n' "$version" >&2
        exit 1
        ;;
esac

mkdir -p "$output_dir"
output_dir=$(CDPATH= cd -- "$output_dir" && pwd)
package_name="stickymd-$version"
build_root=$(mktemp -d)
temporary_archive=$(mktemp "$output_dir/.stickymd-release.XXXXXX")
trap 'rm -rf "$build_root"; rm -f "$temporary_archive"' EXIT HUP INT TERM
package_dir="$build_root/$package_name"
extension_dir="$package_dir/src/gnome-shell/stickymd@local"

mkdir -p \
    "$extension_dir" \
    "$package_dir/data/applications" \
    "$package_dir/data/autostart" \
    "$package_dir/docs/images" \
    "$package_dir/scripts" \
    "$package_dir/src"

for script in install.sh uninstall.sh; do
    install -m 0755 \
        "$project_dir/scripts/$script" \
        "$package_dir/scripts/$script"
done

install -m 0755 "$project_dir/src/stickymd" "$package_dir/src/stickymd"
install -m 0755 \
    "$project_dir/src/x11_backend.py" \
    "$package_dir/src/x11_backend.py"
install -m 0644 \
    "$project_dir/data/applications/stickymd.desktop.in" \
    "$package_dir/data/applications/stickymd.desktop.in"
install -m 0644 \
    "$project_dir/data/applications/stickymd-new.desktop.in" \
    "$package_dir/data/applications/stickymd-new.desktop.in"
install -m 0644 \
    "$project_dir/data/autostart/stickymd.desktop.in" \
    "$package_dir/data/autostart/stickymd.desktop.in"

for extension_file in \
    extension.js \
    extension-modern.js \
    metadata.json \
    metadata-modern.json \
    wayland-core.js \
    stylesheet.css
do
    install -m 0644 \
        "$project_dir/src/gnome-shell/stickymd@local/$extension_file" \
        "$extension_dir/$extension_file"
done

# Keep the end-user guide and screenshot, but omit its developer-only section.
sed '/^## Development$/,$d' "$project_dir/README.md" > "$package_dir/README.md"
chmod 0644 "$package_dir/README.md"
install -m 0644 \
    "$project_dir/docs/images/stickymd-live-markdown.png" \
    "$package_dir/docs/images/stickymd-live-markdown.png"

tar -C "$build_root" -czf "$temporary_archive" "$package_name"
chmod 0644 "$temporary_archive"
archive="$output_dir/$package_name.tar.gz"
mv -f "$temporary_archive" "$archive"

trap - EXIT HUP INT TERM
rm -rf "$build_root"
printf 'Created %s\n' "$archive"
