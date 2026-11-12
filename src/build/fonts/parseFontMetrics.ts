/* Reads the few tables the fallback-metric math needs (head, hhea, OS/2,
 * cmap, hmtx) straight out of a TrueType/OpenType, WOFF or WOFF2 file.
 * WOFF2 keeps every table in one Brotli stream and only ever transforms
 * glyf, loca and hmtx, so the tables read here come back verbatim (hmtx
 * keeps its advance widths up front in the transformed form too). */
import { brotliDecompressSync, inflateSync } from 'node:zlib';
import type { FontMetrics } from '../../../types/fonts';

type Tables = Map<string, DataView>;
type ParsedFont = { hmtxTransformed: boolean; tables: Tables };
type Cursor = { offset: number };
type Format4Layout = { idDeltas: number; idRangeOffsets: number };

const SFNT_TABLE_RECORD_SIZE = 16;
const WOFF_HEADER_SIZE = 44;
const WOFF_TABLE_RECORD_SIZE = 20;
const WOFF2_HEADER_SIZE = 48;
const WOFF2_ARBITRARY_TAG_INDEX = 63;
const WOFF2_TAG_INDEX_MASK = 0x3f;
const WOFF2_TRANSFORM_SHIFT = 6;
const WOFF2_NULL_GLYF_TRANSFORM = 3;
const BASE128_MAX_BYTES = 5;
const BASE128_CONTINUE = 0x80;
const BASE128_VALUE_MASK = 0x7f;
const BASE128_SHIFT = 7;

/* The WOFF2 known-tag table (spec section 4.1), by index. */
const WOFF2_KNOWN_TAGS = [
	'cmap',
	'head',
	'hhea',
	'hmtx',
	'maxp',
	'name',
	'OS/2',
	'post',
	'cvt ',
	'fpgm',
	'glyf',
	'loca',
	'prep',
	'CFF ',
	'VORG',
	'EBDT',
	'EBLC',
	'gasp',
	'hdmx',
	'kern',
	'LTSH',
	'PCLT',
	'VDMX',
	'vhea',
	'vmtx',
	'BASE',
	'GDEF',
	'GPOS',
	'GSUB',
	'EBSC',
	'JSTF',
	'MATH',
	'CBDT',
	'CBLC',
	'COLR',
	'CPAL',
	'SVG ',
	'sbix',
	'acnt',
	'avar',
	'bdat',
	'bloc',
	'bsln',
	'cvar',
	'fdsc',
	'feat',
	'fmtx',
	'fvar',
	'gvar',
	'hsty',
	'just',
	'lcar',
	'mort',
	'morx',
	'opbd',
	'prop',
	'trak',
	'Zapf',
	'Silf',
	'Glat',
	'Gloc',
	'Feat',
	'Sill'
];

/* Relative frequency of characters in English text; space is about one
 * character in six. Both the web font and the fallback font are measured
 * with these weights, so only their ratio matters. */
const LATIN_CHARACTER_WEIGHTS: Record<string, number> = {
	' ': 18,
	a: 8.2,
	b: 1.5,
	c: 2.8,
	d: 4.3,
	e: 12.7,
	f: 2.2,
	g: 2,
	h: 6.1,
	i: 7,
	j: 0.15,
	k: 0.77,
	l: 4,
	m: 2.4,
	n: 6.7,
	o: 7.5,
	p: 1.9,
	q: 0.095,
	r: 6,
	s: 6.3,
	t: 9.1,
	u: 2.8,
	v: 0.98,
	w: 2.4,
	x: 0.15,
	y: 2,
	z: 0.074
};

const readTag = (view: DataView, offset: number) =>
	String.fromCharCode(
		view.getUint8(offset),
		view.getUint8(offset + 1),
		view.getUint8(offset + 2),
		view.getUint8(offset + 3)
	);

