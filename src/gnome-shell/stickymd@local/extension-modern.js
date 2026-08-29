import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    DEFAULT_GEOMETRY,
    NEW_NOTE_OFFSET,
    RESIZE_DIRECTIONS,
    checkboxSpanAtCharacterOffset,
    clampMovedGeometry,
    clampNewGeometry,
    classifyDiskText,
    computeResizeGeometry,
    loadRegistryData,
    normalizeGeometry,
    noteFilename,
    noteReferenceText,
    parseLiveMarkdown,
    serializeRegistry,
    shortNoteReference,
    utf16IndexToCharacterOffset,
    utf16IndexToUtf8Offset,
} from './wayland-core.js';

const EXTENSION_UUID = 'stickymd@local';
const DBUS_NAME = 'org.stickymd.StickyMD';
const DBUS_PATH = '/org/stickymd/StickyMD';
const DBUS_XML = `
<node>
  <interface name="org.stickymd.StickyMD">
    <method name="Start"/>
    <method name="Ensure"/>
    <method name="New"/>
    <method name="Quit"/>
  </interface>
</node>`;

const SAVE_DELAY_MS = 400;
const RELOAD_DELAY_MS = 120;
const STATE_DELAY_MS = 400;
const STYLE_DELAY_MS = 50;
const RESIZE_BORDER = 8;
const CORNER_SIZE = 12;
const TOP_BAR_HEIGHT = 28;
const EDITOR_PADDING = 14;
const CONTROLS_WIDTH = 116;
const CONTROLS_HEIGHT = 22;
const HEADING_FONT_SIZES = {
    'heading-1': 22,
    'heading-2': 19,
    'heading-3': 17,
};
const CHECKBOX_FONT_SIZE = 15;

const RESIZE_CURSORS = {
    n: Meta.Cursor.NORTH_RESIZE,
    s: Meta.Cursor.SOUTH_RESIZE,
    w: Meta.Cursor.WEST_RESIZE,
    e: Meta.Cursor.EAST_RESIZE,
    nw: Meta.Cursor.NW_RESIZE,
    ne: Meta.Cursor.NE_RESIZE,
    sw: Meta.Cursor.SW_RESIZE,
    se: Meta.Cursor.SE_RESIZE,
};

function removeSource(sourceId) {
    if (sourceId)
        GLib.source_remove(sourceId);
    return 0;
}

function ensureDirectory(path) {
    if (GLib.mkdir_with_parents(path, 0o700) !== 0)
        throw new Error(`Could not create directory: ${path}`);
}

function fileExists(path) {
    return GLib.file_test(path, GLib.FileTest.IS_REGULAR);
}

function readUtf8(path) {
    const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
    if (!ok)
        throw new Error(`Could not read ${path}`);
    return new TextDecoder('utf-8', {fatal: true}).decode(contents);
}

function fileSignature(path) {
    const info = Gio.File.new_for_path(path).query_info(
        'id::file,standard::size,time::modified,time::modified-usec',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null
    );
    return [
        'id::file',
        'standard::size',
        'time::modified',
        'time::modified-usec',
    ].map(attribute => info.get_attribute_as_string(attribute) ?? '')
        .join(':');
}

function readUtf8Snapshot(path) {
    const file = Gio.File.new_for_path(path);
    const [ok, contents] = file.load_contents(null);
    if (!ok)
        throw new Error(`Could not read ${path}`);
    return {
        text: new TextDecoder('utf-8', {fatal: true}).decode(contents),
        signature: fileSignature(path),
    };
}

function atomicWriteUtf8(path, text) {
    ensureDirectory(GLib.path_get_dirname(path));
    const file = Gio.File.new_for_path(path);
    const contents = new TextEncoder().encode(text);
    if (contents.length === 0) {
        // A zero-length Uint8Array is marshalled as NULL by GJS, but
        // g_file_replace_contents() requires a non-NULL contents pointer.
        // Closing a replacement stream without writes atomically commits an
        // empty file instead.
        const stream = file.replace(
            null,
            false,
            Gio.FileCreateFlags.NONE,
            null
        );
        if (!stream.close(null))
            throw new Error(`Could not commit empty file: ${path}`);
        return fileSignature(path);
    }
    const [success] = file.replace_contents(
        contents,
        null,
        false,
        Gio.FileCreateFlags.NONE,
        null
    );
    if (!success)
        throw new Error(`Could not replace file contents: ${path}`);
    return fileSignature(path);
}

function isDesktopWindowActor(actor) {
    if (!(actor instanceof Meta.WindowActor))
        return false;
    const window = actor.get_meta_window();
    if (!window)
        return false;
    if (window.get_window_type() === Meta.WindowType.DESKTOP)
        return true;

    // Ubuntu's Desktop Icons NG 47 emulates a desktop window on Wayland.
    // It remains a regular MetaWindow but marks its managed window object.
    const dingState = window.customJS_ding;
    return dingState?.keepAtBottom === true || dingState?._keepAtBottom === true;
}

function listNoteFiles(noteDirectory) {
    ensureDirectory(noteDirectory);
    const directory = Gio.File.new_for_path(noteDirectory);
    const enumerator = directory.enumerate_children(
        'standard::name,standard::type',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null
    );
    const filenames = [];
    try {
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_file_type() !== Gio.FileType.REGULAR)
                continue;
            const name = info.get_name();
            if (name === 'note.md' || /^note-[0-9a-f]{12}\.md$/.test(name))
                filenames.push(name);
        }
    } finally {
        enumerator.close(null);
    }
    return filenames;
}

