export const planNativeCandidateSearchK = (input: {
	topK: number;
	queryMultiplier: number;
	candidateLimit: number;
	filteredCandidateCount?: number;
}) => {
	const base = Math.min(
		Math.max(input.topK * input.queryMultiplier, input.topK),
		input.candidateLimit
	);

	if (
		input.filteredCandidateCount === undefined ||
		!Number.isFinite(input.filteredCandidateCount)
	) {
		return base;
	}

	const filtered = Math.max(0, Math.floor(input.filteredCandidateCount));
	if (filtered === 0) {
		return 0;
	}

	return Math.min(base, filtered);
};

export const resolveAdaptiveNativeCandidateLimit = (input: {
	defaultCandidateLimit: number;
	explicitCandidateLimit?: number;
	filteredCandidateCount?: number;
	plannerProfile?: 'latency' | 'balanced' | 'recall';
	queryMultiplier: number;
	topK: number;
}) => {
	const clamp = (value: number) =>
		Math.min(input.defaultCandidateLimit, Math.max(1, Math.floor(value)));
	const filteredCap =
		typeof input.filteredCandidateCount === 'number' &&
		Number.isFinite(input.filteredCandidateCount)
			? Math.max(0, Math.floor(input.filteredCandidateCount))
			: undefined;

	if (
		typeof input.explicitCandidateLimit === 'number' &&
		Number.isFinite(input.explicitCandidateLimit)
	) {
		return filteredCap === undefined
			? clamp(input.explicitCandidateLimit)
			: Math.min(clamp(input.explicitCandidateLimit), filteredCap);
	}

	const baseFloor = Math.max(
		input.topK,
		input.topK * Math.max(1, Math.floor(input.queryMultiplier))
	);
	let tuned =
		input.plannerProfile === 'latency'
			? clamp(Math.max(input.topK * 2, baseFloor))
			: input.plannerProfile === 'recall'
				? clamp(Math.max(input.topK * 12, baseFloor * 4))
				: clamp(Math.max(input.topK * 6, baseFloor * 2));

	if (filteredCap !== undefined) {
		if (filteredCap === 0) {
			return 0;
		}

		tuned = Math.min(tuned, filteredCap);
	}

	return tuned;
};

export const planNativeCandidateSearchBackfillK = (input: {
	currentSearchK: number;
	candidateLimit: number;
	filteredCandidateCount?: number;
	backfillCount?: number;
	maxBackfills?: number;
}) => {
	if (
		typeof input.maxBackfills === 'number' &&
		Number.isFinite(input.maxBackfills) &&
		(input.backfillCount ?? 0) >=
			Math.max(0, Math.floor(input.maxBackfills))
	) {
		return input.currentSearchK;
	}

	const cappedLimit =
		input.filteredCandidateCount === undefined ||
		!Number.isFinite(input.filteredCandidateCount)
			? input.candidateLimit
			: Math.min(
					input.candidateLimit,
					Math.max(0, Math.floor(input.filteredCandidateCount))
				);

	if (input.currentSearchK >= cappedLimit) {
		return input.currentSearchK;
	}

	return Math.min(
		cappedLimit,
		Math.max(input.currentSearchK + 1, input.currentSearchK * 2)
	);
};

export const summarizeSQLiteCandidateCoverage = (input: {
	topK: number;
	filteredCandidateCount?: number;
	returnedCount?: number;
}): 'empty' | 'under_target' | 'target_sized' | 'broad' => {
	const basis =
		typeof input.filteredCandidateCount === 'number' &&
		Number.isFinite(input.filteredCandidateCount)
			? Math.max(0, Math.floor(input.filteredCandidateCount))
			: typeof input.returnedCount === 'number' &&
				  Number.isFinite(input.returnedCount)
				? Math.max(0, Math.floor(input.returnedCount))
				: 0;

	if (basis === 0) {
		return 'empty';
	}

	if (basis < input.topK) {
		return 'under_target';
	}

	if (basis >= input.topK * 3) {
		return 'broad';
	}

	return 'target_sized';
};
