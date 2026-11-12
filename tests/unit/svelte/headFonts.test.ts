import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import type { Metadata } from '../../../types/metadata';

const SOURCE = resolve(
	import.meta.dir,
	'../../../src/svelte/components/Head.svelte'
);
const ICON_VERSION = resolve(
	import.meta.dir,
	'../../../src/utils/iconVersion.ts'
);
// Inside the repo so the compiled module resolves `svelte` from node_modules.
const directory = mkdtempSync(
	join(resolve(import.meta.dir, '../../..'), '.svelte-head-')
);

/* Compiles the source component for SSR, pointing its one relative import
 * at the source tree so the compiled module can live in a temp dir. */
const loadHead = async () => {
	const { js } = compile(readFileSync(SOURCE, 'utf8'), {
		filename: 'Head.svelte',
		generate: 'server'
	});
	const modulePath = join(directory, 'Head.js');
	writeFileSync(
		modulePath,
		js.code.replace(
			"'../../utils/iconVersion'",
			JSON.stringify(ICON_VERSION)
		)
	);
	const loaded: { default: Component<Metadata> } = await import(modulePath);

	return loaded.default;
};

afterAll(() => rmSync(directory, { force: true, recursive: true }));

describe('Svelte Head fonts', () => {
	test('renders font preloads and the linked font stylesheet', async () => {
		const Head = await loadHead();
		const { head } = render(Head, {
			props: {
				cssPath: '/page.css',
				fonts: {
					preload: [
						'/assets/fonts/poppins-latin-400-normal.1a2b3c4d.woff2'
					],
					stylesheets: ['/assets/fonts/fonts.1a2b3c4d.css']
				}
			}
		});
		expect(head).toContain(
			'<link rel="preload" href="/assets/fonts/poppins-latin-400-normal.1a2b3c4d.woff2" as="font" type="font/woff2" crossorigin="anonymous"/>'
		);
		expect(head).toContain(
			'<link rel="stylesheet" href="/assets/fonts/fonts.1a2b3c4d.css" data-absolute-fonts=""/>'
		);
		expect(head.indexOf('fonts.1a2b3c4d.css')).toBeLessThan(
			head.indexOf('/page.css')
		);
		expect(head).not.toContain('fonts.googleapis.com');
	});

	test('adds preconnects only for a remote fallback stylesheet', async () => {
		const Head = await loadHead();
		const { head } = render(Head, {
			props: {
				fonts: {
					preload: [],
					stylesheets: [
						'https://fonts.googleapis.com/css2?family=Poppins'
					]
				}
			}
		});
		expect(head).toContain(
			'rel="preconnect" href="https://fonts.gstatic.com"'
		);
	});
});
