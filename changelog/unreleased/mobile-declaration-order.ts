import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The published type declarations of these mobile release functions list the members of their inferred result types in a different order. The types are the same; nothing about how they are called or what they return changed.',
	kind: 'internal',
	summary:
		'Mobile release functions’ declarations reorder their result members',
	symbols: [
		'buildAbsoluteAndroidRelease',
		'buildAbsoluteIosRelease',
		'buildAbsoluteRemoteIosRelease',
		'createAbsoluteMobileCompatibilityArtifact',
		'installAbsoluteIosRelease',
		'parseAbsoluteMobileCompatibilityArtifact',
		'readAbsoluteMobileMaterializedReleases'
	]
};
