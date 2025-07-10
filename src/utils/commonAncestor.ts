import { sep } from 'node:path';

export const commonAncestor = (paths: string[], fallback?: string) => {
	if (paths.length === 0) return fallback;
	const segmentsList = paths.map((p) => p.split(sep));
	const [first] = segmentsList;
	if (!first) return fallback;
	const commonSegments = first.filter((segment, index) =>
		segmentsList.every((pathSegs) => pathSegs[index] === segment)
	);

	return commonSegments.length ? commonSegments.join(sep) : fallback;
};
