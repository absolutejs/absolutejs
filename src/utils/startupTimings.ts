import { getDurationString } from './getDurationString';

export type StartupTimingStep = {
	label: string;
	durationMs: number;
};

const isTruthyFlag = (value: string | undefined) =>
	value === '1' || value === 'true';

/** `ABSOLUTE_DEV_PROFILE=1` is the one-stop profiling switch: it turns on
 *  these per-step startup timings AND the per-phase build trace
 *  (`ABSOLUTE_BUILD_TRACE`, written to `<buildDir>/.absolute-trace/`). */
export const devProfileEnabled = isTruthyFlag(process.env.ABSOLUTE_DEV_PROFILE);

export const startupTimingsEnabled =
	devProfileEnabled || isTruthyFlag(process.env.ABSOLUTE_STARTUP_TIMINGS);

export const formatStartupTimingBlock = (
	title: string,
	steps: StartupTimingStep[]
) => {
	const totalDuration = steps.reduce((sum, step) => sum + step.durationMs, 0);

	return [
		title,
		...steps.map(
			(step) => `  - ${step.label}: ${getDurationString(step.durationMs)}`
		),
		`  Total: ${getDurationString(totalDuration)}`
	].join('\n');
};

export const logStartupTimingBlock = (
	title: string,
	steps: StartupTimingStep[]
) => {
	if (!startupTimingsEnabled || steps.length === 0) {
		return;
	}

	// Profiling output goes to stderr so it never interleaves with (or gets
	// scraped as) the server's own stdout — e.g. the `Local:` ready line.
	console.error(formatStartupTimingBlock(title, steps));
};
