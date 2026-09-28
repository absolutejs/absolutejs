import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`absolute bun-patch install` and the `absolute dev` offer now install `bun-v1.4.0-absolute.2`. The first release was built as a Bun canary build (Bun's build default): it reported `1.4.0-canary.1`, enabled Bun's experimental \"bake\" server features and made `bun upgrade` track canary. absolute.2 is built with `--canary=off`, as Bun's own releases are; the React Fast Refresh fix is unchanged. Run `absolute bun-patch install` to replace an absolute.1 install.",
	kind: 'fixed',
	summary: 'The patched Bun is now a release build, not a canary build'
};
