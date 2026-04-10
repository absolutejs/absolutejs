import type {
	StreamingSlotMetric,
	StreamingSlotMetricType
} from './streamingSlots';

export type StreamingSlotMetricMetadataValue = string | number | boolean | null;

export type StreamingSlotMetricMetadata = Record<
	string,
	StreamingSlotMetricMetadataValue
>;

export type StreamingSlotMetricSinkEvent = StreamingSlotMetric & {
	at: number;
	route?: string;
	metadata?: StreamingSlotMetricMetadata;
};

export type StreamingSlotMetricSinkOptions = {
	onReport?: (metric: StreamingSlotMetricSinkEvent) => void | Promise<void>;
	onError?: (error: unknown, metric: StreamingSlotMetricSinkEvent) => void;
	route?: string;
	metadata?: StreamingSlotMetricMetadata;
	includeTypes?: StreamingSlotMetricType[];
	excludeTypes?: StreamingSlotMetricType[];
	sampleRate?: number;
};

const noop = () => undefined;

const shouldEmitType = (
	metric: StreamingSlotMetric,
	includeTypes?: StreamingSlotMetricType[],
	excludeTypes?: StreamingSlotMetricType[]
) => {
	if (
		Array.isArray(includeTypes) &&
		includeTypes.length > 0 &&
		!includeTypes.includes(metric.type)
	) {
		return false;
	}

	if (Array.isArray(excludeTypes) && excludeTypes.includes(metric.type)) {
		return false;
	}

	return true;
};

const shouldSample = (sampleRate = 1) => {
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) return false;
	if (sampleRate >= 1) return true;

	return Math.random() < sampleRate;
};

const asAsyncReporter =
	(
		reporter: (
			metric: StreamingSlotMetricSinkEvent
		) => void | Promise<void>,
		onError: (error: unknown, metric: StreamingSlotMetricSinkEvent) => void
	) =>
	(metric: StreamingSlotMetricSinkEvent) => {
		try {
			const result = reporter(metric);
			if (
				!result ||
				typeof result !== 'object' ||
				!('catch' in result) ||
				typeof result.catch !== 'function'
			) {
				return;
			}

			result.catch((error: unknown) => onError(error, metric));
		} catch (error) {
			onError(error, metric);
		}
	};

export const createStreamingSlotMetricSink = ({
	excludeTypes,
	includeTypes,
	metadata,
	onReport,
	onError = noop,
	route,
	sampleRate = 1
}: StreamingSlotMetricSinkOptions = {}) => {
	if (typeof onReport !== 'function') {
		return noop;
	}

	const emit = asAsyncReporter(onReport, onError);
	const safeMetadata = metadata ?? {};

	return (metric: StreamingSlotMetric) => {
		if (!shouldSample(sampleRate)) return;
		if (!shouldEmitType(metric, includeTypes, excludeTypes)) return;

		emit({
			...metric,
			at: Date.now(),
			metadata: safeMetadata,
			route
		});
	};
};
