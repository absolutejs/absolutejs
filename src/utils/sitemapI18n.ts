import type { I18nRoutingConfig } from '../../types/i18n';
import type { SitemapConfig } from '../../types/sitemap';
import { i18nRoutingDifferences } from './i18nRoutingRef';
import { logWarn } from './logger';

/* The sitemap's locales: its own `sitemap.i18n` when it says, else the
 * config's `i18n`, so an app declares them once. Both given and
 * different is two answers to one question, and is said. */
export const withConfigI18n = (
	sitemap: SitemapConfig | undefined,
	i18n: I18nRoutingConfig | undefined
) => {
	if (!i18n) return sitemap;
	if (!sitemap?.i18n) return { ...sitemap, i18n };
	const differences = i18nRoutingDifferences(i18n, sitemap.i18n);
	if (differences.length > 0)
		logWarn(
			`i18n and sitemap.i18n in the config disagree on ${differences.join(', ')}. The sitemap goes by sitemap.i18n. Remove sitemap.i18n to use the one declaration.`
		);

	return sitemap;
};
