import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BunPlugin } from 'bun';
import { isPackageInstalled } from './missingClientFrameworks';

/* `react-router` is an optional peer. The `@absolutejs/absolute/react/router`
 * entry exports `<UniversalRouter>`, which is built on react-router, next to
 * `<Link>`, which isn't. A bundler resolves every static import of an entry
 * before tree shaking, and the Bun runtime links them all on import, so
 * importing only `<Link>` from that entry still needs react-router. Without
 * it the build failed with a bare `Could not resolve: "react-router"`.
 *
 * Stubbing react-router would get the bundle through, but not a dev server
 * or `absolute start` that loads the package at runtime, so the build fails
 * here instead, with a message that says why react-router is needed and
 * where to get the react-router-free `<Link>`: `react/components` exports
 * the same component, and with `enableNavigation()` its clicks become soft
 * page navigations. */

const PACKAGE_NAME = '@absolutejs/absolute';
const REACT_ROUTER_SPECIFIER = /^react-router(?:\/.*)?$/;

const readPackageName = (manifestPath: string) => {
	try {
		const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf-8'));
		if (typeof parsed !== 'object' || parsed === null) return undefined;
		const name: unknown = Reflect.get(parsed, 'name');

		return typeof name === 'string' ? name : undefined;
	} catch {
		return undefined;
	}
};

/** Name of the nearest package.json above `filePath` that declares one. */
const owningPackageName = (filePath: string) => {
	let dir = dirname(filePath);
	while (true) {
		const manifestPath = join(dir, 'package.json');
		if (existsSync(manifestPath)) {
			const name = readPackageName(manifestPath);
			if (name !== undefined) return name;
		}
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
};

const toRealPath = (path: string) => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

const isAbsolutePackageFile = (filePath: string) =>
	filePath.length > 0 &&
	owningPackageName(toRealPath(filePath)) === PACKAGE_NAME;

const LINK_WITHOUT_REACT_ROUTER =
	"For links between pages without client-side routing, import { Link } from '@absolutejs/absolute/react/components' instead: " +
	'it is the same <Link>, has no react-router dependency, and enableNavigation() turns its clicks into soft page navigations.';

/** Build error for a `react-router` import when the package isn't installed.
 *  `fromAbsolute`: the import is the package's own (`react/router`). */
export const missingReactRouterMessage = (
	specifier: string,
	importer: string,
	fromAbsolute: boolean
) =>
	fromAbsolute
		? `[absolutejs] "@absolutejs/absolute/react/router" needs the optional peer dependency "react-router", which is not installed. ` +
			'That entry exports <UniversalRouter>, which is built on react-router, so importing anything from it (even just <Link>) requires the package. ' +
			`Install it (bun add react-router) to use <UniversalRouter>. ${LINK_WITHOUT_REACT_ROUTER}`
		: `[absolutejs] Could not resolve "${specifier}" imported by ${importer}: react-router is not installed. ` +
			`Install it (bun add react-router) to use it. ${LINK_WITHOUT_REACT_ROUTER}`;

export const isReactRouterMissing = (projectRoot: string) =>
	!isPackageInstalled('react-router', projectRoot);

/** Fails the build with `missingReactRouterMessage` on any `react-router`
 *  import; null when react-router is installed (nothing to do). */
export const createMissingReactRouterPlugin = (
	projectRoot: string,
	isMissing: (projectRoot: string) => boolean = isReactRouterMissing
): BunPlugin | null => {
	if (!isMissing(projectRoot)) return null;

	return {
		name: 'absolute-missing-react-router',
		setup(build) {
			build.onResolve({ filter: REACT_ROUTER_SPECIFIER }, (args) => {
				// Only static imports: Bun already leaves an unresolvable
				// dynamic import (or a guarded require) for the runtime to
				// handle, and a library may probe for react-router that way.
				if (args.kind !== 'import-statement') return undefined;
				throw new Error(
					missingReactRouterMessage(
						args.path,
						args.importer || 'an entry point',
						isAbsolutePackageFile(args.importer)
					)
				);
			});
		}
	};
};
