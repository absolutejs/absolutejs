/* BUN-REACT-REFRESH-LEGACY: this whole module exists only because stock Bun
 * ignores `reactFastRefresh` on `new Bun.Transpiler()` (oven-sh/bun#32919), so
 * React edits in `absolute dev` reload the page instead of refreshing in place.
 * AbsoluteJS publishes Bun with just that fix (github.com/absolutejs/patched-bun)
 * and this module offers it and selects it for the dev server. Installing it is
 * bvm's job (github.com/absolutejs/bvm, a dependency): bvm checks the release's
 * signature by the AbsoluteJS release key before anything runs. When a Bun
 * release ships the fix: delete this file, the `bun-patch` command in
 * index.ts, the runtime selection in scripts/dev.ts, and every other block
 * marked BUN-REACT-REFRESH-LEGACY (docs/REACT_TRANSPILER_BUG.md lists them). */
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline/promises';

/** The patched build `absolute dev` uses: Bun 1.4.2 + the reactFastRefresh
 *  backport, as bvm names it. */
export const PATCHED_BUN_RELEASE = {
	bunVersion: '1.4.2',
	issue: 'https://github.com/oven-sh/bun/issues/32919',
	repo: 'absolutejs/patched-bun',
	version: '1.4.2-absolute.1'
} as const;

type Choice = 'install' | 'later' | 'never';
type Preference =
	| { askAfter: string; decision: 'later' }
	| { decision: 'never' };
type OfferContext = {
	bunVersion: string;
	bvm: boolean;
	ci: boolean;
	installed: boolean;
	interactive: boolean;
	now: Date;
	preference: Preference | null;
	supported: boolean;
	usesReact: boolean;
};

const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3_600_000;
/** "Ask me later" waits this long before asking again. */
const ASK_LATER_MS = HOURS_PER_DAY * MS_PER_HOUR;
const PREFERENCE_FILE = 'patched-bun.json';
const VERSION_PARTS = 3;
const PROBE_TIMEOUT_MS = 30_000;
const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies'
];

const absoluteHome = (home: string) => join(home, '.absolutejs');
/** Where releases before bvm installed the patched build. */
const legacyInstallDirectory = (home: string) =>
	join(absoluteHome(home), 'bun');

