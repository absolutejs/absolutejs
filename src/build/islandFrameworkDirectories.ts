/* An island registry can name a component of any framework, but the build
 * only compiles that framework's island sources when the framework's own
 * PAGES directory is configured (`shouldCompileIslandSvelte` and friends
 * in src/core/build.ts). Without it, `islandEntries` has no compiled
 * client path to point the island entry at, and falls back to emitting
 * the registry definition — whose `component` is null, because the real
 * component was never bundled.
 *
 * The result was a successful build and an island that could never
 * hydrate: the element kept its server markup, and until the island
 * runtime learned to report an unresolved component there was no
 * diagnostic anywhere. A green build producing a dead feature is the
 * worst of the available outcomes, so this fails the build instead and
 * says which directory to configure.
 *
 * Making it WORK — compiling a framework's island sources with no pages
 * directory — is the better answer and is not what this does. It needs a
 * compile root for sources that live outside any framework directory,
 * plus that framework's vendor bundle, which is itself gated on the same
 * directory; an island compiled without a vendor emits bare framework
 * specifiers and trips `verifyBrowserImportsVendored`. Specified as a
 * follow-up rather than half-built here. */

/* What is checked is the config KEY, not where the island's files live.
 * Island components usually sit beside the registry rather than in a
 * framework's pages directory — `typecheck-islands-outside-framework-dirs`
 * covers exactly that — and this is fine: the directory only has to be
 * configured, so the framework's compile and vendor passes run. */

/** The config key that must be set for each framework's islands to
 *  compile. */
const DIRECTORY_KEYS: Record<string, string> = {
	angular: 'angularDirectory',
	react: 'reactDirectory',
	svelte: 'svelteDirectory',
	vue: 'vueDirectory'
};

export type IslandFrameworkDirectoryProblem = {
	configKey: string;
	framework: string;
	sources: readonly string[];
};

type DirectoryCheckInput = {
	/** Island sources per framework, as discovered from the registry. */
	sources: Readonly<Record<string, readonly string[]>>;
	/** Whether each framework's pages directory is configured. */
	configured: Readonly<Record<string, boolean>>;
};

/** Frameworks with island sources but no configured directory. Empty when
 *  every island can be compiled. */
export const findIslandFrameworkDirectoryProblems = ({
	configured,
	sources
}: DirectoryCheckInput) => {
	const problems: IslandFrameworkDirectoryProblem[] = [];
	for (const [framework, configKey] of Object.entries(DIRECTORY_KEYS)) {
		const frameworkSources = sources[framework] ?? [];
		if (frameworkSources.length === 0 || configured[framework] === true)
			continue;
		problems.push({ configKey, framework, sources: frameworkSources });
	}

	return problems;
};

/** The build error for `problems`, naming each framework, the components
 *  that cannot compile and the key to set. */
export const islandFrameworkDirectoryMessage = (
	problems: readonly IslandFrameworkDirectoryProblem[]
) =>
	[
		'Island components cannot be compiled, so they would ship with no component and never hydrate:',
		...problems.map(
			({ configKey, framework, sources }) =>
				`  • ${framework}: ${sources.join(', ')}\n    Set \`${configKey}\` in absolute.config.ts so the build compiles ${framework} island sources.`
		),
		"An island registry may name a component of any framework, but that framework's directory has to be configured for its islands to build."
	].join('\n');
