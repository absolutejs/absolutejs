import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import type { I18nPayload } from '../../../types/i18n';
import type { Metadata } from '../../../types/metadata';
import { renderToReadableStream } from '../../../src/svelte/renderToReadableStream';
import { registerRequestLocaleGetter } from '../../../src/utils/localeRef';

const I18N_MODULE = resolve(import.meta.dir, '../../../src/svelte/i18n.ts');
const HEAD_SOURCE = resolve(
	import.meta.dir,
	'../../../src/svelte/components/Head.svelte'
);
const ICON_VERSION = resolve(
	import.meta.dir,
	'../../../src/utils/iconVersion.ts'
);
// Inside the repo so the compiled modules resolve `svelte` from node_modules.
const directory = mkdtempSync(
	join(resolve(import.meta.dir, '../../..'), '.svelte-i18n-')
);

const PAGE = `<script lang="ts">
	import { setI18n } from '${I18N_MODULE}';
	import Child from './Child.svelte';
	let { i18n } = $props();
	const { t, locale, dir } = setI18n(i18n);
</script>
<main lang={locale} {dir}><h1>{t('home.title', { name: 'Ada' })}</h1><Child /></main>`;

const CHILD = `<script lang="ts">
	import { getI18n } from '${I18N_MODULE}';
	const { t } = getI18n();
</script>
<p>{t('home.items', { count: 2 })}</p>`;

const ORPHAN = `<script lang="ts">
	import { getI18n } from '${I18N_MODULE}';
	getI18n();
</script>`;

const compileTo = (source: string, name: string) => {
	const { js } = compile(source, {
		filename: `${name}.svelte`,
		generate: 'server'
	});
	writeFileSync(
		join(directory, `${name}.js`),
		js.code
			.replace("'./Child.svelte'", "'./Child.js'")
			.replace("'../../utils/iconVersion'", JSON.stringify(ICON_VERSION))
	);
};

compileTo(PAGE, 'Page');
compileTo(CHILD, 'Child');
compileTo(ORPHAN, 'Orphan');
compileTo(readFileSync(HEAD_SOURCE, 'utf8'), 'Head');

const loadComponent = async <Props extends Record<string, unknown>>(
	name: string
) => {
	const loaded: { default: Component<Props> } = await import(
		join(directory, `${name}.js`)
	);

	return loaded.default;
};

afterAll(() => {
	registerRequestLocaleGetter(() => undefined);
	rmSync(directory, { force: true, recursive: true });
});

const payload: I18nPayload = {
	defaultLocale: 'en',
	dir: 'ltr',
	locale: 'fr',
	messages: {
		home: {
			items: '{count, plural, one {# article} other {# articles}}',
			title: 'Bonjour {name}'
		}
	}
};

describe('Svelte i18n', () => {
	test('setI18n translates the page and shares messages with children', async () => {
		const Page = await loadComponent<{ i18n: I18nPayload }>('Page');
		const { body } = render(Page, { props: { i18n: payload } });
		expect(body).toContain('<main lang="fr" dir="ltr">');
		expect(body).toContain('<h1>Bonjour Ada</h1>');
		expect(body).toContain('<p>2 articles</p>');
	});

	test('getI18n without setI18n throws a clear error', async () => {
		const Orphan = await loadComponent('Orphan');
		expect(() => render(Orphan).body).toThrow(/setI18n/);
	});

	test('Head renders hreflang alternates', async () => {
		const Head = await loadComponent<Metadata>('Head');
		const { head } = render(Head, {
			props: {
				alternates: [
					{ href: 'https://x.com/about', hreflang: 'en' },
					{ href: 'https://x.com/fr/about', hreflang: 'fr' }
				]
			}
		});
		expect(head).toContain(
			'<link rel="alternate" hreflang="fr" href="https://x.com/fr/about"/>'
		);
	});

	test('the document shell writes the request locale into <html>', async () => {
		const Page = await loadComponent<Record<string, unknown>>('Page');
		const readShell = async () => {
			const stream = await renderToReadableStream(Page, {
				i18n: payload
			});

			return new Response(stream).text();
		};
		registerRequestLocaleGetter(() => undefined);
		expect(await readShell()).toContain('<html lang="en">');
		registerRequestLocaleGetter(() => ({ dir: 'rtl', locale: 'ar' }));
		expect(await readShell()).toContain('<html lang="ar" dir="rtl">');
	});
});
