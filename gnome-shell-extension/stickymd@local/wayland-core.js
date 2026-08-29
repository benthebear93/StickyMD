// Pure StickyMD data and geometry helpers shared by the GNOME Wayland UI.

export const STATE_VERSION = 2;
export const DEFAULT_GEOMETRY = Object.freeze({
    x: 48,
    y: 48,
    width: 320,
    height: 320,
});
export const MIN_WIDTH = 160;
export const MIN_HEIGHT = 120;
export const NEW_NOTE_OFFSET = 28;
export const TOP_BAR_HEIGHT = 24;
export const VISIBLE_MARGIN = 40;
export const RESIZE_DIRECTIONS = Object.freeze([
    'n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se',
]);

const NOTE_ID_PATTERN = /^[0-9a-f]{12}$/;
const NOTE_FILE_PATTERN = /^note-([0-9a-f]{12})\.md$/;

export function clamp(value, lower, upper) {
    if (upper < lower)
        return upper;
    return Math.max(lower, Math.min(value, upper));
}

export function normalizeGeometry(raw, fallback = DEFAULT_GEOMETRY) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        return {...fallback};
    const values = {};
    for (const key of Object.keys(DEFAULT_GEOMETRY)) {
        const value = raw[key];
        if (!Number.isInteger(value))
            return {...fallback};
        values[key] = value;
    }
    if (values.width < MIN_WIDTH || values.width > 16384)
        return {...fallback};
    if (values.height < MIN_HEIGHT || values.height > 16384)
        return {...fallback};
    if (Math.abs(values.x) > 131072 || Math.abs(values.y) > 131072)
        return {...fallback};
    return values;
}

export function noteFilename(noteId) {
    if (noteId === 'primary')
        return 'note.md';
    if (!NOTE_ID_PATTERN.test(noteId))
        throw new Error(`Invalid note ID: ${noteId}`);
    return `note-${noteId}.md`;
}

export function noteIdFromFilename(filename) {
    if (filename === 'note.md')
        return 'primary';
    return NOTE_FILE_PATTERN.exec(filename)?.[1] ?? null;
}

export function shortNoteReference(noteId) {
    noteFilename(noteId);
    return noteId === 'primary' ? '#MAIN' : `#${noteId.slice(0, 6).toUpperCase()}`;
}

export function noteReferenceTitle(text, limit = 48) {
    for (const line of text.split(/\r?\n/)) {
        const title = line.trim().replace(/\s+/g, ' ');
        if (!title)
            continue;
        return title.length > limit
            ? `${title.slice(0, limit - 1).trimEnd()}…`
            : title;
    }
    return 'Untitled';
}

export function noteReferenceText(noteId, notePath, text) {
    const title = JSON.stringify(noteReferenceTitle(text));
    return `Read StickyMD note ${title} (${shortNoteReference(noteId)}).\n` +
        `File: ${notePath}\n`;
}

export function geometryForIndex(index) {
    return {
        ...DEFAULT_GEOMETRY,
        x: DEFAULT_GEOMETRY.x + NEW_NOTE_OFFSET * index,
        y: DEFAULT_GEOMETRY.y + NEW_NOTE_OFFSET * index,
    };
}

export function clampNewGeometry(geometry, workarea) {
    const width = Math.min(geometry.width, Math.max(MIN_WIDTH, workarea.width));
    const height = Math.min(
        geometry.height,
        Math.max(MIN_HEIGHT, workarea.height)
    );
    return {
        x: clamp(geometry.x, workarea.x, workarea.x + workarea.width - width),
        y: clamp(geometry.y, workarea.y, workarea.y + workarea.height - height),
        width,
        height,
    };
}

export function clampMovedGeometry(geometry, workarea) {
    return {
        ...geometry,
        x: clamp(
            geometry.x,
            workarea.x - geometry.width + VISIBLE_MARGIN,
            workarea.x + workarea.width - VISIBLE_MARGIN
        ),
        y: clamp(
            geometry.y,
            workarea.y,
            workarea.y + workarea.height - TOP_BAR_HEIGHT
        ),
    };
}

export function computeResizeGeometry(
    direction,
    startGeometry,
    deltaX,
    deltaY,
    workarea
) {
    if (!RESIZE_DIRECTIONS.includes(direction))
        throw new Error(`Invalid resize direction: ${direction}`);
    let left = startGeometry.x;
    let top = startGeometry.y;
    let right = left + startGeometry.width;
    let bottom = top + startGeometry.height;
    const workRight = workarea.x + workarea.width;
    const workBottom = workarea.y + workarea.height;

    if (direction.includes('w'))
        left = clamp(left + deltaX, workarea.x, right - MIN_WIDTH);
    else if (direction.includes('e'))
        right = clamp(right + deltaX, left + MIN_WIDTH, workRight);
    if (direction.includes('n'))
        top = clamp(top + deltaY, workarea.y, bottom - MIN_HEIGHT);
    else if (direction.includes('s'))
        bottom = clamp(bottom + deltaY, top + MIN_HEIGHT, workBottom);

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
}

