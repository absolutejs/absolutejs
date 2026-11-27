import type { I18nRoutingConfig } from '../../types/i18n';
import type { RoutingRulesConfig } from '../../types/routingRules';
import { pathnameProblems, pathnameRules } from '../i18n/pathnames';
import { logWarn } from './logger';

/* The config's localized pathnames (`i18n.pathnames`), as the redirects
 * and rewrites that serve them. They are added to the app's own routing
 * rules and applied by the same plugin (plugins/routingRules.ts), which
 * is what makes a translated address work for every kind of page: the
 * request is sent through the server again at the route's own path.
 *
 * The app's own rules come first, so one of them can still answer for a
 * path before these do. */

/** The part of a config this reads: its routing rules and its i18n. */
export type LocalizedRoutingConfig = RoutingRulesConfig & {
	i18n?: I18nRoutingConfig;
};

/** `config` with its localized pathnames added to its redirects and
 *  rewrites. Returned as given when it has none, or when its routing is
 *  not by path prefix: only a prefix says which locale an address is
 *  in. */
export const withPathnameRules = (config: LocalizedRoutingConfig) => {
	const routing = config.i18n;
	if (!routing?.pathnames || Object.keys(routing.pathnames).length === 0)
		return config;
	const problems = pathnameProblems(routing.pathnames);
	if (problems.length > 0) {
		logWarn(
			`Localized pathnames are not served until this is fixed:\n  ${problems.join('\n  ')}`
		);

		return config;
	}
	if ((routing.strategy ?? 'prefix') !== 'prefix') {
		logWarn(
			'i18n.pathnames is only used under the "prefix" strategy, where the path says which locale an address is in. It is ignored.'
		);

		return config;
	}
	const prefixOf = (locale: string) =>
		locale === routing.defaultLocale && !routing.prefixDefault
			? ''
			: `/${locale}`;
	const { redirects, rewrites } = pathnameRules(
		routing.pathnames,
		routing.locales,
		prefixOf
	);
	const next: LocalizedRoutingConfig = {
		...config,
		// Permanent, which is the rules' default: one address per page.
		redirects: [...(config.redirects ?? []), ...redirects],
		rewrites: [...(config.rewrites ?? []), ...rewrites]
	};

	return next;
};
