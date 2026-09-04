/* Kept in its own module so a test can read the counter without importing —
 * and therefore evaluating — the plugin module it is counting. */

const EVALUATION_KEY = '__absoluteLazyPluginFixtureEvaluations';

export const readFixtureEvaluations = () => {
	const value = Reflect.get(globalThis, EVALUATION_KEY);

	return typeof value === 'number' ? value : 0;
};

export const recordFixtureEvaluation = () => {
	Reflect.set(globalThis, EVALUATION_KEY, readFixtureEvaluations() + 1);
};
