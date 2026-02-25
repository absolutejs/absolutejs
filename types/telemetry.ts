export type TelemetryConfig = {
	enabled: boolean;
	anonymousId: string;
	createdAt: string;
};

export type TelemetryEvent = {
	event: string;
	anonymousId: string;
	version: string;
	os: string;
	arch: string;
	bunVersion: string;
	timestamp: string;
	payload: Record<string, unknown>;
};