export function parseLiveMarkdown(text) {
    const spans = [];
    let lineStart = 0;
    const lines = text.match(/.*(?:\n|$)/g) ?? [];
    for (const rawLine of lines) {
        if (!rawLine && lineStart === text.length)
            break;
        const line = rawLine.replace(/[\r\n]+$/, '');
        const lineEnd = lineStart + line.length;
        const heading = /^(#{1,3})[ \t]+(\S.*)$/.exec(line);
        if (heading) {
            const contentStart = lineStart + heading[0].indexOf(heading[2]);
            spans.push({
                kind: `heading-${heading[1].length}`,
                start: contentStart,
                end: lineEnd,
                syntax: [[lineStart, contentStart]],
                lineStart,
                lineEnd,
            });
        }

        const checkbox = /^([ \t]*)(-[ \t]+)\[([ xX])\](?=[ \t]|$)/.exec(line);
        if (checkbox) {
            const markerCharacter = lineStart + checkbox[0].lastIndexOf(checkbox[3]);
            const boxStart = markerCharacter - 1;
            const boxEnd = markerCharacter + 2;
            const prefixStart = lineStart + checkbox[1].length;
            spans.push({
                kind: checkbox[3].toLowerCase() === 'x'
                    ? 'checkbox-checked'
                    : 'checkbox-unchecked',
                start: boxStart,
                end: boxEnd,
                marker: markerCharacter,
                syntax: [[prefixStart, boxStart]],
                lineStart,
                lineEnd,
            });
        }

        const boldPattern = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
        for (const bold of line.matchAll(boldPattern)) {
            const matchStart = lineStart + bold.index;
            const contentStart = matchStart + 2;
            const contentEnd = matchStart + bold[0].length - 2;
            spans.push({
                kind: 'bold',
                start: contentStart,
                end: contentEnd,
                syntax: [
                    [matchStart, contentStart],
                    [contentEnd, matchStart + bold[0].length],
                ],
                lineStart,
                lineEnd,
            });
        }
        lineStart += rawLine.length;
    }
    return spans;
}

export function utf16IndexToCharacterOffset(text, index) {
    return Array.from(text.slice(0, index)).length;
}

export function characterOffsetToUtf16Index(text, offset) {
    let index = 0;
    let characters = 0;
    for (const character of text) {
        if (characters >= offset)
            break;
        index += character.length;
        characters += 1;
    }
    return index;
}

export function utf16IndexToUtf8Offset(text, index) {
    return new TextEncoder().encode(text.slice(0, index)).length;
}

export function checkboxSpanAtCharacterOffset(text, spans, offset) {
    return spans.find(span => {
        if (!span.kind.startsWith('checkbox-'))
            return false;
        const start = utf16IndexToCharacterOffset(text, span.start);
        const end = utf16IndexToCharacterOffset(text, span.end);
        return start <= offset && offset < end;
    }) ?? null;
}

export function classifyDiskText(
    diskText,
    bufferText,
    lastSelfText,
    dirty,
    diskSignature = null,
    lastSelfSignature = null
) {
    const signatureMatches = lastSelfSignature === null ||
        diskSignature === lastSelfSignature;
    const matchesSelf = lastSelfText !== null && diskText === lastSelfText &&
        signatureMatches;
    if (dirty && matchesSelf)
        return 'self-before-local-edit';
    if (diskText === bufferText)
        return 'same';
    if (!dirty && matchesSelf)
        return 'self';
    return 'external';
}

export function serializeRegistry(records, order) {
    const notes = {};
    for (const noteId of order) {
        const record = records[noteId];
        if (!record)
            continue;
        notes[noteId] = {
            file: record.file,
            x: record.x,
            y: record.y,
            width: record.width,
            height: record.height,
        };
    }
    return `${JSON.stringify({version: STATE_VERSION, notes, order: Object.keys(notes)}, null, 2)}\n`;
}

export function loadRegistryData(raw, filenames, createIfFresh = true) {
    const isV2 = raw !== null && typeof raw === 'object' &&
        !Array.isArray(raw) && raw.version === STATE_VERSION &&
        raw.notes !== null && typeof raw.notes === 'object' &&
        !Array.isArray(raw.notes);
    const records = {};
    const order = [];
    let changed = !isV2;

    if (isV2) {
        const rawOrder = Array.isArray(raw.order)
            ? raw.order.filter(item => typeof item === 'string')
            : [];
        for (const noteId of [...rawOrder, ...Object.keys(raw.notes)]) {
            if (records[noteId])
                continue;
            const data = raw.notes[noteId];
            if (data === null || typeof data !== 'object' || Array.isArray(data)) {
                changed = true;
                continue;
            }
            let expectedFile;
            try {
                expectedFile = noteFilename(noteId);
            } catch (_error) {
                changed = true;
                continue;
            }
            if (data.file !== expectedFile || !filenames.includes(expectedFile)) {
                changed = true;
                continue;
            }
            const geometry = normalizeGeometry(data);
            if (Object.keys(DEFAULT_GEOMETRY).some(key => geometry[key] !== data[key]))
                changed = true;
            records[noteId] = {file: expectedFile, ...geometry};
            order.push(noteId);
        }
    } else if (filenames.includes('note.md')) {
        const geometry = normalizeGeometry(raw);
        records.primary = {file: 'note.md', ...geometry};
        order.push('primary');
    }

    for (const filename of filenames.slice().sort()) {
        const noteId = noteIdFromFilename(filename);
        if (noteId === null || records[noteId])
            continue;
        records[noteId] = {file: filename, ...geometryForIndex(order.length)};
        order.push(noteId);
        changed = true;
    }

    let createPrimary = false;
    if (order.length === 0 && !isV2 && createIfFresh) {
        records.primary = {file: 'note.md', ...DEFAULT_GEOMETRY};
        order.push('primary');
        createPrimary = true;
        changed = true;
    }
    return {records, order, changed, createPrimary, isV2};
}
