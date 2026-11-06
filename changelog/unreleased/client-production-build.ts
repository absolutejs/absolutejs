import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Production client bundles compiled `process.env.NODE_ENV` as development, because Bun.build does so unless told otherwise, whatever the environment says. React's own vendor build was already fixed, but anything else a page bundled took its development build. That made bundles larger and slower, and could pair a package's development code with production React: the reconciler inside @react-three/fiber reads React's `actQueue`, which production React doesn't have, and threw on absolutejs.ai's billing page. React, other-framework, island and worker client builds now say production in a production build. Development builds are unchanged.",
	kind: 'fixed',
	summary:
		'Production client bundles use the production build of every package'
};
