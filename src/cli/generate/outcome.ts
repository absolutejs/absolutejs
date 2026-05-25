// Shared result of a generate run, consumed by the summary printer.
export type GenerateOutcome = {
	created: string[];
	manual: { reason: string; snippet: string } | null;
	notes: string[];
	route: string | null;
	updated: string[];
};

export const emptyOutcome = () =>
	({
		created: [],
		manual: null,
		notes: [],
		route: null,
		updated: []
	}) satisfies GenerateOutcome;
