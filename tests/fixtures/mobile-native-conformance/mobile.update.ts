// The native conformance harness serves deliberately malformed and interrupted
// responses itself. This marked durable boundary lets the release doctor prove
// that the external control plane was selected without handling real artifacts.
export const absoluteMobileUpdateServer = {
	format: 1,
	provider: 'native-conformance-harness',
	storage: 'durable'
} as const;

const harnessOnly = async () => {
	throw new Error('The native conformance harness owns update traffic.');
};

type HarnessRegistry = Record<
	| 'promoteUpdate'
	| 'publishUpdate'
	| 'readUpdateFile'
	| 'resolveUpdate'
	| 'rollbackUpdate',
	typeof harnessOnly
>;

export const registry: HarnessRegistry = {
	promoteUpdate: harnessOnly,
	publishUpdate: harnessOnly,
	readUpdateFile: harnessOnly,
	resolveUpdate: harnessOnly,
	rollbackUpdate: harnessOnly
};
