/* Which modules a bundle is actually made of.
 *
 * `absolute analyze` reported totals per CATEGORY — pages, hydration,
 * client, islands, shared chunks, CSS — which answers "how big" and never
 * "of what". A 400KB page bundle that should be 90KB is a question about
 * one dependency, and a category total cannot name it.
 *
 * Bun's bundler does not report what went into an output, so the bytes
 * are attributed from the SOURCEMAP: every mapping segment names a source
 * file and a generated column, so the bytes between one segment and the
 * next belong to that source. Measured on this repository's own example
 * server bundle, that accounts for 96.9% of 3.9MB across 1,325 sources,
 * and the remainder is reported as unmapped rather than quietly dropped —
 * a bundler's own prelude and the glue between modules belong to no source
 * file, and pretending otherwise would make the percentages lie.
 *
 * The same probe found `@absolutejs/auth` at 1.15MB, 29% of that bundle,
 * which is the kind of thing this exists to show. */

const VLQ_CHARS =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_CONTINUATION = 32;
const VLQ_VALUE_MASK = 31;
const VLQ_SHIFT = 5;

export type ModuleSize = {
	bytes: number;
	source: string;
};

export type BundleModules = {
	/** Bytes that belong to no source file: the bundler's prelude, the
	 *  glue between modules, anything a mapping does not cover. */
	unmapped: number;
	modules: ModuleSize[];
	total: number;
};

type Segment = {
	column: number;
	sourceIndex: number;
};

const segmentsOfLine = (
	lineMappings: string,
	startIndex: number
): { segments: Segment[]; sourceIndex: number } => {
	const segments: Segment[] = [];
	let column = 0;
	let sourceIndex = startIndex;
	for (const text of lineMappings.split(',')) {
		const fields = decodeVlq(text);
		if (fields.length === 0) continue;
		column += fields[0] ?? 0;
		/* The source index is cumulative across the WHOLE mappings
		 * string, unlike the column, which resets each line. */
		if (fields.length > 1) sourceIndex += fields[1] ?? 0;
		segments.push({ column, sourceIndex });
	}

	return { segments, sourceIndex };
};

/** Attributes a bundle's bytes to the sources its sourcemap names.
 *
 *  A segment owns the bytes from its generated column to the next
 *  segment's, and the last one on a line owns the rest of that line. A
 *  line with no mappings at all is unmapped, which is how a prelude shows
 *  up. */
export const attributeBytes = (
	generated: string,
	map: { mappings: string; sources: string[] }
) => {
	const lines = generated.split('\n');
	const bytes = new Map<string, number>();
	let unmapped = 0;
	let sourceIndex = 0;
	const lastLine = lines.length - 1;
	map.mappings.split(';').forEach((lineMappings, lineNumber) => {
		/* +1 for the newline the split removed — except on the last line,
		 * which has none. Counting it there made the attributed bytes
		 * exceed the file by one; caught by a test that knew how long
		 * `real();` is. */
		const lineLength =
			(lines[lineNumber] ?? '').length +
			(lineNumber === lastLine ? 0 : 1);
		if (lineMappings === '') {
			unmapped += lineLength;

			return;
		}
		const { segments, sourceIndex: nextIndex } = segmentsOfLine(
			lineMappings,
			sourceIndex
		);
		sourceIndex = nextIndex;
		segments.forEach((segment, index) => {
			const next = segments[index + 1]?.column ?? lineLength;
			const width = Math.max(0, next - segment.column);
			const resolved = map.sources[segment.sourceIndex] ?? '(unknown)';
			bytes.set(resolved, (bytes.get(resolved) ?? 0) + width);
		});
		/* Bytes before the first mapping on the line belong to no source:
		 * indentation, and whatever the bundler emitted around the
		 * module. */
		unmapped += segments[0]?.column ?? 0;
	});

	const modules = [...bytes.entries()]
		.map(([source, size]) => ({ bytes: size, source }))
		.sort((left, right) => right.bytes - left.bytes);

	const result: BundleModules = {
		modules,
		total: generated.length,
		unmapped
	};

	return result;
};

/** Base64 VLQ, the encoding a sourcemap's `mappings` field uses. Returns
 *  the field list of one segment: generated column, then source index,
 *  source line and source column when present. */
export const decodeVlq = (segment: string) => {
	const values: number[] = [];
	let shift = 0;
	let value = 0;
	for (const character of segment) {
		const digit = VLQ_CHARS.indexOf(character);
		if (digit === -1) return [];
		value += (digit & VLQ_VALUE_MASK) << shift;
		const continues = (digit & VLQ_CONTINUATION) !== 0;
		if (continues) shift += VLQ_SHIFT;
		if (continues) continue;
		const negative = (value & 1) === 1;
		values.push(negative ? -(value >> 1) : value >> 1);
		value = 0;
		shift = 0;
	}

	return values;
};

/** Rolls module sizes up into groups, largest first. */
export const groupModules = (modules: ModuleSize[]) => {
	const totals = new Map<string, number>();
	for (const { bytes, source } of modules) {
		const group = groupOf(source);
		totals.set(group, (totals.get(group) ?? 0) + bytes);
	}

	return [...totals.entries()]
		.map(([group, bytes]) => ({ bytes, group }))
		.sort((left, right) => right.bytes - left.bytes);
};

/** The name to group a source under: the package for a dependency, the
 *  top two path segments for project source. A treemap of 1,325 files is
 *  a wall; a treemap of the 30 things that own them is a report. */
export const groupOf = (source: string) => {
	const normalized = source.replaceAll('\\', '/');
	const parts = normalized.split('node_modules/');
	const dependency = parts.at(-1);
	if (parts.length > 1 && dependency !== undefined) {
		const segments = dependency.split('/');
		const scoped = segments[0]?.startsWith('@') === true;

		return segments.slice(0, scoped ? 2 : 1).join('/');
	}
	const own = normalized.replace(/^(\.\.\/)+/u, '').split('/');

	return own.slice(0, 2).join('/');
};
