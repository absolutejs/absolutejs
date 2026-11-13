import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Apps can now be translated. `defineI18n()` takes your locales, the default locale's messages and a loader for each other locale, and `i18nPlugin()` works out each request's locale from the URL prefix (`/fr/about`), the domain, or the visitor's cookie and `Accept-Language` header. Handlers get `locale` and an `i18n` object: `i18n.t('key', params)` formats ICU messages (plurals, select, numbers, dates) with the platform's `Intl`, and `i18n.payload(['namespace'])` returns the messages a page needs to hydrate, which you pass as a page prop. React pages read them with `I18nProvider` and `useI18n()` from `@absolutejs/absolute/react/hooks`; Svelte pages with `setI18n()` and `getI18n()` from `@absolutejs/absolute/svelte`. Message keys and their parameters are type-checked against the default catalog, and a locale missing a key is a type error. `i18n.alternates()` builds hreflang links, which the `alternates` field of `Metadata` renders in `generateHeadElement` and the React and Svelte `Head` components. Setting `sitemap.i18n` lists every page once per locale with hreflang alternates. Svelte pages get the request's `lang` and `dir` on `<html>`. The browser-safe helpers (`createTranslator`, `formatMessage`, `localizePath`, `negotiateLocale`, `localeDirection`) are exported from `@absolutejs/absolute/i18n`. See docs/I18N_PLAN.md.",
	kind: 'added',
	summary:
		'Internationalization: locale routing, typed ICU message catalogs, React and Svelte translation APIs, hreflang links and a per-locale sitemap',
	symbols: [
		'defineI18n',
		'i18nPlugin',
		'getRequestLocale',
		'I18nProvider',
		'useI18n',
		'setI18n',
		'getI18n',
		'createTranslator',
		'defineMessages',
		'formatMessage',
		'Metadata',
		'generateHeadElement',
		'Head',
		'SitemapConfig',
		'BaseBuildConfig'
	]
};
