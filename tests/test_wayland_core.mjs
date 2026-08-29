import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {
    DEFAULT_GEOMETRY,
    MIN_HEIGHT,
    MIN_WIDTH,
    checkboxSpanAtCharacterOffset,
    classifyDiskText,
    computeResizeGeometry,
    loadRegistryData,
    noteFilename,
    noteReferenceText,
    parseLiveMarkdown,
    serializeRegistry,
    utf16IndexToCharacterOffset,
    utf16IndexToUtf8Offset,
} from '../gnome-shell-extension/stickymd@local/wayland-core.js';

const modernExtensionSource = readFileSync(new URL(
    '../gnome-shell-extension/stickymd@local/extension-modern.js',
    import.meta.url
), 'utf8');

test('the modern editor uses a valid scrollable child', () => {
    assert.doesNotMatch(modernExtensionSource, /scroller\.add_actor\(/);
    assert.match(modernExtensionSource, /editorBox = new St\.BoxLayout\(/);
    assert.match(modernExtensionSource, /scroller\.set_child\(this\.editorBox\)/);
});

test('an empty note captures blank viewport clicks before child handling', () => {
    const scrollViewOptions = modernExtensionSource.match(
        /this\.scroller = new St\.ScrollView\(\{([\s\S]*?)\n\s*\}\);/
    )[1];
    const entryOptions = modernExtensionSource.match(
        /this\.entry = new St\.Entry\(\{([\s\S]*?)\n\s*\}\);/
    )[1];
    assert.doesNotMatch(modernExtensionSource, /this\.entry\.set_style\(/);
    assert.doesNotMatch(modernExtensionSource, /this\.editorBox\.set_style\(/);
    assert.match(modernExtensionSource, /connect\('captured-event'/);
    assert.match(modernExtensionSource, /_onNoteCapturedEvent\(event\)/);
    assert.match(
        modernExtensionSource,
        /source === null && this\._eventInsideActor\(event, this\.textActor\)/
    );
    assert.match(
        modernExtensionSource,
        /source !== null &&\n\s*source !== this\.scroller && source !== this\.editorBox/
    );
    assert.match(modernExtensionSource, /_focusBlankEditor\(event\)/);
    assert.match(modernExtensionSource, /this\.scroller\.transform_stage_point\(/);
    assert.match(
        modernExtensionSource,
        /this\.textActor\.set_cursor_position\(-1\);[\s\S]{0,300}return Clutter\.EVENT_STOP;/
    );
    assert.doesNotMatch(scrollViewOptions, /reactive/);
    assert.doesNotMatch(entryOptions, /y_expand/);
    assert.doesNotMatch(modernExtensionSource, /set_min_height\(/);
});

test('atomic writes preserve destinations and do not race a separate chmod', () => {
    assert.doesNotMatch(modernExtensionSource, /REPLACE_DESTINATION/);
    assert.doesNotMatch(modernExtensionSource, /set_attribute_uint32/);
    assert.match(modernExtensionSource, /Gio\.FileCreateFlags\.NONE/);
});

test('empty notes use an atomic stream instead of a null byte array', () => {
    assert.match(modernExtensionSource, /contents\.length === 0/);
    assert.match(modernExtensionSource, /const stream = file\.replace\(/);
    assert.match(modernExtensionSource, /stream\.close\(null\)/);
    assert.match(modernExtensionSource, /const \[success\] = file\.replace_contents\(/);
});

test('the note layer is placed above desktop and DING window actors', () => {
    assert.match(modernExtensionSource, /Meta\.WindowType\.DESKTOP/);
    assert.match(modernExtensionSource, /window\.customJS_ding/);
    assert.match(modernExtensionSource, /children\.filter\(isDesktopWindowActor\)/);
    assert.match(modernExtensionSource, /set_child_above_sibling\(this\.layer, anchor\)/);
});

test('GNOME 46 live styling uses reliable signals and absolute sizes', () => {
    assert.match(modernExtensionSource, /connect\('notify::text'/);
    assert.match(modernExtensionSource, /connect\('cursor-changed'/);
    assert.match(modernExtensionSource, /connect\('key-focus-in'/);
    assert.match(modernExtensionSource, /connect\('key-focus-out'/);
    assert.match(
        modernExtensionSource,
        /this\.entry\.connect_after\('style-changed', \(\) => this\._applyStyles\(\)\)/
    );
    assert.match(modernExtensionSource, /this\.textActor\.has_key_focus\(\)/);
    assert.match(modernExtensionSource, /this\.layer\.add_child\(note\.actor\);[\s\S]{0,200}note\._scheduleStyles\(\)/);
    assert.doesNotMatch(modernExtensionSource, /connect\('text-changed'/);
    assert.doesNotMatch(modernExtensionSource, /attr_scale_new/);
    assert.match(modernExtensionSource, /attr_size_new_absolute/);
    assert.match(modernExtensionSource, /this\._applyStyles\(\)/);
});

test('stable IDs map to compatible Markdown filenames', () => {
    assert.equal(noteFilename('primary'), 'note.md');
    assert.equal(noteFilename('a1b2c3d4e5f6'), 'note-a1b2c3d4e5f6.md');
    assert.throws(() => noteFilename('../../unsafe'));
});

test('the existing note.md remains the primary note during migration', () => {
    const loaded = loadRegistryData(
        {x: 10, y: 20, width: 400, height: 250},
        ['note.md'],
        true
    );
    assert.deepEqual(loaded.order, ['primary']);
    assert.deepEqual(loaded.records.primary, {
        file: 'note.md',
        x: 10,
        y: 20,
        width: 400,
        height: 250,
    });
    assert.equal(loaded.createPrimary, false);
});

test('an intentionally empty v2 registry stays empty', () => {
    const loaded = loadRegistryData(
        {version: 2, notes: {}, order: []},
        [],
        true
    );
    assert.deepEqual(loaded.order, []);
    assert.equal(loaded.createPrimary, false);
});

test('a fresh installation creates the compatible primary note', () => {
    const loaded = loadRegistryData(null, [], true);
    assert.deepEqual(loaded.order, ['primary']);
    assert.deepEqual(loaded.records.primary, {
        file: 'note.md',
        ...DEFAULT_GEOMETRY,
    });
    assert.equal(loaded.createPrimary, true);
});

test('orphaned stable Markdown files are safely enrolled', () => {
    const loaded = loadRegistryData(
        {version: 2, notes: {}, order: []},
        ['note-fedcba987654.md'],
        true
    );
    assert.deepEqual(loaded.order, ['fedcba987654']);
    assert.equal(loaded.records.fedcba987654.file, 'note-fedcba987654.md');
});

test('registry serialization keeps content paths separate from geometry', () => {
    const text = serializeRegistry({
        primary: {file: 'note.md', x: 1, y: 2, width: 320, height: 240},
    }, ['primary']);
    assert.deepEqual(JSON.parse(text), {
        version: 2,
        notes: {
            primary: {file: 'note.md', x: 1, y: 2, width: 320, height: 240},
        },
        order: ['primary'],
    });
});

test('all resize directions keep the opposite edge fixed', () => {
    const start = {x: 200, y: 150, width: 320, height: 240};
    const area = {x: 0, y: 0, width: 1200, height: 800};
    const west = computeResizeGeometry('w', start, 30, 0, area);
    assert.equal(west.x + west.width, start.x + start.width);
    const north = computeResizeGeometry('n', start, 0, 25, area);
    assert.equal(north.y + north.height, start.y + start.height);
    const southeast = computeResizeGeometry('se', start, 50, 60, area);
    assert.equal(southeast.x, start.x);
    assert.equal(southeast.y, start.y);
    const northwest = computeResizeGeometry('nw', start, -30, -20, area);
    assert.equal(northwest.x + northwest.width, start.x + start.width);
    assert.equal(northwest.y + northwest.height, start.y + start.height);
});

test('resize enforces the minimum note size', () => {
    const start = {x: 200, y: 150, width: 320, height: 240};
    const area = {x: 0, y: 0, width: 1200, height: 800};
    const tiny = computeResizeGeometry('nw', start, 999, 999, area);
    assert.equal(tiny.width, MIN_WIDTH);
    assert.equal(tiny.height, MIN_HEIGHT);
    assert.equal(tiny.x + tiny.width, start.x + start.width);
    assert.equal(tiny.y + tiny.height, start.y + start.height);
});

test('live Markdown parser limits itself to headings, bold, and checkboxes', () => {
    const text = '# Heading\nA **bold** word\n- [ ] open\n- [x] done\n* list\n';
    const kinds = parseLiveMarkdown(text).map(span => span.kind);
    assert.deepEqual(kinds, [
        'heading-1',
        'bold',
        'checkbox-unchecked',
        'checkbox-checked',
    ]);
});

test('checkbox hit detection uses character offsets for Unicode text', () => {
    const text = '🙂\n- [ ] 한국어';
    const spans = parseLiveMarkdown(text);
    const box = spans.find(span => span.kind === 'checkbox-unchecked');
    const characterOffset = utf16IndexToCharacterOffset(text, box.start);
    assert.equal(
        checkboxSpanAtCharacterOffset(text, spans, characterOffset),
        box
    );
    assert.equal(utf16IndexToUtf8Offset('🙂a', 2), 4);
});

test('a delayed self-write event cannot resurrect a Backspace edit', () => {
    assert.equal(
        classifyDiskText('abc', 'ab', 'abc', true),
        'self-before-local-edit'
    );
    assert.equal(classifyDiskText('outside', 'ab', 'abc', true), 'external');
    assert.equal(
        classifyDiskText('abc', 'ab', 'abc', true, 'external', 'self'),
        'external'
    );

    const sameBranch = modernExtensionSource.match(
        /if \(classification === 'self' \|\| classification === 'same'\) \{([\s\S]*?)\n\s*\}\n\n\s*this\._saveSource/
    )[1];
    assert.doesNotMatch(sameBranch, /this\._lastSelfText = null/);
    assert.match(modernExtensionSource, /this\._lastSelfSignature/);
});

test('note references remain agent-neutral and exact', () => {
    assert.equal(
        noteReferenceText(
            'abcdef123456',
            '/home/user/StickyNotes/note-abcdef123456.md',
            'Project plan\nbody'
        ),
        'Read StickyMD note "Project plan" (#ABCDEF).\n' +
        'File: /home/user/StickyNotes/note-abcdef123456.md\n'
    );
});
