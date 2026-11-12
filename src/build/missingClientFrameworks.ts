import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BunPlugin } from 'bun';
import type { BuildConfig } from '../../types/build';

/* Frameworks a project neither configures nor installs, as seen by its
 * BROWSER bundles.
 *
 * Any client entry can import `@absolutejs/absolute/client` (the Svelte
 * hydration index does, for browser-translation support). Its island
 * runtime lazily imports one hydrator per framework, and each hydrator
 * imports that framework's runtime, so the bundler walks into `vue`,
 * `@angular/core`, `react-dom/client`, … and fails with "Could not resolve"
 * when the framework isn't installed.
 *
 * Marking those specifiers external fixes the build only when code
 * splitting keeps each hydrator in its own lazy chunk. Without splitting
 * (dev island and worker bundles), Bun inlines the hydrators and hoists
 * their imports to the top of the bundle, so the browser fails to load the
 * whole module on a bare `"svelte"`. The missing runtime is instead
 * resolved to a stub that throws when it is evaluated, which only happens
 * inside the lazy import of that framework's hydrator. A page without that
 * framework's islands never evaluates it; one with them gets the island
 * runtime's per-island error naming the missing package. */

export type ClientFramework = 'angular' | 'react' | 'svelte' | 'vue';

/** The package whose presence means the framework is installed, and every
 *  package the shipped browser code may import for it. */
type FrameworkPackages = { packages: readonly string[]; probe: string };

const CLIENT_FRAMEWORK_PACKAGES: Record<ClientFramework, FrameworkPackages> = {
	angular: { packages: ['@angular/*'], probe: '@angular/core' },
	react: { packages: ['react', 'react-dom'], probe: 'react' },
	svelte: { packages: ['svelte'], probe: 'svelte' },
	vue: { packages: ['vue', 'vue-demi', '@vue/*'], probe: 'vue' }
};

const CLIENT_FRAMEWORKS: readonly ClientFramework[] = [
	'angular',
	'react',
	'svelte',
	'vue'
];

/** True when `packageName` has a `node_modules/<name>/package.json` in
 *  `projectRoot` or any ancestor, which is how Bun's resolver finds it. A
 *  file check, not `Bun.resolveSync`, because not every package exports its
 *  main entry or `package.json` under the default conditions. */
export const isPackageInstalled = (
	packageName: string,
	projectRoot: string
) => {
	let dir = projectRoot;
	while (true) {
		if (existsSync(join(dir, 'node_modules', packageName, 'package.json')))
			return true;
		const parent = dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
};

export type MissingClientFrameworksOptions = {
	/** Frameworks the project configures a directory for. Their runtimes
	 *  must resolve, so they never count as missing. */
	configured: Partial<Record<ClientFramework, unknown>>;
	projectRoot: string;
	/** Injectable for tests; defaults to a `node_modules` lookup. */
	isInstalled?: (packageName: string, projectRoot: string) => boolean;
};

/** Frameworks that are neither configured nor installed. An installed but
 *  unconfigured framework isn't missing: the bundler can resolve it, and
 *  user code may import it directly. */
export const resolveMissingClientFrameworks = ({
	configured,
	isInstalled = isPackageInstalled,
	projectRoot
}: MissingClientFrameworksOptions) =>
	CLIENT_FRAMEWORKS.filter(
		(framework) =>
			!configured[framework] &&
			!isInstalled(
				CLIENT_FRAMEWORK_PACKAGES[framework].probe,
				projectRoot
			)
	);

/** `resolveMissingClientFrameworks` for a build config: a framework counts
 *  as configured when its directory is set. */
export const resolveMissingClientFrameworksForConfig = (
	config: Pick<
		BuildConfig,
		| 'angularDirectory'
		| 'reactDirectory'
		| 'svelteDirectory'
		| 'vueDirectory'
	>,
	projectRoot: string
) =>
	resolveMissingClientFrameworks({
		configured: {
			angular: config.angularDirectory,
			react: config.reactDirectory,
			svelte: config.svelteDirectory,
			vue: config.vueDirectory
		},
		projectRoot
	});

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `react` → matches `react` and `react/*`; `@vue/*` → every `@vue/` package. */
const packagePattern = (pattern: string) =>
	pattern.endsWith('/*')
		? `${escapeRegExp(pattern.slice(0, -1))}.+`
		: `${escapeRegExp(pattern)}(?:/.*)?`;

/** Bare specifiers belonging to `frameworks`, as one anchored pattern. */
export const missingFrameworkSpecifierPattern = (
	frameworks: readonly ClientFramework[]
) => {
	const alternatives = frameworks.flatMap((framework) =>
		CLIENT_FRAMEWORK_PACKAGES[framework].packages.map(packagePattern)
	);

	return alternatives.length > 0
		? new RegExp(`^(?:${alternatives.join('|')})$`)
		: null;
};

const frameworkOf = (specifier: string) =>
	CLIENT_FRAMEWORKS.find((framework) => {
		const pattern = missingFrameworkSpecifierPattern([framework]);

		return pattern?.test(specifier) ?? false;
	}) ?? 'framework';

const STUB_NAMESPACE = 'absolute-missing-client-framework';

/** The stub's source: CommonJS (so any named import binds at build time),
 *  throwing on evaluation with the package and framework it stands in for. */
export const createMissingClientFrameworkPlugin = (
	frameworks: readonly ClientFramework[]
): BunPlugin | null => {
	const filter = missingFrameworkSpecifierPattern(frameworks);
	if (!filter) return null;

	return {
		name: 'absolute-missing-client-frameworks',
		setup(build) {
			build.onResolve({ filter }, (args) => ({
				namespace: STUB_NAMESPACE,
				path: args.path
			}));
			build.onLoad(
				{ filter: /.*/, namespace: STUB_NAMESPACE },
				(args) => ({
					contents: missingFrameworkStubSource(args.path),
					loader: 'js'
				})
			);
		}
	};
};
export const missingFrameworkStubSource = (specifier: string) =>
	`throw new Error(${JSON.stringify(
		`[absolutejs] "${specifier}" is not installed, so this ${frameworkOf(specifier)} island can't hydrate. Install it, or remove the island.`
	)});\nmodule.exports = {};\n`;
