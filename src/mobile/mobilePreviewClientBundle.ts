import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The mobile preview client imports @absolutejs/devices (+ /http, /testing),
// which are optional peer packages. It ships to dist/mobile as a browser module
// with those imports left external, so it is bundled on demand here — resolving
// the peers against the consuming application — and served from a dev route the
// HMR client imports only when the mobile-preview target is active. A plain
// web/native app never pays for it, and an app without @absolutejs/devices fails
// this build gracefully (the caller serves a no-op stub) instead of breaking
// every `bun dev`.
const mobilePreviewClientModulePath = async () => {
	// This builder may run inlined (import.meta.dir === dist/) or from
	// dist/mobile/, so probe both the current dir and a sibling mobile/ dir for
	// the shipped client (.js) or source (.ts).
	const directories = [
		import.meta.dir,
		join(import.meta.dir, 'mobile'),
		join(import.meta.dir, '..', 'mobile')
	];
	const candidates = await Promise.all(
		directories.flatMap((directory) =>
			['js', 'ts'].map(async (extension) => {
				const path = join(directory, `mobilePreviewClient.${extension}`);
				try {
					await access(path);

					return path;
				} catch {
					return undefined;
				}
			})
		)
	);
	const path = candidates.find((candidate) => candidate !== undefined);
	if (path) return path;
	throw new TypeError('The AbsoluteJS mobile preview client module is missing.');
};

export const buildAbsoluteMobilePreviewClientBundle = async () => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'absolutejs-mobile-preview-client-')
	);
	const entry = join(temporaryDirectory, 'entry.ts');
	try {
		await writeFile(
			entry,
			`export { installAbsoluteMobilePreview } from ${JSON.stringify(await mobilePreviewClientModulePath())};`
		);
		const result = await Bun.build({
			entrypoints: [entry],
			format: 'esm',
			minify: true,
			target: 'browser'
		});
		if (!result.success || result.outputs.length !== 1) {
			throw new AggregateError(
				result.logs,
				'Failed to build the AbsoluteJS mobile preview client.'
			);
		}

		return result.outputs[0]?.text() ?? '';
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
};
