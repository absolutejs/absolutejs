import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * How big a chunk of files one ESLint process can take, from how much memory
 * earlier processes peaked at.
 *
 * A type-aware process pays a fixed cost to build the TypeScript program
 * (onSpark: about 26 s and 1.6 GB) and then a little per file. Few, large
 * processes pay the fixed cost few times; too large runs out of memory. Each
 * finished process reports `files` and `peakBytes`; a straight line through
 * them (base + slope × files) gives the chunk size that peaks at the target.
 * Observations are kept between runs, so even a cold run starts right-sized
 * instead of creeping up from a small first chunk.
 *
 * Each kind of file (its extension) has its own line: on onSpark a `.vue`
 * chunk gets no type information and peaks at 0.3 GB where a `.ts` chunk
 * peaks at 1.6 GB or more, and one line through both made every chunk tiny.
 * The line is a median of pairwise slopes, so one odd chunk can't swing it.
 */

export type MemoryObservation = {
	files: number;
	kind: string;
	peakBytes: number;
};

const median = (values: number[]) => {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);

	return sorted.length % 2 === 1
		? (sorted[middle] ?? 0)
		: ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/* Never extrapolate further than twice the largest chunk seen. */
const MAX_EXTRAPOLATION = 2;
const KEPT_OBSERVATIONS = 24;

type Bounds = { initial: number; max: number; min: number };

const clamp = (value: number, bounds: Bounds) =>
	Math.max(bounds.min, Math.min(bounds.max, Math.round(value)));

const usable = (observations: MemoryObservation[]) =>
	observations.filter(
		(observation) => observation.files > 0 && observation.peakBytes > 0
	);

/* A robust line through the observations (Theil–Sen: the median of the
 * slopes between every two sizes), or null when they don't span two sizes or
 * the slope isn't positive. */
const fitLine = (observations: MemoryObservation[]) => {
	const slopes = observations.flatMap((left, index) =>
		observations
			.slice(index + 1)
			.filter((right) => right.files !== left.files)
			.map(
				(right) =>
					(right.peakBytes - left.peakBytes) /
					(right.files - left.files)
			)
	);
	if (slopes.length === 0) return null;
	const slope = median(slopes);
	if (!(slope > 0)) return null;

	return {
		base: median(
			observations.map((item) => item.peakBytes - slope * item.files)
		),
		slope
	};
};

/** Files for the next process so its peak lands near `targetBytes`. */
export const chunkSizeFor = (
	observations: MemoryObservation[],
	kind: string,
	targetBytes: number,
	bounds: Bounds
) => {
	const known = usable(observations).filter((item) => item.kind === kind);
	if (known.length === 0) return clamp(bounds.initial, bounds);
	const largest = Math.max(...known.map((item) => item.files));
	const line = fitLine(known);
	const heaviest = known.reduce((worst, item) =>
		item.peakBytes / item.files > worst.peakBytes / worst.files
			? item
			: worst
	);
	// With a line, solve it for the target. With one size seen, scale it
	// proportionally: that treats the fixed cost as per-file, so it
	// underestimates what fits, which is the safe direction.
	const fitted = line
		? (targetBytes - line.base) / line.slope
		: heaviest.files * (targetBytes / heaviest.peakBytes);

	return clamp(Math.min(fitted, largest * MAX_EXTRAPOLATION), bounds);
};

/** The kind of a file, for sizing: its extension. */
export const fileKind = (file: string) => file.match(/\.[^./]+$/)?.[0] ?? '';

/** The observations saved by earlier runs (none when unreadable). */
export const loadObservations = (location: string, cwd: string) => {
	const path = resolve(cwd, location);
	if (!existsSync(path)) return [];
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
		if (!Array.isArray(parsed)) return [];

		return parsed.filter(
			(item): item is MemoryObservation =>
				typeof item === 'object' &&
				item !== null &&
				typeof item.files === 'number' &&
				typeof item.kind === 'string' &&
				typeof item.peakBytes === 'number'
		);
	} catch {
		return [];
	}
};

/** Keep the newest observations of each kind for the next run. */
export const saveObservations = (
	location: string,
	observations: MemoryObservation[],
	cwd: string
) =>
	writeFileSync(
		resolve(cwd, location),
		`${JSON.stringify(
			[...new Set(observations.map((item) => item.kind))].flatMap(
				(kind) =>
					usable(observations)
						.filter((item) => item.kind === kind)
						.slice(-KEPT_OBSERVATIONS)
			)
		)}\n`
	);
