import { getDurationString } from './getDurationString';

export type StartupTimingStep = {
	label: string;
	durationMs: number;
};

export const startupTimingsEnabled =
	process.env.ABSOLUTE_STARTUP_TIMINGS === '1' ||
	process.env.ABSOLUTE_STARTUP_TIMINGS === 'true';

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

	console.log(formatStartupTimingBlock(title, steps));
};
