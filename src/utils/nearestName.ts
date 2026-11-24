/** Distance below which a name reads as a typo of a known one rather
 *  than a different intention. */
const MINIMUM_TYPO_DISTANCE = 2;
const TYPO_LENGTH_DIVISOR = 3;

const nextRow = (
	left: string,
	right: string,
	previous: readonly number[],
	rowIndex: number
) => {
	const row = [rowIndex + 1];
	for (const [colIndex, char] of [...right].entries()) {
		const cost = left[rowIndex] === char ? 0 : 1;
		row.push(
			Math.min(
				(row[colIndex] ?? 0) + 1,
				(previous[colIndex + 1] ?? 0) + 1,
				(previous[colIndex] ?? 0) + cost
			)
		);
	}

	return row;
};

const levenshtein = (left: string, right: string) => {
	let previous: readonly number[] = Array.from(
		{ length: right.length + 1 },
		(_, index) => index
	);
	for (const rowIndex of [...left].keys())
		previous = nextRow(left, right, previous, rowIndex);

	return previous[right.length] ?? right.length;
};

/** The closest known name, when one is close enough to be a typo. Shared
 *  by the CLI's flag validation and the config loader's key check. */
export const nearestName = (name: string, known: readonly string[]) => {
	const scored = known
		.map((candidate) => ({
			candidate,
			distance: levenshtein(name, candidate)
		}))
		.sort((left, right) => left.distance - right.distance);
	const [best] = scored;
	const limit = Math.max(
		MINIMUM_TYPO_DISTANCE,
		Math.floor(name.length / TYPO_LENGTH_DIVISOR)
	);

	return best && best.distance <= limit ? best.candidate : undefined;
};
