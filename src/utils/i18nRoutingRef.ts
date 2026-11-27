import type { I18nRoutingConfig } from '../../types/i18n';

/* The app's locale routing, as its config declares it (`i18n` in
 * `absolute.config.ts`), kept where anything in the server can read it
 * without importing the config.
 *
 * The same settings are also the first half of what `defineI18n` is
 * given in app code, and must be: its types come from the locales
 * written in that call, which a config read at run time cannot supply.
 * So the two are declared from one object — `defineI18nRouting` makes
 * it — and what is kept here is used to notice when they are not
 * (plugins/i18n.ts). */

const ROUTING = Symbol.for('absolutejs.i18nRouting');

const isRouting = (value: unknown): value is I18nRoutingConfig =>
	typeof value === 'object' &&
	value !== null &&
	'locales' in value &&
	Array.isArray(value.locales);

/** The config's `i18n`, or nothing when it has none. */
export const currentI18nRouting = () => {
	const routing: unknown = Reflect.get(globalThis, ROUTING);

	return isRouting(routing) ? routing : undefined;
};

/** Locale routing, declared once for the config and for `defineI18n`:
 *
 *    export const routing = defineI18nRouting({
 *    	locales: ['en', 'fr'],
 *    	defaultLocale: 'en'
 *    });
 *
 *    // absolute.config.ts
 *    export default defineConfig({ i18n: routing });
 *    // src/i18n.ts
 *    export const i18n = defineI18n({ ...routing, messages, loaders });
 *
 *  Returns what it is given, with the locales kept as the literals
 *  they were written as. */
export const defineI18nRouting = <
	const Locale extends string,
	const Default extends Locale
>(
	routing: Omit<I18nRoutingConfig<Locale>, 'defaultLocale'> & {
		defaultLocale: Default;
	}
) => routing;

/* Two declarations are the same when they route the same way, however
 * they spell a default. */
const normalized = (routing: I18nRoutingConfig) =>
	JSON.stringify({
		defaultLocale: routing.defaultLocale,
		domains: Object.entries(routing.domains ?? {}).sort(([left], [right]) =>
			left.localeCompare(right)
		),
		localeParam: routing.localeParam ?? 'locale',
		locales: [...routing.locales],
		pathnames: Object.entries(routing.pathnames ?? {})
			.map(([path, byLocale]) => [
				path,
				Object.entries(byLocale).sort(([left], [right]) =>
					left.localeCompare(right)
				)
			])
			.sort(([left], [right]) =>
				String(left).localeCompare(String(right))
			),
		prefixDefault: routing.prefixDefault ?? false,
		strategy: routing.strategy ?? 'prefix'
	});

/** What differs between two declarations of the routing, as the names
 *  of the settings. Empty when they agree. */
export const i18nRoutingDifferences = (
	left: I18nRoutingConfig,
	right: I18nRoutingConfig
) => {
	const settings = [
		'locales',
		'defaultLocale',
		'strategy',
		'prefixDefault',
		'domains',
		'localeParam',
		'pathnames'
	] as const;
	const only = (
		routing: I18nRoutingConfig,
		name: (typeof settings)[number]
	) =>
		normalized({
			defaultLocale: '',
			locales: [],
			[name]: routing[name]
		});

	return settings.filter((name) => only(left, name) !== only(right, name));
};

export const setI18nRouting = (routing: I18nRoutingConfig | undefined) => {
	Reflect.set(globalThis, ROUTING, routing);
};
