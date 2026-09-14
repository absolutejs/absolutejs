/**
 * Detach a Bun/Node timer without assuming the DOM or server timer type wins
 * in a mixed-runtime TypeScript program. Browser numeric handles are a no-op.
 */
export const unrefTimer = (timer: unknown) => {
	if (
		timer === null ||
		(typeof timer !== 'object' && typeof timer !== 'function')
	)
		return;
	const unref = Reflect.get(timer, 'unref');
	if (typeof unref === 'function') Reflect.apply(unref, timer, []);
};
