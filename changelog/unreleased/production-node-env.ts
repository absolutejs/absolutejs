import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Bun's bundler replaces a literal `process.env.NODE_ENV` with its build-time value, and with nothing defined that value is \"development\". The published dist/ was built that way, so every such check was a constant: `absolute start` and compiled binaries ran development code with NODE_ENV=production. Error convention pages received `error.stack`; Vue pages with `client: 'none'` shipped the ~130 KB inline dev reload client; React pages emitted the Fast Refresh setup; Angular pages stat'ed their module on every request; and the island-bootstrap and streaming-slot dev warnings stayed on. The library build now leaves `process.env.NODE_ENV` a runtime read, the source reads it through `src/utils/runtimeMode.ts`, and a lint rule rejects a literal `process.env.NODE_ENV` in src/.",
	kind: 'security',
	summary:
		"Production servers no longer run development code paths: error pages stop exposing stacks, and `client: 'none'` Vue pages stop shipping the dev reload client"
};
