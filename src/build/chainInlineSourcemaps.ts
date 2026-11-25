/* Bandaid for oven-sh/bun: `Bun.build` does not chain through input
 * files' inline sourcemap comments. See `docs/BUN_SOURCEMAP_CHAIN_BUG.md`
 * for repro, upstream tracking, and removal criteria.
 *
 * What this module does: takes a built file whose inline sourcemap
 * points at INTERMEDIATE source files (each of which may itself
 * carry its own inline sourcemap), composes the chain, and rewrites
 * the built file's inline sourcemap to point at the deepest source
 * directly. After Bun fixes input-sourcemap chaining upstream, the
 * entire file can be deleted and the post-build call removed. */

import { readFileSync, writeFileSync } from 'node:fs';
import { inlineSourceMapComment } from './inlineSourceMapComment';

const BASE64_CHARS =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_TO_INT = new Int8Array(128).fill(-1);
for (let index = 0; index < BASE64_CHARS.length; index++) {
	BASE64_TO_INT[BASE64_CHARS.charCodeAt(index)] = index;
}

const decodeVlq = (str: string, startPos: number) => {
	let result = 0;
	let shift = 0;
	let pos = startPos;
	while (true) {
		const digit = BASE64_TO_INT[str.charCodeAt(pos++)];
		if (digit === undefined || digit < 0) {
			throw new Error(
				`chainInlineSourcemaps: invalid base64 char at ${pos - 1}`
			);
		}
		result |= (digit & 31) << shift;
		shift += 5;
		if (!(digit & 32)) break;
	}
	const negative = result & 1;
	const value = result >>> 1;

	return { pos, value: negative ? -value : value };
};

const encodeVlq = (value: number) => {
	let v = value < 0 ? (-value << 1) | 1 : value << 1;
	let result = '';
	do {
		let digit = v & 31;
		v >>>= 5;
		if (v) digit |= 32;
		result += BASE64_CHARS[digit];
	} while (v);

	return result;
};

type Segment = {
	genCol: number;
	sourceIdx?: number;
	sourceLine?: number;
	sourceCol?: number;
};

/* Where a decode has got to: the position in the string, and the
 * running totals the format's deltas are added to. `genCol` restarts on
 * every line; the three source fields run through the whole map. */
type DecodeState = {
	genCol: number;
	pos: number;
	sourceCol: number;
	sourceIdx: number;
	sourceLine: number;
};

/* Compared as char codes: this runs once or more per segment of maps
 * that reach tens of megabytes, and indexing the string to compare
 * one-character strings measured about a tenth slower. */
const COMMA = 44;
const SEMICOLON = 59;

const isSegmentEnd = (mappings: string, pos: number) => {
	if (pos >= mappings.length) return true;
	const code = mappings.charCodeAt(pos);

	return code === COMMA || code === SEMICOLON;
};

/* One segment, starting at `state.pos` and leaving it just past the
 * segment: the generated column, then — when present — source index,
 * line and column. */
const decodeSegment = (mappings: string, state: DecodeState) => {
	const generated = decodeVlq(mappings, state.pos);
	state.pos = generated.pos;
	state.genCol += generated.value;
	if (isSegmentEnd(mappings, state.pos)) {
		const unmapped: Segment = { genCol: state.genCol };

		return unmapped;
	}

	const source = decodeVlq(mappings, state.pos);
	const line = decodeVlq(mappings, source.pos);
	const column = decodeVlq(mappings, line.pos);
	state.pos = column.pos;
	state.sourceIdx += source.value;
	state.sourceLine += line.value;
	state.sourceCol += column.value;
	// Skip optional name VLQ — we don't chain names.
	while (!isSegmentEnd(mappings, state.pos))
		state.pos = decodeVlq(mappings, state.pos).pos;
	// Built whole, not filled in field by field: one object shape for
	// every mapped segment.
	const segment: Segment = {
		genCol: state.genCol,
		sourceCol: state.sourceCol,
		sourceIdx: state.sourceIdx,
		sourceLine: state.sourceLine
	};

	return segment;
};

