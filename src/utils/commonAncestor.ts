import { normalizePath } from './normalizePath';

export const commonAncestor = (paths: string[], fallback?: string) => {
	if (paths.length === 0) return fallback;
	// Normalize all paths and split by forward slash for cross-platform compatibility
	const segmentsList = paths.map((p) => normalizePath(p).split('/'));
	const [first] = segmentsList;
	if (!first) return fallback;
	const commonSegments = first.filter((segment, index) =>
		segmentsList.every((pathSegs) => pathSegs[index] === segment)
	);

	// Always join with forward slash for normalized output
	return commonSegments.length ? commonSegments.join('/') : fallback;
};
