import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail:
		"`clientModules: { ProjectSettings: 'src/frontend/embeds/ProjectSettings.tsx' }` builds a React module this app serves for another page to import. It is built with the React pages, so it shares their React (`/react/vendor/…`) and chunks, keeps its named exports, and carries none of the pages. Its URL is `asset(manifest, 'ProjectSettingsModule')`; under the dev server that URL is the module server's, so an edit is picked up as page code is. It is for rendering part of this app inside a page another app serves on the same origin, with this app's own React and no iframe. Names are PascalCase; the source must exist.",
	kind: 'added',
	summary: 'clientModules: React modules an app builds for another page to import',
	symbols: ['BuildConfig']
};