function randomNoteId(existingIds) {
    while (true) {
        const candidate = GLib.uuid_string_random().replaceAll('-', '').slice(0, 12);
        if (!existingIds.has(candidate))
            return candidate;
    }
}

function pangoAttribute(attribute, text, start, end) {
    attribute.start_index = utf16IndexToUtf8Offset(text, start);
    attribute.end_index = utf16IndexToUtf8Offset(text, end);
    return attribute;
}

class StickyNote {
    constructor(manager, noteId, notePath, geometry) {
        this.manager = manager;
        this.noteId = noteId;
        this.notePath = notePath;
        this.geometry = normalizeGeometry(geometry);
        this._closing = false;
        this._deleting = false;
        this._applyingDiskText = false;
        this._dirty = false;
        this._saveSource = 0;
        this._reloadSource = 0;
        this._styleSource = 0;
        this._copyFeedbackSource = 0;
        this._lastSelfText = null;
        this._lastSelfSignature = null;
        this._spans = [];
        this._text = readUtf8(this.notePath);

        this.actor = new St.Widget({
            style_class: 'stickymd-note',
            reactive: true,
            track_hover: true,
            can_focus: false,
            layout_manager: new Clutter.FixedLayout(),
            clip_to_allocation: true,
        });
        this.actor.accessible_name = `StickyMD ${shortNoteReference(noteId)}`;

        this.scroller = new St.ScrollView({
            style_class: 'stickymd-editor-scroll',
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
        });
        this.scroller.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this.entry = new St.Entry({
            style_class: 'stickymd-editor',
            can_focus: true,
            x_expand: true,
        });
        this.textActor = this.entry.get_clutter_text();
        this.textActor.set_editable(true);
        this.textActor.set_selectable(true);
        this.textActor.set_activatable(false);
        this.textActor.set_single_line_mode(false);
        this.textActor.set_line_wrap(true);
        this.textActor.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        this.textActor.set_text(this._text);
        // St.ScrollView only accepts an St.Scrollable child. St.Entry is not
        // scrollable by itself, so keep it inside a vertical St.BoxLayout.
        this.editorBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        this.editorBox.add_child(this.entry);
        this.scroller.set_child(this.editorBox);

        this.moveHandle = new St.Widget({
            style_class: 'stickymd-move-handle',
            reactive: true,
            track_hover: true,
        });
        this.moveHandle.accessible_name = 'Move note';

        this.controls = new St.BoxLayout({
            style_class: 'stickymd-controls',
            reactive: true,
            visible: false,
        });
        this.referenceLabel = new St.Label({
            text: shortNoteReference(noteId),
            style_class: 'stickymd-reference',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.copyButton = this._controlButton('edit-copy-symbolic', 'Copy note reference');
        this.newButton = this._controlButton('list-add-symbolic', 'New note');
        this.deleteButton = this._controlButton('window-close-symbolic', 'Move note to Trash');
        this.controls.add_child(this.referenceLabel);
        this.controls.add_child(this.copyButton);
        this.controls.add_child(this.newButton);
        this.controls.add_child(this.deleteButton);

        this.actor.add_child(this.scroller);
        this.actor.add_child(this.moveHandle);
        this.actor.add_child(this.controls);

        this.resizeHandles = {};
        for (const direction of RESIZE_DIRECTIONS) {
            const handle = new St.Widget({
                style_class: `stickymd-resize-hit stickymd-resize-${direction}`,
                reactive: true,
                track_hover: true,
            });
            handle.accessible_name = `Resize note ${direction}`;
            this.resizeHandles[direction] = handle;
            this.actor.add_child(handle);
            handle.connect('enter-event', () => {
                global.display.set_cursor(RESIZE_CURSORS[direction]);
                return Clutter.EVENT_PROPAGATE;
            });
            handle.connect('leave-event', () => {
                if (!this.manager.pointerOperation)
                    global.display.set_cursor(Meta.Cursor.DEFAULT);
                return Clutter.EVENT_PROPAGATE;
            });
            handle.connect('button-press-event', (_actor, event) =>
                this._beginPointerOperation(event, direction, handle));
        }

        this.actor.connect('notify::hover', () => {
            this.controls.visible = this.actor.hover;
        });
        this.actor.connect('captured-event', (_actor, event) =>
            this._onNoteCapturedEvent(event));
        this.actor.connect('button-press-event', (_actor, event) => {
            if (event.get_source() === this.actor)
                return this._focusBlankEditor(event);
            this.manager.bringToFront(this.noteId);
            return Clutter.EVENT_PROPAGATE;
        });
        this.moveHandle.connect('enter-event', () => {
            global.display.set_cursor(Meta.Cursor.MOVE_OR_RESIZE_WINDOW);
            return Clutter.EVENT_PROPAGATE;
        });
        this.moveHandle.connect('leave-event', () => {
            if (!this.manager.pointerOperation)
                global.display.set_cursor(Meta.Cursor.DEFAULT);
            return Clutter.EVENT_PROPAGATE;
        });
        this.moveHandle.connect('button-press-event', (_actor, event) =>
            this._beginPointerOperation(event, 'move', this.moveHandle));
        this.copyButton.connect('clicked', () => this._copyReference());
        this.newButton.connect('clicked', () => this.manager.createNote(this.noteId, true));
        this.deleteButton.connect('clicked', () => this.manager.deleteNote(this.noteId));
        this.textActor.connect('notify::text', () => this._onTextChanged());
        this.textActor.connect('cursor-changed', () => this._scheduleStyles());
        this.textActor.connect('key-focus-in', () => this._scheduleStyles());
        this.textActor.connect('key-focus-out', () => this._scheduleStyles());
        // St.Entry reapplies CSS-derived Pango attributes in the default
        // style-changed handler. Run after that handler and restore note-local
        // attributes in the same frame, before hover or focus can be painted
        // with raw Markdown syntax.
        this.entry.connect_after('style-changed', () => this._applyStyles());
        this.textActor.connect('button-press-event', (_actor, event) =>
            this._onEditorPress(event));
        this.textActor.connect('key-press-event', (_actor, event) =>
            this._onKeyPress(event));

        this.setGeometry(this.geometry);
        this._applyStyles();
    }

    _controlButton(iconName, accessibleName) {
        const button = new St.Button({
            style_class: 'stickymd-control-button',
            reactive: true,
            can_focus: false,
            child: new St.Icon({icon_name: iconName, icon_size: 13}),
        });
        button.accessible_name = accessibleName;
        return button;
    }

    setGeometry(geometry) {
        this.geometry = normalizeGeometry(geometry, this.geometry);
        const {x, y, width, height} = this.geometry;
        this.actor.set_position(x, y);
        this.actor.set_size(width, height);

        const editorX = RESIZE_BORDER + EDITOR_PADDING - 2;
        const editorY = TOP_BAR_HEIGHT;
        const editorWidth = Math.max(1, width - 2 * editorX);
        const editorHeight = Math.max(1, height - editorY - EDITOR_PADDING);
        this.scroller.set_position(editorX, editorY);
        this.scroller.set_size(editorWidth, editorHeight);
        this.editorBox.set_width(editorWidth - 2);
        this.entry.set_width(editorWidth - 2);

        this.controls.set_position(width - CONTROLS_WIDTH - RESIZE_BORDER, 3);
        this.controls.set_size(CONTROLS_WIDTH, CONTROLS_HEIGHT);
        this.moveHandle.set_position(RESIZE_BORDER, RESIZE_BORDER);
        this.moveHandle.set_size(
            Math.max(1, width - CONTROLS_WIDTH - RESIZE_BORDER * 3),
            TOP_BAR_HEIGHT - RESIZE_BORDER
        );
        this._layoutResizeHandles(width, height);
    }

    _layoutResizeHandles(width, height) {
        const edgeLengthX = Math.max(1, width - 2 * CORNER_SIZE);
        const edgeLengthY = Math.max(1, height - 2 * CORNER_SIZE);
        const placements = {
            n: [CORNER_SIZE, 0, edgeLengthX, RESIZE_BORDER],
            s: [CORNER_SIZE, height - RESIZE_BORDER, edgeLengthX, RESIZE_BORDER],
            w: [0, CORNER_SIZE, RESIZE_BORDER, edgeLengthY],
            e: [width - RESIZE_BORDER, CORNER_SIZE, RESIZE_BORDER, edgeLengthY],
            nw: [0, 0, CORNER_SIZE, CORNER_SIZE],
            ne: [width - CORNER_SIZE, 0, CORNER_SIZE, CORNER_SIZE],
            sw: [0, height - CORNER_SIZE, CORNER_SIZE, CORNER_SIZE],
            se: [width - CORNER_SIZE, height - CORNER_SIZE, CORNER_SIZE, CORNER_SIZE],
        };
        for (const [direction, [x, y, handleWidth, handleHeight]] of
            Object.entries(placements)) {
            this.resizeHandles[direction].set_position(x, y);
            this.resizeHandles[direction].set_size(handleWidth, handleHeight);
        }
    }

    _beginPointerOperation(event, direction, actor) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        const [stageX, stageY] = event.get_coords();
        this.manager.beginPointerOperation(
            this,
            direction,
            actor,
            stageX,
            stageY
        );
        return Clutter.EVENT_STOP;
    }

    _onKeyPress(event) {
        const state = event.get_state();
        const symbol = event.get_key_symbol();
        if ((state & Clutter.ModifierType.CONTROL_MASK) &&
            (symbol === Clutter.KEY_n || symbol === Clutter.KEY_N)) {
            this.manager.createNote(this.noteId, true);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onEditorPress(event) {
        this.manager.bringToFront(this.noteId);
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        const [stageX, stageY] = event.get_coords();
        const [inside, localX, localY] = this.textActor.transform_stage_point(
            stageX,
            stageY
        );
        if (!inside)
            return Clutter.EVENT_PROPAGATE;
        const offset = this.textActor.coords_to_position(localX, localY);
        const text = this.textActor.get_text();
        const span = checkboxSpanAtCharacterOffset(text, this._spans, offset);
        if (!span)
            return Clutter.EVENT_PROPAGATE;

        const replacement = span.kind === 'checkbox-checked' ? ' ' : 'x';
        const updated = `${text.slice(0, span.marker)}${replacement}` +
            text.slice(span.marker + 1);
        this.textActor.set_text(updated);
        this.textActor.set_cursor_position(
            utf16IndexToCharacterOffset(updated, span.marker + 1)
        );
        return Clutter.EVENT_STOP;
    }

    _onNoteCapturedEvent(event) {
        if (event.type() !== Clutter.EventType.BUTTON_PRESS)
            return Clutter.EVENT_PROPAGATE;
        const source = event.get_source();
        // GNOME Shell 46 may report a null source during capture. Coordinates
        // remain reliable. Let clicks within the allocated text actor continue
        // to Clutter.Text so cursor placement, selection, and checkbox hit
        // testing keep working; only blank viewport space needs the fallback.
        if (source === null && this._eventInsideActor(event, this.textActor))
            return Clutter.EVENT_PROPAGATE;
        if (source !== null &&
            source !== this.scroller && source !== this.editorBox)
            return Clutter.EVENT_PROPAGATE;
        return this._focusBlankEditor(event);
    }

    _eventInsideActor(event, actor) {
        const [stageX, stageY] = event.get_coords();
        const [transformed, localX, localY] = actor.transform_stage_point(
            stageX,
            stageY
        );
        return transformed && localX >= 0 && localY >= 0 &&
            localX < actor.get_width() && localY < actor.get_height();
    }

    _focusBlankEditor(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        const [stageX, stageY] = event.get_coords();
        const [transformed, localX, localY] = this.scroller.transform_stage_point(
            stageX,
            stageY
        );
        if (!transformed || localX < 0 || localY < 0 ||
            localX >= this.scroller.get_width() ||
            localY >= this.scroller.get_height())
            return Clutter.EVENT_PROPAGATE;
        this.manager.bringToFront(this.noteId);
        this.textActor.grab_key_focus();
        this.textActor.set_cursor_position(-1);
        return Clutter.EVENT_STOP;
    }

    _onTextChanged() {
        this._styleSource = removeSource(this._styleSource);
        this._applyStyles();
        if (this._applyingDiskText || this._closing)
            return;
        this._dirty = true;
        this._saveSource = removeSource(this._saveSource);
        this._saveSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            SAVE_DELAY_MS,
            () => this._saveNow()
        );
    }

    _saveNow() {
        this._saveSource = 0;
        if (this._closing && !this._dirty)
            return GLib.SOURCE_REMOVE;
        const text = this.textActor.get_text();
        try {
            this._lastSelfSignature = atomicWriteUtf8(this.notePath, text);
        } catch (error) {
            console.error(`StickyMD could not save ${this.notePath}: ${error}`);
            if (!this._closing) {
                this._saveSource = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    SAVE_DELAY_MS,
                    () => this._saveNow()
                );
            }
            return GLib.SOURCE_REMOVE;
        }
        this._text = text;
        this._lastSelfText = text;
        this._dirty = false;
        return GLib.SOURCE_REMOVE;
    }

    flush() {
        this._saveSource = removeSource(this._saveSource);
        if (this._dirty)
            this._saveNow();
    }

    scheduleReload() {
        if (this._closing || this._deleting)
            return;
        this._reloadSource = removeSource(this._reloadSource);
        this._reloadSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            RELOAD_DELAY_MS,
            () => this._reloadFromDisk()
        );
    }