const compareVersions = (left: string, right: string) => {
	const parse = (version: string) =>
		version.split('-')[0]?.split('.').map(Number) ?? [];
	const leftParts = parse(left);
	const rightParts = parse(right);
	const differences = Array.from(
		{ length: VERSION_PARTS },
		(_, index) => (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
	);

	return differences.find((difference) => difference !== 0) ?? 0;
};

const preferencePath = (home: string) =>
	join(absoluteHome(home), PREFERENCE_FILE);

/** The npm package holding bvm's binary for a platform, as
 *  @absolutejs/bvm's launcher names it; null where bvm has no build. */
export const bvmPlatformPackage = (
	platform: string = process.platform,
	arch: string = process.arch
) => {
	const system = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[
		platform
	];
	const cpu = { arm64: 'arm64', x64: 'x64' }[arch];
	if (!system || !cpu) return null;

	return `@absolutejs/bvm-${system}-${cpu}`;
};

export const bvmRunner =
	(bvm: string) =>
	(args: string[], inherit = false) => {
		const result = spawnSync(bvm, args, {
			encoding: 'utf-8',
			stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
		});

		return { status: result.status, stdout: result.stdout ?? '' };
	};

/** Runs bvm; `inherit` streams its progress to the terminal. */
export type BvmRunner = ReturnType<typeof bvmRunner>;

/** The bvm binary npm installed with AbsoluteJS. The platform package is
 *  @absolutejs/bvm's dependency, not ours: resolve it from there, so isolated
 *  installs find it too. */
const bundledBvm = (pkg: string) => {
	try {
		const launcher = dirname(
			Bun.resolveSync('@absolutejs/bvm/package.json', import.meta.dir)
		);
		const binary = join(
			dirname(Bun.resolveSync(`${pkg}/package.json`, launcher)),
			'bin',
			process.platform === 'win32' ? 'bvm.exe' : 'bvm'
		);

		return existsSync(binary) ? binary : null;
	} catch {
		// Not installed (optional dependencies skipped).
		return null;
	}
};

/** bvm's binary: the one npm installed with AbsoluteJS, else `bvm` on PATH. */
export const findBvm = () => {
	const pkg = bvmPlatformPackage();

	return (pkg ? bundledBvm(pkg) : null) ?? Bun.which('bvm');
};

const defaultRunner = () => {
	const bvm = findBvm();

	return bvm ? bvmRunner(bvm) : null;
};

/** The installed patched build's path, from bvm; null when not installed. */
export const installedPatchedBun = (
	run: BvmRunner | null = defaultRunner()
) => {
	if (!run) return null;
	const result = run(['which', PATCHED_BUN_RELEASE.version]);
	const path = result.stdout.trim();

	return result.status === 0 && path ? path : null;
};

export const runtimeSupportsReactFastRefresh = () => {
	// The option is not in Bun's published typings; widened as moduleServer.ts does.
	const options: ConstructorParameters<typeof Bun.Transpiler>[0] & {
		reactFastRefresh?: boolean;
	} = { loader: 'tsx', reactFastRefresh: true };
	try {
		return new Bun.Transpiler(options)
			.transformSync('export function Probe(){return null;}')
			.includes('$RefreshReg$');
	} catch {
		return false;
	}
};

const parsePreference = (parsed: unknown) => {
	if (typeof parsed !== 'object' || parsed === null) return null;
	if (!('decision' in parsed)) return null;
	if (parsed.decision === 'never') {
		const never: Preference = { decision: 'never' };

		return never;
	}
	if (
		parsed.decision !== 'later' ||
		!('askAfter' in parsed) ||
		typeof parsed.askAfter !== 'string'
	)
		return null;
	const later: Preference = { askAfter: parsed.askAfter, decision: 'later' };

	return later;
};

/** Whether `absolute dev` should offer the patched build, and if not, why. */
export const patchedBunOfferState = (context: OfferContext) => {
	if (context.supported) return 'runtime-supports-refresh';
	if (context.installed) return 'installed';
	if (!context.usesReact) return 'not-a-react-project';
	if (!context.bvm) return 'unsupported-platform';
	// Never trade a newer Bun for an older one behind the user's back.
	if (compareVersions(context.bunVersion, PATCHED_BUN_RELEASE.bunVersion) > 0)
		return 'runtime-newer';
	if (context.preference?.decision === 'never') return 'declined';
	if (
		context.preference?.decision === 'later' &&
		new Date(context.preference.askAfter) > context.now
	)
		return 'asked-recently';
	if (context.ci || !context.interactive) return 'non-interactive';

	return 'offer';
};

export const readPatchedBunPreference = (home = homedir()) => {
	try {
		return parsePreference(
			JSON.parse(readFileSync(preferencePath(home), 'utf-8'))
		);
	} catch {
		return null;
	}
};

export const writePatchedBunPreference = (
	preference: Preference | null,
	home = homedir()
) => {
	const path = preferencePath(home);
	if (preference === null) {
		rmSync(path, { force: true });

		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(preference, null, '\t')}\n`);
};

const projectUsesReact = (projectDir: string) => {
	const hasReact = (deps: unknown) =>
		typeof deps === 'object' &&
		deps !== null &&
		Object.hasOwn(deps, 'react');
	try {
		const manifest: unknown = JSON.parse(
			readFileSync(join(projectDir, 'package.json'), 'utf-8')
		);
		if (typeof manifest !== 'object' || manifest === null) return false;

		return DEPENDENCY_FIELDS.some((field) =>
			hasReact(Reflect.get(manifest, field))
		);
	} catch {
		return false;
	}
};

export const PATCHED_BUN_EXPLANATION = [
	'React edits reload the page and lose component state on this Bun.',
	`Stock Bun ignores \`reactFastRefresh\` on Bun.Transpiler (${PATCHED_BUN_RELEASE.issue}),`,
	'so React Fast Refresh cannot keep state across edits. Until Bun ships the fix,',
	`AbsoluteJS publishes Bun ${PATCHED_BUN_RELEASE.bunVersion} with only that fix: https://github.com/${PATCHED_BUN_RELEASE.repo}`,
	'bvm installs it after checking its signature; only `absolute dev` uses it, your `bun` is unchanged.'
];

/** Installs the patched build with bvm (which verifies the release's
 *  signature and checksum) and returns its path. */
export const installPatchedBun = (run: BvmRunner | null = defaultRunner()) => {
	if (!run)
		throw new Error(
			`bvm is not available for ${process.platform}-${process.arch}; see https://github.com/absolutejs/bvm`
		);
	const install = run(['install', PATCHED_BUN_RELEASE.version], true);
	if (install.status !== 0)
		throw new Error(
			`bvm could not install Bun ${PATCHED_BUN_RELEASE.version}`
		);
	const path = installedPatchedBun(run);
	if (!path)
		throw new Error(
			`bvm installed Bun ${PATCHED_BUN_RELEASE.version} but cannot find it`
		);

	return path;
};

export const parsePatchedBunChoice = (answer: string) => {
	const normalized = answer.trim().toLowerCase();
	const choices: Array<{ choice: Choice; matches: boolean }> = [
		{
			choice: 'install',
			matches:
				normalized === '' ||
				normalized === '1' ||
				normalized.startsWith('i')
		},
		{
			choice: 'later',
			matches: normalized === '2' || normalized.startsWith('l')
		},
		{
			choice: 'never',
			matches:
				normalized === '3' ||
				normalized.startsWith('d') ||
				normalized.startsWith('n')
		}
	];

	return choices.find(({ matches }) => matches)?.choice ?? null;
};

/** Checks an installed binary really is the patched build. */
export const verifyPatchedBun = (path: string) => {
	const probe = spawnSync(
		path,
		[
			'-e',
			'console.log(Bun.version, new Bun.Transpiler({loader:"tsx",reactFastRefresh:true}).transformSync("export function P(){return null}").includes("$RefreshReg$"))'
		],
		{ encoding: 'utf-8', timeout: PROBE_TIMEOUT_MS }
	);

	return (
		probe.status === 0 &&
		probe.stdout.trim() === `${PATCHED_BUN_RELEASE.bunVersion} true`
	);
};

const askUntilAnswered = async (prompt: Interface): Promise<Choice> => {
	const choice = parsePatchedBunChoice(
		await prompt.question('Choose [1-3] (default 1): ')
	);

	return choice ?? askUntilAnswered(prompt);
};

const askForChoice = async () => {
	const prompt = createInterface({
		input: process.stdin,
		output: process.stdout
	});
	try {
		console.log(`\n${PATCHED_BUN_EXPLANATION.join('\n')}\n`);
		console.log(
			"  1) Install now\n  2) Ask me later\n  3) Don't ask again\n"
		);

		return await askUntilAnswered(prompt);
	} finally {
		prompt.close();
	}
};

/** Installs with bvm, probes the result, and clears the prompt state and any
 *  copy an earlier release kept in ~/.absolutejs/bun. */
export const installVerifiedPatchedBun = (
	home: string,
	run: BvmRunner | null,
	verify: (path: string) => boolean = verifyPatchedBun
) => {
	const path = installPatchedBun(run);
	if (!verify(path)) {
		run?.(['uninstall', PATCHED_BUN_RELEASE.version]);
		throw new Error(
			'the installed binary did not pass its check; removed it'
		);
	}
	writePatchedBunPreference(null, home);
	rmSync(legacyInstallDirectory(home), { force: true, recursive: true });

	return path;
};

const recordDecline = (choice: 'later' | 'never', home: string) => {
	if (choice === 'never') {
		writePatchedBunPreference({ decision: 'never' }, home);
		console.log(
			'OK, not asking again. `absolute bun-patch install` installs it any time; `absolute bun-patch reset` asks again.'
		);

		return;
	}
	writePatchedBunPreference(
		{
			askAfter: new Date(Date.now() + ASK_LATER_MS).toISOString(),
			decision: 'later'
		},
		home
	);
	console.log(
		'OK, asking again tomorrow. `absolute bun-patch install` installs it any time.'
	);
};

const describeError = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** Releases before bvm kept the patched build in ~/.absolutejs/bun. Whoever
 *  has one there already chose to install it: move them onto bvm's copy. */
export const migrateLegacyPatchedBun = (
	home: string,
	run: BvmRunner | null,
	verify: (path: string) => boolean = verifyPatchedBun
) => {
	if (!run || !existsSync(legacyInstallDirectory(home))) return null;
	console.log(
		`Moving AbsoluteJS's patched Bun to bvm (Bun ${PATCHED_BUN_RELEASE.version}).`
	);
	try {
		return installVerifiedPatchedBun(home, run, verify);
	} catch (error) {
		console.error(
			`Could not move the patched Bun to bvm (${describeError(error)}). Run \`absolute bun-patch install\` to retry.`
		);

		return null;
	}
};

/**
 * The Bun executable `absolute dev` runs its server with: the patched build
 * bvm installed, when there is one, otherwise `bun` from PATH after offering
 * the patched build once (Install now / Ask me later / Don't ask again).
 * Set ABSOLUTE_PATCHED_BUN=0 to always use PATH's bun.
 */
export const resolveDevBunExecutable = async (
	projectDir = process.cwd(),
	home = homedir()
) => {
	if (process.env.ABSOLUTE_PATCHED_BUN === '0') return 'bun';
	const run = defaultRunner();
	const installed =
		installedPatchedBun(run) ?? migrateLegacyPatchedBun(home, run);
	if (installed) {
		console.log(
			`Using AbsoluteJS patched Bun ${PATCHED_BUN_RELEASE.version} for React Fast Refresh (${installed}).`
		);

		return installed;
	}
	const state = patchedBunOfferState({
		bunVersion: Bun.version,
		bvm: run !== null,
		ci: Boolean(process.env.CI),
		installed: false,
		interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
		now: new Date(),
		preference: readPatchedBunPreference(home),
		supported: runtimeSupportsReactFastRefresh(),
		usesReact: projectUsesReact(projectDir)
	});
	if (state === 'non-interactive')
		console.log(
			`React edits will reload the page: stock Bun lacks the reactFastRefresh fix (${PATCHED_BUN_RELEASE.issue}). Run \`absolute bun-patch install\` to use AbsoluteJS's patched Bun.`
		);
	if (state !== 'offer') return 'bun';
	const choice = await askForChoice();
	if (choice !== 'install') {
		recordDecline(choice, home);

		return 'bun';
	}
	try {
		return installVerifiedPatchedBun(home, run);
	} catch (error) {
		console.error(
			`Could not install the patched Bun (${describeError(error)}). Continuing with your bun; React edits will reload the page.`
		);

		return 'bun';
	}
};

const describePreference = (preference: Preference | null) => {
	if (preference === null) return 'will ask';
	if (preference.decision === 'never') return "won't ask again";

	return `asking again after ${preference.askAfter}`;
};

const describeInstalled = (installed: string | null) => {
	if (!installed) return 'no';
	if (verifyPatchedBun(installed)) return installed;

	return `${installed} (FAILED its check; run \`absolute bun-patch install\`)`;
};

const printStatus = (home: string) => {
	const supported = runtimeSupportsReactFastRefresh();
	const bvm = findBvm();
	console.log(
		`Release: ${PATCHED_BUN_RELEASE.version} (${PATCHED_BUN_RELEASE.issue})`
	);
	console.log(`bvm: ${bvm ?? 'not available for this platform'}`);
	console.log(
		`Your bun: ${Bun.version} (${supported ? 'already has the fix' : 'stock, no fix'})`
	);
	console.log(
		`Installed: ${describeInstalled(installedPatchedBun(bvm ? bvmRunner(bvm) : null))}`
	);
	console.log(
		`Prompt: ${describePreference(readPatchedBunPreference(home))}`
	);
};

/** `absolute bun-patch [status|install|remove|reset]` */
export const bunPatch = (args: string[], home = homedir()) => {
	const [action = 'status'] = args;
	if (action === 'status') {
		printStatus(home);

		return;
	}
	if (action === 'install') {
		installVerifiedPatchedBun(home, defaultRunner());
		console.log('`absolute dev` will use it from now on.');

		return;
	}
	if (action === 'remove') {
		defaultRunner()?.(['uninstall', PATCHED_BUN_RELEASE.version], true);
		rmSync(legacyInstallDirectory(home), { force: true, recursive: true });
		console.log(
			'Removed the patched Bun. `absolute dev` uses your bun again.'
		);

		return;
	}
	if (action === 'reset') {
		writePatchedBunPreference(null, home);
		console.log('`absolute dev` will offer the patched Bun again.');

		return;
	}
	throw new Error(
		`Unknown bun-patch action "${action}". Use status, install, remove or reset.`
	);
};