const startNextLine = (lines: Segment[][], state: DecodeState) => {
	const line: Segment[] = [];
	lines.push(line);
	state.genCol = 0;
	state.pos += 1;

	return line;
};

const decodeMappings = (mappings: string) => {
	let current: Segment[] = [];
	const lines: Segment[][] = [current];
	const state: DecodeState = {
		genCol: 0,
		pos: 0,
		sourceCol: 0,
		sourceIdx: 0,
		sourceLine: 0
	};
	while (state.pos < mappings.length) {
		const code = mappings.charCodeAt(state.pos);
		if (code === SEMICOLON) current = startNextLine(lines, state);
		else if (code === COMMA) state.pos += 1;
		else current.push(decodeSegment(mappings, state));
	}

	return lines;
};

/* The running totals an encode subtracts from. */
type EncodeState = { sourceCol: number; sourceIdx: number; sourceLine: number };

/* A segment's source half: empty when it maps to nothing. Line and
 * column are always present when the index is. */
const encodeSource = (segment: Segment, last: EncodeState) => {
	if (segment.sourceIdx === undefined) return '';
	const sourceLine = segment.sourceLine ?? 0;
	const sourceCol = segment.sourceCol ?? 0;
	const encoded =
		encodeVlq(segment.sourceIdx - last.sourceIdx) +
		encodeVlq(sourceLine - last.sourceLine) +
		encodeVlq(sourceCol - last.sourceCol);
	last.sourceIdx = segment.sourceIdx;
	last.sourceLine = sourceLine;
	last.sourceCol = sourceCol;

	return encoded;
};

const encodeLine = (line: Segment[], last: EncodeState) => {
	let lastGenCol = 0;
	const parts: string[] = [];
	for (const segment of line) {
		parts.push(
			encodeVlq(segment.genCol - lastGenCol) + encodeSource(segment, last)
		);
		lastGenCol = segment.genCol;
	}

	return parts.join(',');
};

const encodeMappings = (lines: Segment[][]) => {
	const last: EncodeState = { sourceCol: 0, sourceIdx: 0, sourceLine: 0 };

	return lines.map((line) => encodeLine(line, last)).join(';');
};

const isMapped = (segment: Segment) => segment.sourceIdx !== undefined;

const positionOf = (segment: Segment) => ({
	col: segment.sourceCol ?? 0,
	line: segment.sourceLine ?? 0,
	sourceIdx: segment.sourceIdx ?? 0
});

const traceInner = (
	innerLines: Segment[][],
	targetLine: number,
	targetCol: number
) => {
	if (targetLine < 0 || targetLine >= innerLines.length) return null;
	// Step 1: try the target line. Take the largest segment with
	// genCol <= targetCol; if none qualifies (targetCol is before the
	// first segment on this line, but the line has mappings), fall
	// through to the first segment on the line as a column-imprecise
	// hit. Stack-trace remapping cares about line >> column, so a
	// same-line fallback is preferable to walking back to an earlier
	// line.
	const targetLineSegs = innerLines[targetLine];
	if (!targetLineSegs) return null;
	const onLine =
		targetLineSegs.findLast(
			(segment) => segment.genCol <= targetCol && isMapped(segment)
		) ?? targetLineSegs.find(isMapped);
	if (onLine) return positionOf(onLine);
	// Step 2: target line has no segments at all. Walk back to the
	// nearest prior line with a mapping. Standard sourcemap-resolver
	// behaviour (V8/JSC honour this).
	for (let lineIndex = targetLine - 1; lineIndex >= 0; lineIndex--) {
		const earlier = innerLines[lineIndex]?.findLast(isMapped);
		if (earlier) return positionOf(earlier);
	}

	return null;
};

type SourceMap = {
	version: 3;
	sources: (string | null)[];
	sourcesContent?: (string | null)[];
	names: string[];
	mappings: string;
};

