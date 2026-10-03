import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The emitted declarations of these functions list the `generation` member of their inferred object types in a different position. Their types are unchanged.',
	kind: 'internal',
	summary: 'Mobile release artifact declarations list one member in a different order',
	symbols: [
		'createAbsoluteMobileCompatibilityArtifact',
		'parseAbsoluteMobileCompatibilityArtifact',
		'readAbsoluteMobileMaterializedReleases'
	]
};