    _reloadFromDisk() {
        this._reloadSource = 0;
        if (this._closing || this._deleting)
            return GLib.SOURCE_REMOVE;
        let snapshot;
        try {
            snapshot = readUtf8Snapshot(this.notePath);
        } catch (error) {
            if (!fileExists(this.notePath)) {
                this._reloadSource = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    RELOAD_DELAY_MS,
                    () => this._recreateMissingFile()
                );
            } else {
                console.error(`StickyMD could not reload ${this.notePath}: ${error}`);
            }
            return GLib.SOURCE_REMOVE;
        }
        const diskText = snapshot.text;
        const bufferText = this.textActor.get_text();
        const classification = classifyDiskText(
            diskText,
            bufferText,
            this._lastSelfText,
            this._dirty,
            snapshot.signature,
            this._lastSelfSignature
        );
        if (classification === 'self-before-local-edit')
            return GLib.SOURCE_REMOVE;
        if (classification === 'self' || classification === 'same') {
            this._text = diskText;
            if (classification === 'same') {
                this._saveSource = removeSource(this._saveSource);
                this._dirty = false;
            }
            return GLib.SOURCE_REMOVE;
        }

        this._saveSource = removeSource(this._saveSource);
        this._applyingDiskText = true;
        try {
            this.textActor.set_text(diskText);
        } finally {
            this._applyingDiskText = false;
        }
        this._text = diskText;
        this._lastSelfText = null;
        this._lastSelfSignature = null;
        this._dirty = false;
        this._scheduleStyles();
        return GLib.SOURCE_REMOVE;
    }

    _recreateMissingFile() {
        this._reloadSource = 0;
        if (this._closing || this._deleting || fileExists(this.notePath))
            return GLib.SOURCE_REMOVE;
        try {
            const text = this.textActor.get_text();
            this._lastSelfSignature = atomicWriteUtf8(this.notePath, text);
            this._lastSelfText = text;
        } catch (error) {
            console.error(`StickyMD could not recreate ${this.notePath}: ${error}`);
        }
        return GLib.SOURCE_REMOVE;
    }

    _scheduleStyles() {
        if (this._closing)
            return;
        this._styleSource = removeSource(this._styleSource);
        this._styleSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            STYLE_DELAY_MS,
            () => this._applyStyles()
        );
    }

    _applyStyles() {
        this._styleSource = 0;
        if (this._closing)
            return GLib.SOURCE_REMOVE;
        const text = this.textActor.get_text();
        const spans = parseLiveMarkdown(text);
        const attributes = new Pango.AttrList();
        const cursor = this.textActor.get_cursor_position();
        const editorFocused = this.textActor.has_key_focus();

        for (const span of spans) {
            const styleAttributes = [];
            if (span.kind in HEADING_FONT_SIZES) {
                styleAttributes.push(Pango.attr_weight_new(Pango.Weight.BOLD));
                styleAttributes.push(Pango.attr_size_new_absolute(
                    HEADING_FONT_SIZES[span.kind] * Pango.SCALE
                ));
            } else if (span.kind === 'bold') {
                styleAttributes.push(Pango.attr_weight_new(Pango.Weight.BOLD));
            } else if (span.kind.startsWith('checkbox-')) {
                styleAttributes.push(Pango.attr_family_new('Monospace'));
                styleAttributes.push(Pango.attr_weight_new(Pango.Weight.BOLD));
                styleAttributes.push(Pango.attr_size_new_absolute(
                    CHECKBOX_FONT_SIZE * Pango.SCALE
                ));
                if (span.kind === 'checkbox-checked') {
                    styleAttributes.push(Pango.attr_foreground_new(
                        0x5555,
                        0x5555,
                        0x5555
                    ));
                }
            }
            for (const attribute of styleAttributes)
                attributes.insert(pangoAttribute(attribute, text, span.start, span.end));

            const lineStart = utf16IndexToCharacterOffset(text, span.lineStart);
            const lineEnd = utf16IndexToCharacterOffset(text, span.lineEnd);
            const activeLine = editorFocused &&
                lineStart <= cursor && cursor <= lineEnd;
            for (const [syntaxStart, syntaxEnd] of span.syntax) {
                if (activeLine) {
                    const gray = Pango.attr_foreground_new(0x7777, 0x7777, 0x7777);
                    attributes.insert(
                        pangoAttribute(gray, text, syntaxStart, syntaxEnd)
                    );
                } else {
                    const transparent = Pango.attr_foreground_alpha_new(0);
                    // Clutter adds a global resource-scale Pango attribute and
                    // may replace ranged scale attributes. An absolute size
                    // survives that merge and collapses hidden syntax.
                    const collapsed = Pango.attr_size_new_absolute(1);
                    attributes.insert(
                        pangoAttribute(transparent, text, syntaxStart, syntaxEnd)
                    );
                    attributes.insert(
                        pangoAttribute(collapsed, text, syntaxStart, syntaxEnd)
                    );
                }
            }
        }
        this.textActor.set_attributes(attributes);
        this._spans = spans;
        return GLib.SOURCE_REMOVE;
    }

    _copyReference() {
        this.flush();
        const text = this.textActor.get_text();
        St.Clipboard.get_default().set_text(
            St.ClipboardType.CLIPBOARD,
            noteReferenceText(this.noteId, this.notePath, text)
        );
        this.copyButton.set_child(new St.Icon({
            icon_name: 'emblem-ok-symbolic',
            icon_size: 13,
        }));
        this._copyFeedbackSource = removeSource(this._copyFeedbackSource);
        this._copyFeedbackSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            1200,
            () => {
                this._copyFeedbackSource = 0;
                if (!this._closing) {
                    this.copyButton.set_child(new St.Icon({
                        icon_name: 'edit-copy-symbolic',
                        icon_size: 13,
                    }));
                }
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    focusEditor() {
        this.textActor.grab_key_focus();
        this.textActor.set_cursor_position(-1);
    }

    prepareDelete() {
        this._deleting = true;
        this.flush();
        this._reloadSource = removeSource(this._reloadSource);
    }

    destroy() {
        if (this._closing)
            return;
        this.flush();
        this._closing = true;
        this._saveSource = removeSource(this._saveSource);
        this._reloadSource = removeSource(this._reloadSource);
        this._styleSource = removeSource(this._styleSource);
        this._copyFeedbackSource = removeSource(this._copyFeedbackSource);
        this.actor.destroy();
    }
}

class WaylandNoteManager {
    constructor(onStateChanged) {
        const home = GLib.get_home_dir();
        this.noteDirectory = GLib.build_filenamev([home, 'StickyNotes']);
        this.stateDirectory = GLib.build_filenamev([
            home,
            '.local',
            'state',
            'simple-sticky',
        ]);
        this.statePath = GLib.build_filenamev([this.stateDirectory, 'state.json']);
        this.fallbackTrash = GLib.build_filenamev([this.noteDirectory, '.trash']);
        this.onStateChanged = onStateChanged;
        this.records = {};
        this.order = [];
        this.notes = new Map();
        this.layer = null;
        this.running = false;
        this.pointerOperation = null;
        this._pointerEventId = 0;
        this._pointerEventActor = null;
        this._pointerGrab = null;
        this._stateSource = 0;
        this._directoryMonitor = null;
        this._directoryMonitorId = 0;
        this._restackedId = 0;
        this._monitorsChangedId = 0;
    }

    start() {
        if (this.running)
            return;
        ensureDirectory(this.noteDirectory);
        ensureDirectory(this.stateDirectory);
        this._loadRegistry();
        this.layer = new St.Widget({
            name: 'stickymd-note-layer',
            reactive: false,
            layout_manager: new Clutter.FixedLayout(),
            width: global.screen_width,
            height: global.screen_height,
        });
        global.window_group.add_child(this.layer);
        this.running = true;
        try {
            this._lowerLayer();
            for (const noteId of this.order)
                this._showNote(noteId);
            this._directoryMonitor = Gio.File.new_for_path(this.noteDirectory)
                .monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._directoryMonitorId = this._directoryMonitor.connect(
                'changed',
                (_monitor, file, otherFile) =>
                    this._onDirectoryChanged(file, otherFile)
            );
            this._restackedId = global.display.connect('restacked', () =>
                this._lowerLayer());
            this._monitorsChangedId = Main.layoutManager.connect(
                'monitors-changed',
                () => this._onMonitorsChanged()
            );
        } catch (error) {
            this.stop();
            throw error;
        }
        this.onStateChanged();
    }

    stop() {
        if (!this.running)
            return;
        this._finishPointerOperation();
        for (const note of this.notes.values())
            note.destroy();
        this.notes.clear();
        this._saveStateNow();
        if (this._directoryMonitor && this._directoryMonitorId)
            this._directoryMonitor.disconnect(this._directoryMonitorId);
        this._directoryMonitorId = 0;
        if (this._directoryMonitor)
            this._directoryMonitor.cancel();
        this._directoryMonitor = null;
        if (this._restackedId)
            global.display.disconnect(this._restackedId);
        this._restackedId = 0;
        if (this._monitorsChangedId)
            Main.layoutManager.disconnect(this._monitorsChangedId);
        this._monitorsChangedId = 0;
        if (this.layer)
            this.layer.destroy();
        this.layer = null;
        this.running = false;
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        this.onStateChanged();
    }

    _loadRegistry() {
        let raw = null;
        let stateText = '';
        try {
            stateText = readUtf8(this.statePath);
            raw = JSON.parse(stateText);
        } catch (_error) {
            raw = null;
        }
        const filenames = listNoteFiles(this.noteDirectory);
        const loaded = loadRegistryData(raw, filenames, true);
        this.records = loaded.records;
        this.order = loaded.order;
        if (loaded.createPrimary) {
            const primaryPath = GLib.build_filenamev([this.noteDirectory, 'note.md']);
            if (!fileExists(primaryPath))
                atomicWriteUtf8(primaryPath, '');
        }
        if (!loaded.isV2 && stateText) {
            const backup = GLib.build_filenamev([
                this.stateDirectory,
                'state.v1.json.bak',
            ]);
            if (!fileExists(backup))
                atomicWriteUtf8(backup, stateText);
        }
        if (loaded.changed)
            this._saveStateNow();
    }

    _lowerLayer() {
        if (!this.layer)
            return;
        const children = global.window_group.get_children();
        const backgroundGroup = children.find(
            child => child instanceof Meta.BackgroundGroup
        );
        if (!backgroundGroup)
            throw new Error('GNOME Shell background layer is unavailable');

        // Keep the notes above real desktop windows and Ubuntu DING's
        // transparent input window, while every ordinary window stays above.
        const desktopWindows = children.filter(isDesktopWindowActor);
        const anchor = desktopWindows.at(-1) ?? backgroundGroup;
        global.window_group.set_child_above_sibling(this.layer, anchor);
    }

    _showNote(noteId) {
        const record = this.records[noteId];
        if (!record || !this.layer)
            return;
        const notePath = GLib.build_filenamev([this.noteDirectory, record.file]);
        const note = new StickyNote(this, noteId, notePath, record);
        this.notes.set(noteId, note);
        this.layer.add_child(note.actor);
        // The first St.Entry style pass happens only after the actor joins the
        // stage and would otherwise replace constructor-time Pango attributes.
        note._scheduleStyles();
    }

    createNote(sourceId = null, focus = true) {
        if (!this.running)
            this.start();
        const source = sourceId ? this.notes.get(sourceId) :
            this.notes.get(this.order.at(-1));
        let geometry;
        let workarea;
        if (source) {
            workarea = this.workareaForGeometry(source.geometry);
            geometry = {
                x: source.geometry.x + NEW_NOTE_OFFSET,
                y: source.geometry.y + NEW_NOTE_OFFSET,
                width: DEFAULT_GEOMETRY.width,
                height: DEFAULT_GEOMETRY.height,
            };
        } else {
            workarea = this.defaultWorkarea();
            geometry = {
                ...DEFAULT_GEOMETRY,
                x: workarea.x + DEFAULT_GEOMETRY.x,
                y: workarea.y + DEFAULT_GEOMETRY.y,
            };
        }
        geometry = clampNewGeometry(geometry, workarea);
        const primaryPath = GLib.build_filenamev([this.noteDirectory, 'note.md']);
        const noteId = Object.keys(this.records).length === 0 && !fileExists(primaryPath)
            ? 'primary'
            : randomNoteId(new Set(Object.keys(this.records)));
        const filename = noteFilename(noteId);
        const notePath = GLib.build_filenamev([this.noteDirectory, filename]);
        atomicWriteUtf8(notePath, '');
        this.records[noteId] = {file: filename, ...geometry};
        this.order.push(noteId);
        this._saveStateNow();
        this._showNote(noteId);
        this.bringToFront(noteId);
        if (focus)
            this.notes.get(noteId)?.focusEditor();
        return noteId;
    }

    deleteNote(noteId) {
        const note = this.notes.get(noteId);
        const record = this.records[noteId];
        if (!note || !record)
            return false;
        note.prepareDelete();
        const path = GLib.build_filenamev([this.noteDirectory, record.file]);
        try {
            const file = Gio.File.new_for_path(path);
            if (!file.trash(null))
                throw new Error('Trash operation returned false');
        } catch (trashError) {
            try {
                ensureDirectory(this.fallbackTrash);
                const stamp = GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S');
                const target = GLib.build_filenamev([
                    this.fallbackTrash,
                    `${stamp}-${GLib.uuid_string_random().slice(0, 8)}-${record.file}`,
                ]);
                Gio.File.new_for_path(path).move(
                    Gio.File.new_for_path(target),
                    Gio.FileCopyFlags.NONE,
                    null,
                    null
                );
            } catch (fallbackError) {
                note._deleting = false;
                console.error(
                    `StickyMD could not recoverably delete ${path}: ` +
                    `${trashError}; ${fallbackError}`
                );
                return false;
            }
        }
        note.destroy();
        this.notes.delete(noteId);
        delete this.records[noteId];
        this.order = this.order.filter(item => item !== noteId);
        this._saveStateNow();
        return true;
    }

    bringToFront(noteId) {
        const note = this.notes.get(noteId);
        if (!note || !this.layer)
            return;
        this.layer.set_child_above_sibling(note.actor, null);
        const newOrder = this.order.filter(item => item !== noteId);
        newOrder.push(noteId);
        if (newOrder.join('\0') !== this.order.join('\0')) {
            this.order = newOrder;
            this._scheduleStateSave();
        }
    }

    beginPointerOperation(note, direction, actor, stageX, stageY) {
        this._finishPointerOperation();
        this.bringToFront(note.noteId);
        this.pointerOperation = {
            note,
            direction,
            stageX,
            stageY,
            geometry: {...note.geometry},
            workarea: this.workareaForGeometry(note.geometry),
        };
        global.display.set_cursor(
            direction === 'move'
                ? Meta.Cursor.MOVE_OR_RESIZE_WINDOW
                : RESIZE_CURSORS[direction]
        );
        this._pointerEventActor = actor;
        this._pointerEventId = actor.connect(
            'event',
            (_eventActor, event) => this._onPointerEvent(event)
        );
        this._pointerGrab = global.stage.grab(actor);
    }

    _onPointerEvent(event) {
        if (!this.pointerOperation)
            return Clutter.EVENT_PROPAGATE;
        const eventType = event.type();
        if (eventType === Clutter.EventType.MOTION) {
            this._updatePointerOperation(event);
            return Clutter.EVENT_STOP;
        }
        if (eventType === Clutter.EventType.BUTTON_RELEASE &&
            event.get_button() === Clutter.BUTTON_PRIMARY) {
            this._updatePointerOperation(event);
            this._finishPointerOperation(true);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _updatePointerOperation(event) {
        const operation = this.pointerOperation;
        if (!operation)
            return;
        const [stageX, stageY] = event.get_coords();
        const deltaX = Math.round(stageX - operation.stageX);
        const deltaY = Math.round(stageY - operation.stageY);
        let geometry;
        if (operation.direction === 'move') {
            geometry = clampMovedGeometry({
                ...operation.geometry,
                x: operation.geometry.x + deltaX,
                y: operation.geometry.y + deltaY,
            }, operation.workarea);
        } else {
            geometry = computeResizeGeometry(
                operation.direction,
                operation.geometry,
                deltaX,
                deltaY,
                operation.workarea
            );
        }
        operation.note.setGeometry(geometry);
    }

    _finishPointerOperation(save = false) {
        const operation = this.pointerOperation;
        if (this._pointerEventActor && this._pointerEventId)
            this._pointerEventActor.disconnect(this._pointerEventId);
        this._pointerEventId = 0;
        this._pointerEventActor = null;
        if (this._pointerGrab)
            this._pointerGrab.dismiss();
        this._pointerGrab = null;
        this.pointerOperation = null;
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        if (save && operation)
            this.updateGeometry(operation.note.noteId, operation.note.geometry);
    }

    updateGeometry(noteId, geometry) {
        if (!this.records[noteId])
            return;
        const normalized = normalizeGeometry(geometry);
        Object.assign(this.records[noteId], normalized);
        this._scheduleStateSave();
    }

    _scheduleStateSave() {
        this._stateSource = removeSource(this._stateSource);
        this._stateSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            STATE_DELAY_MS,
            () => this._saveStateNow()
        );
    }

    _saveStateNow() {
        this._stateSource = removeSource(this._stateSource);
        try {
            atomicWriteUtf8(
                this.statePath,
                serializeRegistry(this.records, this.order)
            );
        } catch (error) {
            console.error(`StickyMD could not save ${this.statePath}: ${error}`);
        }
        return GLib.SOURCE_REMOVE;
    }

    _onDirectoryChanged(file, otherFile) {
        const names = new Set([file?.get_basename(), otherFile?.get_basename()]);
        for (const note of this.notes.values()) {
            if (names.has(GLib.path_get_basename(note.notePath)))
                note.scheduleReload();
        }
    }

    _onMonitorsChanged() {
        if (!this.layer)
            return;
        this.layer.set_size(global.screen_width, global.screen_height);
        for (const note of this.notes.values()) {
            const geometry = clampMovedGeometry(
                note.geometry,
                this.workareaForGeometry(note.geometry)
            );
            note.setGeometry(geometry);
            this.updateGeometry(note.noteId, geometry);
        }
        this._lowerLayer();
    }

    workareaForGeometry(geometry) {
        const centerX = geometry.x + Math.floor(geometry.width / 2);
        const centerY = geometry.y + Math.floor(geometry.height / 2);
        const monitors = Main.layoutManager.monitors;
        let monitorIndex = monitors.findIndex(monitor =>
            monitor.x <= centerX && centerX < monitor.x + monitor.width &&
            monitor.y <= centerY && centerY < monitor.y + monitor.height);
        if (monitorIndex < 0)
            monitorIndex = Main.layoutManager.primaryIndex ?? 0;
        const area = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
        return {x: area.x, y: area.y, width: area.width, height: area.height};
    }

    defaultWorkarea() {
        const monitorIndex = Main.layoutManager.primaryIndex ?? 0;
        const area = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
        return {x: area.x, y: area.y, width: area.width, height: area.height};
    }
}

class DBusController {
    constructor(extension) {
        this.extension = extension;
    }

    Start() {
        this.extension.handleCommand('start');
    }

    Ensure() {
        this.extension.handleCommand('ensure');
    }

    New() {
        this.extension.handleCommand('new');
    }

    Quit() {
        this.extension.handleCommand('quit');
    }
}

export default class StickyMDExtension extends Extension {
    enable() {
        this._isWayland = Meta.is_wayland_compositor();
        this._indicator = null;
        this._startItem = null;
        this._quitItem = null;
        this._pressHandlerId = 0;
        this._stateTimerId = 0;
        this._dbusObject = null;
        this._busOwnerId = 0;
        this._manager = this._isWayland
            ? new WaylandNoteManager(() => this._updateState())
            : null;

        this._createIndicator();
        this._exportDBus();
        if (this._isWayland) {
            try {
                this._manager.start();
            } catch (error) {
                console.error(`StickyMD could not start its desktop layer: ${error}`);
                Main.notifyError(
                    'StickyMD could not start',
                    'The GNOME desktop background layer is unavailable.'
                );
            }
        } else {
            this._stateTimerId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                1,
                () => {
                    this._updateState();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }
        this._updateState();
    }

    disable() {
        this._stateTimerId = removeSource(this._stateTimerId);
        if (this._manager)
            this._manager.stop();
        this._manager = null;
        if (this._busOwnerId)
            Gio.bus_unown_name(this._busOwnerId);
        this._busOwnerId = 0;
        if (this._dbusObject)
            this._dbusObject.unexport();
        this._dbusObject = null;
        if (this._indicator && this._pressHandlerId)
            this._indicator.disconnect(this._pressHandlerId);
        this._pressHandlerId = 0;
        this._indicator?.destroy();
        this._indicator = null;
        this._startItem = null;
        this._quitItem = null;
    }

    _createIndicator() {
        this._indicator = new PanelMenu.Button(0.0, 'StickyMD', false);
        this._indicator.add_child(new St.Icon({
            icon_name: 'document-edit-symbolic',
            style_class: 'system-status-icon',
        }));
        this._startItem = new PopupMenu.PopupMenuItem('Start StickyMD');
        this._startItem.connect('activate', () => this.handleCommand('start'));
        this._indicator.menu.addMenuItem(this._startItem);
        const newItem = new PopupMenu.PopupMenuItem('New note');
        newItem.connect('activate', () => this.handleCommand('new'));
        this._indicator.menu.addMenuItem(newItem);
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._quitItem = new PopupMenu.PopupMenuItem('Quit StickyMD');
        this._quitItem.connect('activate', () => this.handleCommand('quit'));
        this._indicator.menu.addMenuItem(this._quitItem);
        this._pressHandlerId = this._indicator.connect(
            'button-press-event',
            (_actor, event) => {
                const button = event.get_button();
                if (button === Clutter.BUTTON_PRIMARY) {
                    this._indicator.menu.close();
                    this.handleCommand(this._isRunning() ? 'new' : 'start');
                    return Clutter.EVENT_STOP;
                }
                if (button === Clutter.BUTTON_SECONDARY) {
                    this._updateState();
                    return Clutter.EVENT_PROPAGATE;
                }
                return Clutter.EVENT_PROPAGATE;
            }
        );
        Main.panel.addToStatusArea(EXTENSION_UUID, this._indicator, 0, 'right');
    }

    _exportDBus() {
        this._dbusObject = Gio.DBusExportedObject.wrapJSObject(
            DBUS_XML,
            new DBusController(this)
        );
        this._dbusObject.export(Gio.DBus.session, DBUS_PATH);
        this._busOwnerId = Gio.bus_own_name_on_connection(
            Gio.DBus.session,
            DBUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            null,
            null
        );
    }

    handleCommand(command) {
        if (this._isWayland) {
            try {
                if (command === 'start')
                    this._manager.start();
                else if (command === 'ensure') {
                    this._manager.start();
                    if (this._manager.notes.size === 0)
                        this._manager.createNote(null, true);
                }
                else if (command === 'new')
                    this._manager.createNote(null, true);
                else if (command === 'quit')
                    this._manager.stop();
            } catch (error) {
                console.error(`StickyMD ${command} failed: ${error}`);
                Main.notifyError('StickyMD command failed', `${error}`);
            }
            this._updateState();
            return;
        }

        try {
            const process = Gio.Subprocess.new(
                [this._launcherPath(), command],
                Gio.SubprocessFlags.STDOUT_SILENCE |
                    Gio.SubprocessFlags.STDERR_SILENCE
            );
            process.wait_check_async(null, (source, result) => {
                try {
                    source.wait_check_finish(result);
                } catch (error) {
                    console.error(`StickyMD ${command} failed: ${error}`);
                }
                GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    300,
                    () => {
                        this._updateState();
                        return GLib.SOURCE_REMOVE;
                    }
                );
            });
        } catch (error) {
            console.error(`StickyMD ${command} could not run: ${error}`);
        }
    }

    _launcherPath() {
        return GLib.build_filenamev([
            GLib.get_home_dir(),
            '.local',
            'bin',
            'stickymd',
        ]);
    }

    _isRunning() {
        if (this._isWayland)
            return this._manager?.running ?? false;
        const socketPath = GLib.build_filenamev([
            GLib.get_home_dir(),
            '.local',
            'state',
            'simple-sticky',
            'control.sock',
        ]);
        return GLib.file_test(socketPath, GLib.FileTest.EXISTS);
    }

    _updateState() {
        if (!this._indicator)
            return;
        const running = this._isRunning();
        this._indicator.opacity = running ? 255 : 110;
        this._indicator.accessible_name = running
            ? 'StickyMD: running; click to create a note'
            : 'StickyMD: stopped; click to restore notes';
        this._startItem.label.text = running ? 'StickyMD is running' : 'Start StickyMD';
        this._startItem.setSensitive(!running);
        this._quitItem.setSensitive(running);
    }
}
