/* Bandaid for oven-sh/bun: `Bun.build` does not chain through input
 * files' inline sourcemap comments. See `BUN_SOURCEMAP_CHAIN_BUG.md`
 * for repro, upstream tracking, and removal criteria.
 *
 * What this module does: takes a built file whose inline sourcemap
 * points at INTERMEDIATE source files (each of which may itself
 * carry its own inline sourcemap), composes the chain, and rewrites
 * the built file's inline sourcemap to point at the deepest source
 * directly. After Bun fixes input-sourcemap chaining upstream, the
 * entire file can be deleted and the post-build call removed. */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE64_CHARS =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_TO_INT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64_CHARS.length; i++) {
	BASE64_TO_INT[BASE64_CHARS.charCodeAt(i)] = i;
}

const decodeVlq = (str: string, startPos: number) => {
	let result = 0;
	let shift = 0;
	let pos = startPos;
	while (true) {
		const digit = BASE64_TO_INT[str.charCodeAt(pos++)];
		if (digit < 0) {
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
	let v = value < 0 ? ((-value) << 1) | 1 : value << 1;
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

const decodeMappings = (mappings: string): Segment[][] => {
	const lines: Segment[][] = [];
	let current: Segment[] = [];
	let lastGenCol = 0;
	let lastSourceIdx = 0;
	let lastSourceLine = 0;
	let lastSourceCol = 0;
	let pos = 0;
	const len = mappings.length;
	while (pos < len) {
		const ch = mappings[pos];
		if (ch === ';') {
			lines.push(current);
			current = [];
			lastGenCol = 0;
			pos++;
			continue;
		}
		if (ch === ',') {
			pos++;
			continue;
		}
		const d1 = decodeVlq(mappings, pos);
		pos = d1.pos;
		lastGenCol += d1.value;
		const segment: Segment = { genCol: lastGenCol };
		if (pos < len && mappings[pos] !== ',' && mappings[pos] !== ';') {
			const d2 = decodeVlq(mappings, pos);
			pos = d2.pos;
			const d3 = decodeVlq(mappings, pos);
			pos = d3.pos;
			const d4 = decodeVlq(mappings, pos);
			pos = d4.pos;
			lastSourceIdx += d2.value;
			lastSourceLine += d3.value;
			lastSourceCol += d4.value;
			segment.sourceIdx = lastSourceIdx;
			segment.sourceLine = lastSourceLine;
			segment.sourceCol = lastSourceCol;
			// Skip optional name VLQ — we don't chain names.
			while (
				pos < len &&
				mappings[pos] !== ',' &&
				mappings[pos] !== ';'
			) {
				pos = decodeVlq(mappings, pos).pos;
			}
		}
		current.push(segment);
	}
	lines.push(current);
	return lines;
};

const encodeMappings = (lines: Segment[][]) => {
	let lastSourceIdx = 0;
	let lastSourceLine = 0;
	let lastSourceCol = 0;
	const parts: string[] = [];
	for (const line of lines) {
		let lastGenCol = 0;
		const segs: string[] = [];
		for (const seg of line) {
			let s = encodeVlq(seg.genCol - lastGenCol);
			lastGenCol = seg.genCol;
			if (seg.sourceIdx !== undefined) {
				s += encodeVlq(seg.sourceIdx - lastSourceIdx);
				s += encodeVlq(seg.sourceLine! - lastSourceLine);
				s += encodeVlq(seg.sourceCol! - lastSourceCol);
				lastSourceIdx = seg.sourceIdx;
				lastSourceLine = seg.sourceLine!;
				lastSourceCol = seg.sourceCol!;
			}
			segs.push(s);
		}
		parts.push(segs.join(','));
	}
	return parts.join(';');
};

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
	for (let i = targetLineSegs.length - 1; i >= 0; i--) {
		const seg = targetLineSegs[i];
		if (seg.genCol <= targetCol && seg.sourceIdx !== undefined) {
			return {
				col: seg.sourceCol!,
				line: seg.sourceLine!,
				sourceIdx: seg.sourceIdx
			};
		}
	}
	for (const seg of targetLineSegs) {
		if (seg.sourceIdx !== undefined) {
			return {
				col: seg.sourceCol!,
				line: seg.sourceLine!,
				sourceIdx: seg.sourceIdx
			};
		}
	}
	// Step 2: target line has no segments at all. Walk back to the
	// nearest prior line with a mapping. Standard sourcemap-resolver
	// behaviour (V8/JSC honour this).
	for (let li = targetLine - 1; li >= 0; li--) {
		const line = innerLines[li];
		for (let i = line.length - 1; i >= 0; i--) {
			const seg = line[i];
			if (seg.sourceIdx !== undefined) {
				return {
					col: seg.sourceCol!,
					line: seg.sourceLine!,
					sourceIdx: seg.sourceIdx
				};
			}
		}
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

const extractInlineMap = (text: string): SourceMap | null => {
	const match = text.match(SOURCEMAP_INLINE_RE);
	if (!match) return null;
	try {
		return JSON.parse(Buffer.from(match[1], 'base64').toString('utf-8'));
	} catch {
		return null;
	}
};

/* Build a line-shift remap from `before` text (compileScript output)
 * to `after` text (the final intermediate JS as written to disk).
 *
 * The intermediate goes through several non-line-preserving passes —
 * stripExports (line-preserving), Bun.Transpiler (drops blank lines
 * + whole-line type declarations), mergeVueImports (removes every
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
export const buildLineRemap = (before: string, after: string) => {
	const bLines = before.split('\n');
	const aLines = after.split('\n');
	const norm = (s: string) =>
		s.trim().replace(/["']/g, '`').replace(/;\s*$/, '');
	const isVueImport = (s: string) =>
		/^\s*import\s+.*\bfrom\s+["']vue["']\s*;?\s*$/.test(s);
	const mergedVueImportLine = aLines.findIndex(isVueImport);
	const remap: number[] = new Array(bLines.length).fill(-1);
	let ai = 0;
	for (let bi = 0; bi < bLines.length; bi++) {
		const bLine = bLines[bi];
		if (bLine.trim() === '') continue;
		if (isVueImport(bLine)) {
			remap[bi] = mergedVueImportLine;
			continue;
		}
		const bNorm = norm(bLine);
		const horizon = Math.min(aLines.length, ai + 30);
		for (let probe = ai; probe < horizon; probe++) {
			if (norm(aLines[probe]) === bNorm) {
				remap[bi] = probe;
				ai = probe + 1;
				break;
			}
		}
	}
	return remap;
};

/* Build an inline-sourcemap comment from scratch for a transform that
 * is mostly line-preserving (e.g. Bun.Transpiler's TS-stripping over a
 * .ts file). For each source-content line that survived into the
 * generated content (per `buildLineRemap`'s content-matching), emit a
 * single mapping at that generated line pointing back to the source
 * line. Stack-trace remapping cares about line >> column; columns
 * default to 0.
 *
 * Returns the `\n//# sourceMappingURL=data:...base64...\n` comment
 * suitable for appending to the generated file. */
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
		if (genLine < 0 || genLine >= generatedLineCount) continue;
		segs[genLine].push({
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
	return `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(
		JSON.stringify(map)
	).toString('base64')}\n`;
};

/* Apply a generated-line remap to a sourcemap's mappings. Segments on
 * removed lines are dropped; segments on kept lines move to the new
 * generated line index. */
export const remapGeneratedLines = (mappings: string, lineRemap: number[]) => {
	const decoded = decodeMappings(mappings);
	const remapped: Segment[][] = [];
	for (let origLine = 0; origLine < decoded.length; origLine++) {
		const newLine = lineRemap[origLine];
		if (newLine === undefined || newLine < 0) continue;
		while (remapped.length < newLine) remapped.push([]);
		remapped[newLine] = decoded[origLine];
	}
	return encodeMappings(remapped);
};

/* Chain `outer` (gen → outerSrc) with each `fetchInner(outerSrc)` (gen
 * → innerSrc) into a single (gen → innerSrc) map. Outer sources that
 * have no inner map are passed through unchanged. */
export const chainSourcemap = (
	outer: SourceMap,
	fetchInner: (sourcePath: string) => SourceMap | null
): SourceMap => {
	const outerSegs = decodeMappings(outer.mappings);
	const innerMaps = outer.sources.map((s) => (s ? fetchInner(s) : null));
	const innerDecoded = innerMaps.map((m) =>
		m ? decodeMappings(m.mappings) : null
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
	outer.sources.forEach((src, i) => {
		const inner = innerMaps[i];
		if (inner) {
			innerSrcRemap[i] = inner.sources.map((innerSrc, j) =>
				innerSrc === null
					? -1
					: addSource(innerSrc, inner.sourcesContent?.[j] ?? null)
			);
		} else {
			innerSrcRemap[i] = [];
		}
		outerFallbackIdx[i] =
			src === null
				? -1
				: addSource(src, outer.sourcesContent?.[i] ?? null);
	});

	const chained: Segment[][] = outerSegs.map((line) =>
		line.map((seg) => {
			if (seg.sourceIdx === undefined) return { genCol: seg.genCol };
			const innerLines = innerDecoded[seg.sourceIdx];
			if (innerLines) {
				const t = traceInner(
					innerLines,
					seg.sourceLine!,
					seg.sourceCol!
				);
				if (t) {
					return {
						genCol: seg.genCol,
						sourceCol: t.col,
						sourceIdx: innerSrcRemap[seg.sourceIdx][t.sourceIdx],
						sourceLine: t.line
					};
				}
				// Inner trace miss — fall back to outer attribution
				// so Bun's runtime still has something to show.
				return {
					genCol: seg.genCol,
					sourceCol: seg.sourceCol,
					sourceIdx: outerFallbackIdx[seg.sourceIdx],
					sourceLine: seg.sourceLine
				};
			}
			return {
				genCol: seg.genCol,
				sourceCol: seg.sourceCol,
				sourceIdx: outerFallbackIdx[seg.sourceIdx],
				sourceLine: seg.sourceLine
			};
		})
	);

	return {
		mappings: encodeMappings(chained),
		names: outer.names,
		sources: newSources,
		sourcesContent: newSourcesContent,
		version: 3
	};
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
 * No-op if the bundle has no inline map. */
export const chainBundleInlineSourcemap = (bundleFilePath: string) => {
	const text = readFileSync(bundleFilePath, 'utf-8');
	const outerMap = extractInlineMap(text);
	if (!outerMap) return;
	const chained = chainSourcemap(outerMap, (src) => {
		const idx = outerMap.sources.indexOf(src);
		if (idx < 0) return null;
		const content = outerMap.sourcesContent?.[idx];
		if (!content) return null;
		return extractInlineMap(content);
	});
	const stripped = text.replace(SOURCEMAP_INLINE_RE, '');
	const inline =
		'\n//# sourceMappingURL=data:application/json;base64,' +
		Buffer.from(JSON.stringify(chained)).toString('base64');
	writeFileSync(bundleFilePath, stripped + inline);
};
