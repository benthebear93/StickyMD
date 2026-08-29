#!/bin/sh
set -eu

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
extension_source="$source_dir/gnome-shell-extension/stickymd@local"
output_dir=${1:-"$source_dir/dist"}
mkdir -p "$output_dir"
output_dir=$(CDPATH= cd -- "$output_dir" && pwd)
build_root=$(mktemp -d)
trap 'rm -rf "$build_root"' EXIT HUP INT TERM

legacy_dir="$build_root/legacy/stickymd@local"
modern_dir="$build_root/modern/stickymd@local"
mkdir -p "$legacy_dir" "$modern_dir"

install -m 0644 "$extension_source/extension.js" "$legacy_dir/extension.js"
install -m 0644 "$extension_source/metadata.json" "$legacy_dir/metadata.json"
gnome-extensions pack --force --quiet --out-dir "$output_dir" "$legacy_dir"
mv -f \
    "$output_dir/stickymd@local.shell-extension.zip" \
    "$output_dir/stickymd-gnome-42-44.shell-extension.zip"

install -m 0644 \
    "$extension_source/extension-modern.js" \
    "$modern_dir/extension.js"
install -m 0644 \
    "$extension_source/metadata-modern.json" \
    "$modern_dir/metadata.json"
install -m 0644 \
    "$extension_source/wayland-core.js" \
    "$modern_dir/wayland-core.js"
install -m 0644 \
    "$extension_source/stylesheet.css" \
    "$modern_dir/stylesheet.css"
gnome-extensions pack \
    --force \
    --quiet \
    --extra-source=wayland-core.js \
    --out-dir "$output_dir" \
    "$modern_dir"
mv -f \
    "$output_dir/stickymd@local.shell-extension.zip" \
    "$output_dir/stickymd-gnome-45-50.shell-extension.zip"

printf 'Created:\n%s\n%s\n' \
    "$output_dir/stickymd-gnome-42-44.shell-extension.zip" \
    "$output_dir/stickymd-gnome-45-50.shell-extension.zip"