const viewOf = (bytes: Uint8Array) =>
	new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const readSfntTables = (view: DataView) => {
	const tables: Tables = new Map();
	const count = view.getUint16(4);
	for (let index = 0; index < count; index += 1) {
		const record = 12 + index * SFNT_TABLE_RECORD_SIZE;
		const offset = view.getUint32(record + 8);
		const length = view.getUint32(record + 12);
		tables.set(
			readTag(view, record),
			new DataView(view.buffer, view.byteOffset + offset, length)
		);
	}

	return tables;
};

const readWoffTable = (view: DataView, record: number) => {
	const offset = view.getUint32(record + 4);
	const compressedLength = view.getUint32(record + 8);
	const length = view.getUint32(record + 12);
	const stored = new Uint8Array(
		view.buffer,
		view.byteOffset + offset,
		compressedLength
	);
	if (compressedLength >= length) return viewOf(stored);

	return viewOf(inflateSync(stored));
};

const readWoffTables = (view: DataView) => {
	const tables: Tables = new Map();
	const count = view.getUint16(12);
	for (let index = 0; index < count; index += 1) {
		const record = WOFF_HEADER_SIZE + index * WOFF_TABLE_RECORD_SIZE;
		tables.set(readTag(view, record), readWoffTable(view, record));
	}

	return tables;
};

const readBase128 = (view: DataView, cursor: Cursor) => {
	let value = 0;
	for (let index = 0; index < BASE128_MAX_BYTES; index += 1) {
		const byte = view.getUint8(cursor.offset);
		cursor.offset += 1;
		value = value * (1 << BASE128_SHIFT) + (byte & BASE128_VALUE_MASK);
		if ((byte & BASE128_CONTINUE) === 0) return value;
	}
	throw new Error('Invalid WOFF2 table directory');
};

const isWoff2Transformed = (tag: string, version: number) =>
	tag === 'glyf' || tag === 'loca'
		? version !== WOFF2_NULL_GLYF_TRANSFORM
		: version !== 0;

const readWoff2Entry = (view: DataView, cursor: Cursor) => {
	const flags = view.getUint8(cursor.offset);
	cursor.offset += 1;
	const tagIndex = flags & WOFF2_TAG_INDEX_MASK;
	const tag =
		tagIndex === WOFF2_ARBITRARY_TAG_INDEX
			? readTag(view, cursor.offset)
			: (WOFF2_KNOWN_TAGS[tagIndex] ?? '');
	if (tagIndex === WOFF2_ARBITRARY_TAG_INDEX) cursor.offset += 4;
	const originalLength = readBase128(view, cursor);
	const transformed = isWoff2Transformed(tag, flags >> WOFF2_TRANSFORM_SHIFT);
	const length = transformed ? readBase128(view, cursor) : originalLength;

	return { length, tag, transformed };
};

const readWoff2Tables = (view: DataView) => {
	if (readTag(view, 4) === 'ttcf') {
		throw new Error('WOFF2 font collections are not supported');
	}
	const count = view.getUint16(12);
	const compressedLength = view.getUint32(20);
	const cursor: Cursor = { offset: WOFF2_HEADER_SIZE };
	const entries = Array.from({ length: count }, () =>
		readWoff2Entry(view, cursor)
	);
	const stream = viewOf(
		brotliDecompressSync(
			new Uint8Array(
				view.buffer,
				view.byteOffset + cursor.offset,
				compressedLength
			)
		)
	);
	const tables: Tables = new Map();
	let offset = 0;
	for (const entry of entries) {
		tables.set(
			entry.tag,
			new DataView(
				stream.buffer,
				stream.byteOffset + offset,
				entry.length
			)
		);
		offset += entry.length;
	}
	const parsed: ParsedFont = {
		hmtxTransformed: entries.some(
			(entry) => entry.tag === 'hmtx' && entry.transformed
		),
		tables
	};

	return parsed;
};

const readTables = (view: DataView) => {
	const signature = readTag(view, 0);
	if (signature === 'wOF2') return readWoff2Tables(view);
	if (signature === 'ttcf') {
		throw new Error('Font collections are not supported');
	}
	const parsed: ParsedFont = {
		hmtxTransformed: false,
		tables:
			signature === 'wOFF' ? readWoffTables(view) : readSfntTables(view)
	};

	return parsed;
};

