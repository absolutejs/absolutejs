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
		const totalSeconds = Math.round(duration / MILLISECONDS_IN_A_SECOND);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		durationString =
			seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
	}

	return durationString;
};
