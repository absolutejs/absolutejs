import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Self-hosted htmx story. htmx's own docs recommend downloading a pinned copy
// into your project (not a CDN <script>), so AbsoluteJS vendors a default build
// and places it for you — offline — and `absolute htmx <version>` swaps in any
// version from jsDelivr without you hand-managing the file.

export const VENDORED_HTMX_VERSION = '2.0.6';

// The vendored file ships next to this module in src (dev) and is copied to
// dist/cli/htmx by the build, so one of these candidates always resolves.
const vendoredHtmxFile = () =>
	[
		join(import.meta.dir, 'htmx.min.js'),
		join(import.meta.dir, 'htmx', 'htmx.min.js'),
		join(import.meta.dir, '..', 'htmx', 'htmx.min.js')
	].find((path) => existsSync(path)) ?? null;

export const detectHtmxVersion = (content: string) => {
	const match = content.match(/version:"([0-9.]+)"/);

	return match ? match[1] : null;
};
export const fetchHtmx = async (version: string) => {
	const url = `https://cdn.jsdelivr.net/npm/htmx.org@${version}/dist/htmx.min.js`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch htmx@${version} (HTTP ${response.status})`
		);
	}

	return response.text();
};
export const installedHtmxVersion = (htmxDir: string) => {
	const file = join(htmxDir, 'htmx.min.js');
	if (!existsSync(file)) return null;

	return detectHtmxVersion(readFileSync(file, 'utf-8'));
};
export const readVendoredHtmx = () => {
	const file = vendoredHtmxFile();

	return file ? readFileSync(file, 'utf-8') : null;
};
export const writeHtmx = (htmxDir: string, content: string) => {
	mkdirSync(htmxDir, { recursive: true });
	const file = join(htmxDir, 'htmx.min.js');
	writeFileSync(file, content, 'utf-8');

	return file;
};
