import { afterAll, describe, expect, test } from 'bun:test';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { I18nPayload } from '../../../types/i18n';
import { handleVuePageRequest } from '../../../src/vue';
import { provideI18n, useI18n } from '../../../src/vue/i18n';
import { registerRequestLocaleGetter } from '../../../src/utils/localeRef';

/* Vue's half of what the Svelte and React bindings already do: the page
 * gets the locale's messages as a prop, shares them downward, and the
 * shell says which language the document is in. */

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

const Child = defineComponent({
	name: 'Child',
	setup() {
		const { t } = useI18n();

		return () => h('p', t('home.items', { count: 2 }));
	}
});

const Page = defineComponent({
	name: 'Page',
	props: { i18n: { required: true, type: Object } },
	setup(props: { i18n: I18nPayload }) {
		const { dir, locale, t } = provideI18n(props.i18n);

		return () =>
			h('main', { dir, lang: locale }, [
				h('h1', t('home.title', { name: 'Ada' })),
				h(Child)
			]);
	}
});

const Orphan = defineComponent({
	name: 'Orphan',
	setup() {
		useI18n();

		return () => h('p', 'never rendered');
	}
});

afterAll(() => registerRequestLocaleGetter(() => undefined));

describe('Vue i18n', () => {
	test('provideI18n translates the page and shares messages with children', async () => {
		const html = await renderToString(
			createSSRApp(Page, { i18n: payload })
		);
		expect(html).toContain('lang="fr"');
		expect(html).toContain('dir="ltr"');
		expect(html).toContain('<h1>Bonjour Ada</h1>');
		// The plural form the child resolved through the injected payload.
		expect(html).toContain('<p>2 articles</p>');
	});

	test('useI18n without provideI18n throws a clear error', async () => {
		// Not a silent fallback to the keys: a page that forgot the call
		// would otherwise show `home.title` to visitors.
		expect(renderToString(createSSRApp(Orphan))).rejects.toThrow(
			/provideI18n/
		);
	});

	test('the translator carries the locale, direction and formatters', async () => {
		const seen: { formatted?: string } = {};
		const Formats = defineComponent({
			name: 'Formats',
			setup() {
				const { formatNumber } = provideI18n(payload);
				seen.formatted = formatNumber(1234.5);

				return () => h('p', seen.formatted);
			}
		});
		await renderToString(createSSRApp(Formats));
		// fr groups with a narrow no-break space, so this also proves the
		// formatter took the payload's locale rather than the system one.
		expect(seen.formatted).toMatch(/1\s?234,5/u);
	});
});

describe('the Vue document shell', () => {
	/* Svelte's renderers have written these since Phase 1; Vue emitted a
	 * bare `<html>`, so a screen reader announced every Vue page in the
	 * browser's default language and an RTL locale rendered left to
	 * right. */
	const readShell = async () => {
		const response = await handleVuePageRequest({
			client: 'none',
			Page: defineComponent({
				setup: () => () => h('h1', 'Bonjour')
			}),
			pagePath: '/tests/locale.vue'
		});

		return response.text();
	};

	test('falls back to lang="en" with no request locale', async () => {
		registerRequestLocaleGetter(() => undefined);
		expect(await readShell()).toContain('<html lang="en">');
	});

	test('writes the request locale and its direction', async () => {
		registerRequestLocaleGetter(() => ({ dir: 'rtl', locale: 'ar' }));
		expect(await readShell()).toContain('<html lang="ar" dir="rtl">');
	});
});
