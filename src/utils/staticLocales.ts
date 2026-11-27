import type { StaticConfig } from '../../types/build';
import type { I18nRoutingConfig } from '../../types/i18n';
import { localizePath } from '../i18n/routing';
import { logWarn } from './logger';

/* Pre-rendering a page once per locale (`static.locales`).
 *
 * `static.routes` lists pages by the path their route is registered
 * at. With `locales` on, each is rendered at every locale's address —
 * `/about`, and `/fr/a-propos` — which is what `localizePath` writes,
 * localized pathnames included.
 *
 * Opt-in, because not every page has every locale: a page registered at
 * `/pricing` alone has no `/fr/pricing`, and asking for one would report
 * a page that failed to render when it was never meant to exist. With
 * `locales` on, an address a locale does not serve is left out and not
 * reported (core/prerender.ts). */

/** `static` with `locales: true` replaced by the routing it stands
 *  for: the config's `i18n`. The pre-renderer is handed the result. */
export const withStaticLocales = (
	staticConfig: StaticConfig | undefined,
	i18n: I18nRoutingConfig | undefined
) => {
	if (!staticConfig || staticConfig.locales !== true) return staticConfig;
	if (i18n && (i18n.strategy ?? 'prefix') === 'prefix') {
		const resolved: StaticConfig = { ...staticConfig, locales: i18n };

		return resolved;
	}
	logWarn(
		i18n
			? 'static.locales is only used under the "prefix" i18n strategy, where each locale has an address of its own. It is ignored.'
			: 'static.locales is set and the config has no i18n key to say what the locales are. It is ignored.'
	);
	const { locales: _, ...rest } = staticConfig;
	const without: StaticConfig = rest;

	return without;
};

/** A route to pre-render, and whether it was asked for outright or is
 *  a locale's address for one that was. */
export type StaticLocaleRoute = { asked: boolean; route: string };

/** Every locale's address for each of `routes`, once each. A route as
 *  it was listed keeps `asked`, so its failure is still reported. */
export const localeRoutes = (
	routes: readonly string[],
	locales: StaticConfig['locales']
) => {
	const listed = new Map<string, StaticLocaleRoute>(
		routes.map((route) => [route, { asked: true, route }])
	);
	if (typeof locales !== 'object') return [...listed.values()];
	const { locales: all } = locales;
	routes
		.flatMap((route) =>
			all.map((locale) => localizePath(route, locale, locales))
		)
		.filter((address) => !listed.has(address))
		.forEach((address) => {
			listed.set(address, { asked: false, route: address });
		});

	return [...listed.values()];
};
