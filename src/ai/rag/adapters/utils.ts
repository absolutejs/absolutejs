const vectorDimensionDefault = 24;

export const createRAGVector = (
	text: string,
	dimensions = vectorDimensionDefault
) => {
	const bucket = new Array(dimensions).fill(0);
	const content = text.toLowerCase();

	for (let idx = 0; idx < content.length; idx += 1) {
		const char = content.charCodeAt(idx);
		const bucketIndex = char % dimensions;
		bucket[bucketIndex] += 1;
	}

	return bucket;
};
export const normalizeVector = (vector: number[]) => {
	const magnitude = Math.sqrt(
		vector.reduce((sum, value) => sum + value * value, 0)
	);

	if (!Number.isFinite(magnitude) || magnitude === 0) {
		return vector.map(() => 0);
	}

	const scale = 1 / magnitude;

	return vector.map((value) => value * scale);
};
export const querySimilarity = (left: number[], right: number[]) => {
	const maxLength = Math.max(left.length, right.length);
	if (maxLength === 0) {
		return 0;
	}

	const paddedLeft =
		left.length === maxLength
			? left
			: [...left, ...new Array(maxLength - left.length).fill(0)];
	const paddedRight =
		right.length === maxLength
			? right
			: [...right, ...new Array(maxLength - right.length).fill(0)];

	let score = 0;
	for (let index = 0; index < maxLength; index += 1) {
		score += (paddedLeft[index] ?? 0) * (paddedRight[index] ?? 0);
	}

	return score;
};