const findFormat4Subtable = (cmap: DataView) => {
	const count = cmap.getUint16(2);
	for (let index = 0; index < count; index += 1) {
		const record = 4 + index * 8;
		const platform = cmap.getUint16(record);
		const offset = cmap.getUint32(record + 4);
		const isUnicode = platform === 0 || platform === 3;
		if (isUnicode && cmap.getUint16(offset) === 4) return offset;
	}

	return undefined;
};

const glyphFromRange = (
	cmap: DataView,
	layout: Format4Layout,
	segment: number,
	code: number,
	start: number
) => {
	const rangeOffsetPosition = layout.idRangeOffsets + segment * 2;
	const rangeOffset = cmap.getUint16(rangeOffsetPosition);
	const delta = cmap.getInt16(layout.idDeltas + segment * 2);
	if (rangeOffset === 0) return (code + delta) & 0xffff;
	const glyph = cmap.getUint16(
		rangeOffsetPosition + rangeOffset + (code - start) * 2
	);

	return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
};

const lookupGlyph = (cmap: DataView, subtable: number, code: number) => {
	const segments = cmap.getUint16(subtable + 6) / 2;
	const endCodes = subtable + 14;
	const startCodes = endCodes + segments * 2 + 2;
	const layout: Format4Layout = {
		idDeltas: startCodes + segments * 2,
		idRangeOffsets: startCodes + segments * 4
	};
	for (let segment = 0; segment < segments; segment += 1) {
		const end = cmap.getUint16(endCodes + segment * 2);
		const start = cmap.getUint16(startCodes + segment * 2);
		if (code > end || code < start) continue;

		return glyphFromRange(cmap, layout, segment, code, start);
	}

	return 0;
};

const advanceWidth = (
	{ hmtxTransformed, tables }: ParsedFont,
	glyph: number
) => {
	const hhea = tables.get('hhea');
	const hmtx = tables.get('hmtx');
	if (!hhea || !hmtx) return undefined;
	const index = Math.min(glyph, hhea.getUint16(34) - 1);
	// A transformed hmtx is one flags byte, then the advances alone.
	const offset = hmtxTransformed ? 1 + index * 2 : index * 4;
	if (offset + 2 > hmtx.byteLength) return undefined;

	return hmtx.getUint16(offset);
};

const weightedAverageWidth = (font: ParsedFont) => {
	const cmap = font.tables.get('cmap');
	const subtable = cmap && findFormat4Subtable(cmap);
	if (!cmap || subtable === undefined) return undefined;
	let total = 0;
	let weights = 0;
	for (const [character, weight] of Object.entries(LATIN_CHARACTER_WEIGHTS)) {
		const glyph = lookupGlyph(cmap, subtable, character.charCodeAt(0));
		const width = glyph === 0 ? undefined : advanceWidth(font, glyph);
		if (width === undefined) continue;
		total += width * weight;
		weights += weight;
	}

	return weights === 0 ? undefined : total / weights;
};

/** Reads ascent, descent, line gap, units per em and the frequency-weighted
 *  average character width from a TTF/OTF/WOFF/WOFF2 file. */
export const parseFontMetrics = (bytes: Uint8Array) => {
	const font = readTables(viewOf(bytes));
	const { tables } = font;
	const head = tables.get('head');
	const hhea = tables.get('hhea');
	if (!head || !hhea) {
		throw new Error('Font is missing its head or hhea table');
	}
	const os2 = tables.get('OS/2');
	const averageWidth = weightedAverageWidth(font) ?? os2?.getInt16(2) ?? 0;
	const metrics: FontMetrics = {
		ascent: hhea.getInt16(4),
		averageWidth,
		descent: hhea.getInt16(6),
		lineGap: hhea.getInt16(8),
		unitsPerEm: head.getUint16(18)
	};

	return metrics;
};