const SOURCEMAP_INLINE_RE =
	/\n?\/\/# sourceMappingURL=data:application\/json(?:;[^,]+)?;base64,([A-Za-z0-9+/=]+)\s*$/;

/* Enough of the shape to chain through: an array of sources and a
 * mappings string. Anything else is not a map this module can use, and
 * is treated as there being no map. */
const isSourceMap = (value: unknown): value is SourceMap =>
	typeof value === 'object' &&
	value !== null &&
	'sources' in value &&
	Array.isArray(value.sources) &&
	'mappings' in value &&
	typeof value.mappings === 'string';

const parseSourceMap = (json: string) => {
	try {
		const parsed: unknown = JSON.parse(json);

		return isSourceMap(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

const extractInlineMap = (text: string) => {
	const [, encoded] = text.match(SOURCEMAP_INLINE_RE) ?? [];
	if (!encoded) return null;

	return parseSourceMap(Buffer.from(encoded, 'base64').toString('utf-8'));
};

/* Build a line-shift remap from `before` text (compileScript output)
 * to `after` text (the final intermediate JS as written to disk).
 *
 * The intermediate goes through several non-line-preserving passes —
 * Bun.Transpiler (drops blank lines + whole-line type
 * declarations), mergeVueImports (removes every
 * `import ... from "vue"` line and prepends one consolidated). For
 * the sourcemap chain to map back to the .vue file from the final
 * intermediate's actual line numbers, we need to know where each
 * compileScript-output line ended up in the final intermediate.
 *
 * Strategy: content match. For each `before` line, search forward
 * for a matching line in `after` (normalised: trimmed, quote-type
 * and trailing-semicolon insensitive). Vue import lines all collapse
 * onto the consolidated import at the top, so they all remap to the
 * first matching `import * from "vue"` line in `after`. Lines that
 * have no match (blank lines transpiler dropped, type-only lines
 * transpiler stripped) get -1 and their mappings are discarded. */
const normaliseLine = (line: string) =>
	line.trim().replace(/["']/g, '`').replace(/;\s*$/, '');

const isVueImport = (line: string) =>
	/^\s*import\s+.*\bfrom\s+["']vue["']\s*;?\s*$/.test(line);

/* The index of `wanted` in `lines[from, to)`, or -1. */
const indexWithin = (
	lines: string[],
	wanted: string,
	from: number,
	end: number
) => {
	for (let probe = from; probe < end; probe++)
		if (lines[probe] === wanted) return probe;

	return -1;
};

/* How far ahead of the last match a line is looked for. */
const LINE_SEARCH_HORIZON = 30;

export const buildLineRemap = (before: string, after: string) => {
	const beforeLines = before.split('\n');
	const afterLines = after.split('\n');
	const mergedVueImportLine = afterLines.findIndex(isVueImport);
	// Normalise `after` once: every `before` line probes up to 30
	// candidates, and re-normalising each candidate per probe was the
	// single largest self-time item in a Vue compile profile.
	const afterNormalised = afterLines.map(normaliseLine);
	const remap: number[] = new Array(beforeLines.length).fill(-1);
	let cursor = 0;
	for (const [index, line] of beforeLines.entries()) {
		if (line.trim() === '') continue;
		const isImport = isVueImport(line);
		if (isImport) remap[index] = mergedVueImportLine;
		if (isImport) continue;
		const found = indexWithin(
			afterNormalised,
			normaliseLine(line),
			cursor,
			Math.min(afterLines.length, cursor + LINE_SEARCH_HORIZON)
		);
		if (found < 0) continue;
		remap[index] = found;
		cursor = found + 1;
	}

	return remap;
};
export const chainSourcemap = (
	outer: SourceMap,
	fetchInner: (sourcePath: string) => SourceMap | null
) => {
	const outerSegs = decodeMappings(outer.mappings);
	const innerMaps = outer.sources.map((source) =>
		source ? fetchInner(source) : null
	);
	const innerDecoded = innerMaps.map((inner) =>
		inner ? decodeMappings(inner.mappings) : null
	);

	const newSources: string[] = [];
	const newSourcesContent: (string | null)[] = [];
	const addSource = (src: string, content: string | null) => {
		const existing = newSources.indexOf(src);
		if (existing >= 0) return existing;
		newSources.push(src);
		newSourcesContent.push(content);

		return newSources.length - 1;
	};

	// For each outer source: also register a fallback entry (the
	// outer source itself) so segments whose inner-map trace fails
	// still get attributed somewhere. Trace-fail commonly happens
	// on generated wrapper lines (the bits compileVue concatenates
	// AFTER the script body — render fn, scopeId, exports — which
	// the inner sourcemap has no mappings for).
	const innerSrcRemap: number[][] = [];
	const outerFallbackIdx: number[] = [];
	outer.sources.forEach((src, index) => {
		const inner = innerMaps[index];
		innerSrcRemap[index] = inner
			? inner.sources.map((innerSrc, innerIndex) =>
					innerSrc === null
						? -1
						: addSource(
								innerSrc,
								inner.sourcesContent?.[innerIndex] ?? null
							)
				)
			: [];
		outerFallbackIdx[index] =
			src === null
				? -1
				: addSource(src, outer.sourcesContent?.[index] ?? null);
	});

	const chainSegment = (segment: Segment) => {
		const { genCol, sourceIdx } = segment;
		if (sourceIdx === undefined) return { genCol };
		const innerLines = innerDecoded[sourceIdx];
		const traced = innerLines
			? traceInner(
					innerLines,
					segment.sourceLine ?? 0,
					segment.sourceCol ?? 0
				)
			: null;
		// No inner map, or an inner trace miss — fall back to outer
		// attribution so Bun's runtime still has something to show.
		if (!traced)
			return {
				genCol,
				sourceCol: segment.sourceCol,
				sourceIdx: outerFallbackIdx[sourceIdx] ?? -1,
				sourceLine: segment.sourceLine
			};

		return {
			genCol,
			sourceCol: traced.col,
			sourceIdx: innerSrcRemap[sourceIdx]?.[traced.sourceIdx] ?? -1,
			sourceLine: traced.line
		};
	};
	const chained: Segment[][] = outerSegs.map((line) =>
		line.map(chainSegment)
	);
	const chainedMap: SourceMap = {
		mappings: encodeMappings(chained),
		names: outer.names,
		sources: newSources,
		sourcesContent: newSourcesContent,
		version: 3
	};

	return chainedMap;
};
export const inlineLineMapComment = (
	sourcePath: string,
	sourceContent: string,
	generatedContent: string
) => {
	const remap = buildLineRemap(sourceContent, generatedContent);
	const generatedLineCount = generatedContent.split('\n').length;
	const segs: Segment[][] = Array.from(
		{ length: generatedLineCount },
		() => []
	);
	for (let srcLine = 0; srcLine < remap.length; srcLine++) {
		const genLine = remap[srcLine];
		if (
			genLine === undefined ||
			genLine < 0 ||
			genLine >= generatedLineCount
		)
			continue;
		const segLine = segs[genLine];
		if (!segLine) continue;
		segLine.push({
			genCol: 0,
			sourceCol: 0,
			sourceIdx: 0,
			sourceLine: srcLine
		});
	}
	const map: SourceMap = {
		mappings: encodeMappings(segs),
		names: [],
		sources: [sourcePath],
		sourcesContent: [sourceContent],
		version: 3
	};

	return `${inlineSourceMapComment(map)}\n`;
};
export const remapGeneratedLines = (mappings: string, lineRemap: number[]) => {
	const decoded = decodeMappings(mappings);
	const remapped: Segment[][] = [];
	for (let origLine = 0; origLine < decoded.length; origLine++) {
		const newLine = lineRemap[origLine];
		if (newLine === undefined || newLine < 0) continue;
		const origSegs = decoded[origLine];
		if (!origSegs) continue;
		while (remapped.length < newLine) remapped.push([]);
		remapped[newLine] = origSegs;
	}

	return encodeMappings(remapped);
};

type ChainInlineOptions = {
	/** Keep the source text in the rewritten map's `sourcesContent`. Off
	 *  by default: the chained sources are real files on disk (`.vue`,
	 *  `.ts`, and the generated intermediates), Bun's runtime only needs
	 *  `sources` + `mappings` to name a stack frame, and the embedded text
	 *  was ~90% of every dev server bundle (a 25 MB page shrinks to ~3 MB).
	 *  The key itself stays, filled with `null`s — Bun rejects a map
	 *  without it (`InvalidSourceMap`) and then maps nothing at all. */
	sourcesContent?: boolean;
};

/* Rewrite the inline sourcemap of `bundleFilePath` so it points at
 * the deepest source available — chaining through each input file's
 * own inline map.
 *
 * Bun.build embeds the full text of each input source in the output
 * map's `sourcesContent[]`. When an input is itself the output of an
 * earlier compile step (e.g. compileVue → intermediate .js with an
 * inline `.vue` source map), that text already contains the inline
 * `//# sourceMappingURL=...` comment. We extract those inner maps
 * straight from `sourcesContent` — no path resolution, no second
 * filesystem read — and chain through them.
 *
 * Returns `false` (no-op) if the bundle has no inline map. */
export const chainBundleInlineSourcemap = (
	bundleFilePath: string,
	{ sourcesContent = false }: ChainInlineOptions = {}
) => {
	const text = readFileSync(bundleFilePath, 'utf-8');
	const outerMap = extractInlineMap(text);
	if (!outerMap) return false;
	const chained = chainSourcemap(outerMap, (src) => {
		const idx = outerMap.sources.indexOf(src);
		if (idx < 0) return null;
		const content = outerMap.sourcesContent?.[idx];
		if (!content) return null;

		return extractInlineMap(content);
	});
	if (!sourcesContent) {
		chained.sourcesContent = chained.sources.map(() => null);
	}
	const stripped = text.replace(SOURCEMAP_INLINE_RE, '');
	writeFileSync(bundleFilePath, stripped + inlineSourceMapComment(chained));

	return true;
};

/** Chain every server bundle of a dev build (each bundle is independent).
 *  Fans out across the build worker pool when the batch is large enough
 *  to amortise a spawn (or the pool is already warm); otherwise runs
 *  inline on the main thread. */
export const chainBundleInlineSourcemaps = async (
	bundlePaths: string[],
	{ sourcesContent = false }: ChainInlineOptions = {}
) => {
	const { getBuildWorkerPool } = await import('./workerPool');
	const pool = getBuildWorkerPool();
	const inline = !pool.shouldUse(bundlePaths.length);
	await Promise.all(
		bundlePaths.map((bundleFilePath) =>
			pool.run(
				'sourcemap-chain',
				{ bundleFilePath, sourcesContent },
				{ inline }
			)
		)
	);
};

/* Chain an EXTERNAL `.js.map` (production builds) the same way
 * `chainBundleInlineSourcemap` chains inline maps: compose the bundle map
 * with each input's own inline map (carried in the bundle map's
 * `sourcesContent[]`) so the external map resolves to original `.vue`/`.ts`
 * source rather than the intermediate compile output. Rewrites the `.map`
 * file in place. No-op if the file isn't a valid source map. */
const readSourceMapFile = (mapFilePath: string) => {
	try {
		return parseSourceMap(readFileSync(mapFilePath, 'utf-8'));
	} catch {
		return null;
	}
};

export const chainExternalSourcemap = (mapFilePath: string) => {
	const outerMap = readSourceMapFile(mapFilePath);
	if (!outerMap) return;
	const chained = chainSourcemap(outerMap, (src) => {
		const idx = outerMap.sources.indexOf(src);
		if (idx < 0) return null;
		const content = outerMap.sourcesContent?.[idx];
		if (!content) return null;

		return extractInlineMap(content);
	});
	writeFileSync(mapFilePath, JSON.stringify(chained));
};
