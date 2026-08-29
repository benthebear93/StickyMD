#!/bin/sh
set -eu

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output_dir=${1:-"$source_dir/dist"}
version=$("$source_dir/stickymd" --version)
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
extension_dir="$package_dir/gnome-shell-extension/stickymd@local"

mkdir -p "$extension_dir" "$package_dir/docs/images"

for executable in install.sh uninstall.sh stickymd simple-sticky; do
    install -m 0755 "$source_dir/$executable" "$package_dir/$executable"
done

for template in \
    simple-sticky.desktop.in \
    stickymd.desktop.in \
    stickymd-new.desktop.in
do
    install -m 0644 "$source_dir/$template" "$package_dir/$template"
done

for extension_file in \
    extension.js \
    extension-modern.js \
    metadata.json \
    metadata-modern.json \
    wayland-core.js \
    stylesheet.css
do
    install -m 0644 \
        "$source_dir/gnome-shell-extension/stickymd@local/$extension_file" \
        "$extension_dir/$extension_file"
done

# Keep the end-user guide and screenshot, but omit its developer-only section.
sed '/^## Development$/,$d' "$source_dir/README.md" > "$package_dir/README.md"
chmod 0644 "$package_dir/README.md"
install -m 0644 \
    "$source_dir/docs/images/stickymd-live-markdown.png" \
    "$package_dir/docs/images/stickymd-live-markdown.png"

tar -C "$build_root" -czf "$temporary_archive" "$package_name"
chmod 0644 "$temporary_archive"
archive="$output_dir/$package_name.tar.gz"
mv -f "$temporary_archive" "$archive"

trap - EXIT HUP INT TERM
rm -rf "$build_root"
printf 'Created %s\n' "$archive"
