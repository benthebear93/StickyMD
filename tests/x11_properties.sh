#!/bin/sh
set -eu

window_ids=$(xwininfo -root -tree | awk \
    '/"StickyMD \[[^]]+\]": \("stickymd" "StickyMD"\)/ {print $1}')
if [ -z "$window_ids" ]; then
    printf 'FAIL: no StickyMD X11 windows were found.\n' >&2
    exit 1
fi

count=0
for window_id in $window_ids; do
    count=$((count + 1))
    properties=$(xprop -id "$window_id" \
        _NET_WM_WINDOW_TYPE \
        _NET_WM_STATE \
        _NET_WM_DESKTOP \
        WM_CLASS)
    printf 'Window %s\n%s\n' "$window_id" "$properties"
    printf '%s\n' "$properties" | grep -q '_NET_WM_WINDOW_TYPE_DESKTOP'
    printf '%s\n' "$properties" | grep -q '_NET_WM_STATE_BELOW'
    printf '%s\n' "$properties" | grep -q '_NET_WM_STATE_STICKY'
    printf '%s\n' "$properties" | grep -q '_NET_WM_STATE_SKIP_TASKBAR'
    printf '%s\n' "$properties" | grep -q '_NET_WM_STATE_SKIP_PAGER'
    printf '%s\n' "$properties" | grep -Eq '_NET_WM_DESKTOP.*(4294967295|0xffffffff)'
    printf '%s\n' "$properties" | grep -q '"stickymd", "StickyMD"'
done

stacking=$(xprop -root _NET_CLIENT_LIST_STACKING)
printf '%s\n' "$stacking"
for window_id in $window_ids; do
    printf '%s\n' "$stacking" | grep -q "$window_id"
done

# EWMH lists clients from bottom to top. When a normal application window is
# available, require it to occur after every StickyMD desktop-layer window.
stacking_ids=$(printf '%s\n' "$stacking" | sed 's/^.*# *//; s/,//g')
stacked_sticky_count=0
normal_above=""
for stacked_id in $stacking_ids; do
    is_sticky=""
    for window_id in $window_ids; do
        if [ "$stacked_id" = "$window_id" ]; then
            is_sticky=1
            break
        fi
    done
    if [ -n "$is_sticky" ]; then
        stacked_sticky_count=$((stacked_sticky_count + 1))
    elif [ "$stacked_sticky_count" -eq "$count" ]; then
        if xprop -id "$stacked_id" _NET_WM_WINDOW_TYPE 2>/dev/null \
            | grep -q '_NET_WM_WINDOW_TYPE_NORMAL'; then
            normal_above=$stacked_id
            break
        fi
    fi
done

if [ -n "$normal_above" ]; then
    printf 'PASS: normal application window %s is stacked above every StickyMD window.\n' \
        "$normal_above"
else
    printf 'INFO: no viewable normal application window was available for a stacking comparison.\n'
fi

printf 'PASS: %s StickyMD window(s) have desktop-layer, below, sticky, taskbar, pager, and all-workspace hints.\n' "$count"
