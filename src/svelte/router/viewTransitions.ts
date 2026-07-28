const supportsViewTransitions = () => {
	if (typeof document === 'undefined') return false;

	return typeof Reflect.get(document, 'startViewTransition') === 'function';
};

/**
 * Wrap a state mutation in `document.startViewTransition` when supported.
 * Falls through to a synchronous call otherwise. Reduced-motion users get
 * instant swaps via the browser's own handling of `prefers-reduced-motion`.
 */
export const withViewTransition = async (
	mutate: () => void | Promise<void>
) => {
	if (!supportsViewTransitions()) {
		await mutate();

		return;
	}

	// Call as a method on `document` (NOT as an extracted bare function) —
	// `document.startViewTransition` requires `this === document` or it
	// throws "Illegal invocation".
	const startViewTransition: unknown = Reflect.get(
		document,
		'startViewTransition'
	);
	if (typeof startViewTransition !== 'function') {
		await mutate();

		return;
	}
	const transitionResult: unknown = Reflect.apply(
		startViewTransition,
		document,
		[() => mutate()]
	);
	if (
		typeof transitionResult === 'object' &&
		transitionResult !== null &&
		'finished' in transitionResult
	) {
		await transitionResult.finished;
	}
};
