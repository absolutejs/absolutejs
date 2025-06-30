import {
	MILLISECONDS_IN_A_SECOND,
	TIME_PRECISION,
	MILLISECONDS_IN_A_MINUTE
} from '../constants';

export const getDurationString = (duration: number) => {
	let durationString;

	if (duration < MILLISECONDS_IN_A_SECOND) {
		durationString = `${duration.toFixed(TIME_PRECISION)}ms`;
	} else if (duration < MILLISECONDS_IN_A_MINUTE) {
		durationString = `${(duration / MILLISECONDS_IN_A_SECOND).toFixed(TIME_PRECISION)}s`;
	} else {
		durationString = `${(duration / MILLISECONDS_IN_A_MINUTE).toFixed(TIME_PRECISION)}m`;
	}

	return durationString;
};
