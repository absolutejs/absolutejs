import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Builds keep answering the three most recent mobile releases so installed apps keep working, but that history lived only in the build directory, so a fresh checkout such as a CI run started with none and every installed app was asked to update. Set `mobile.compatibility.store` to a project module whose default export is a blob store (for example `awsS3BlobStore` from `@absolutejs/blob/aws-s3`) and `absolute start` and `absolute compile` read the history from it and write each new release back. Releases that only an existing build directory knows are copied into the store on the first build, and `mobile.compatibility.prefix` keeps several apps or environments in one bucket apart. The store does not change the app's runtime fingerprint.",
	kind: 'added',
	summary:
		'Mobile release history can live in a blob store, so CI builds keep serving installed apps',
	symbols: ['NormalizedAbsoluteMobileConfig']
};
