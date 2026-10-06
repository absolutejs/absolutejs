/* BUN-REACT-REFRESH-LEGACY: this whole module exists only because stock Bun
 * ignores `reactFastRefresh` on `new Bun.Transpiler()` (oven-sh/bun#32919), so
 * React edits in `absolute dev` reload the page instead of refreshing in place.
 * AbsoluteJS publishes Bun with just that fix (github.com/absolutejs/patched-bun)
 * and this module offers, installs and selects it for the dev server. When a
 * Bun release ships the fix: delete this file, the `bun-patch` command in
 * index.ts, the runtime selection in scripts/dev.ts, and every other block
 * marked BUN-REACT-REFRESH-LEGACY (docs/REACT_TRANSPILER_BUG.md lists them). */
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline/promises';
import { inflateRawSync } from 'node:zlib';

/** The published build: Bun 1.4.0 + the reactFastRefresh backport. The
 *  checksums are the release's SHASUMS256.txt, pinned so a download that
 *  differs by one byte is refused. */
export const PATCHED_BUN_RELEASE = {
	bunVersion: '1.4.2',
	issue: 'https://github.com/oven-sh/bun/issues/32919',
	repo: 'absolutejs/patched-bun',
	sha256: {
		'bun-darwin-aarch64':
			'75f45c72eac0c01e579f81ec48c8530bbec72406604c09abdd1fe6947ec4ac05',
		'bun-darwin-x64':
			'0ad06bff1c847de7a592ecac2e92060dfc8f56361fe92ca52ece8a685cbf416d',
		'bun-freebsd-aarch64':
			'bbc981e3d890b65e042fbf15128d8499acf11bf29d82b1a15efc07a8d02c424d',
		'bun-freebsd-x64':
			'344e1cc9b01541ee16b93be9a946d33f9766e235aa95af758e3b7bd9ebccb354',
		'bun-linux-aarch64':
			'7ad50219c85899ba5d5ffb6728cb128a08f106d99857be7f505ec6b520a2315c',
		'bun-linux-aarch64-android':
			'699c6eb9a1ffcb6787811729ca8f4812e2f4d8969ac3c0bc6b4cfc8265bfd65c',
		'bun-linux-aarch64-musl':
			'70089d21421103d03f9bf657bba48beefb22d58b16dd974cd552ea28d1f7c087',
		'bun-linux-x64':
			'efc724f5c613ae4ae9bb884c067ac8a2b935b959a60082f204b08b4736b531e9',
		'bun-linux-x64-android':
			'e68a9486017e8a2fa02d0144807e2b48b10db3a09be05ad05b66e3bbf5197610',
		'bun-linux-x64-musl':
			'86afabbaacca2a652f9eb4821c5163935eac42ee4c966db323c066b95737fdaa',
		'bun-windows-aarch64':
			'88157fccfac80028c45609d969da819f7ba6d9dafc3c887793188b56d4bf518c',
		'bun-windows-x64':
			'6dbf24593722d1c94e9c54fafd2087a3e8966aa954f753a565e52522162634c8'
	},
	tag: 'bun-v1.4.2-absolute.1'
} as const;

export type PatchedBunAsset = keyof typeof PATCHED_BUN_RELEASE.sha256;
type Libc = 'android' | 'glibc' | 'musl';
type Choice = 'install' | 'later' | 'never';
type Preference =
	| { askAfter: string; decision: 'later' }
	| { decision: 'never' };
type OfferContext = {
	asset: PatchedBunAsset | null;
	bunVersion: string;
	ci: boolean;
	installed: boolean;
	interactive: boolean;
	now: Date;
	preference: Preference | null;
	supported: boolean;
	usesReact: boolean;
};
type ZipEntry = { compressedSize: number; localOffset: number; method: number };
type InstallOptions = {
	asset?: PatchedBunAsset | null;
	/** The expected SHA-256 per asset; the pinned release unless a test swaps it. */
	checksums?: Readonly<Record<PatchedBunAsset, string>>;
	fetchImpl?: typeof fetch;
	home?: string;
	log?: (line: string) => void;
};

const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3_600_000;
/** "Ask me later" waits this long before asking again. */
const ASK_LATER_MS = HOURS_PER_DAY * MS_PER_HOUR;
const PREFERENCE_FILE = 'patched-bun.json';
const EXECUTABLE_MODE = 0o755;
const VERSION_PARTS = 3;
const PROBE_TIMEOUT_MS = 30_000;
const MUSL_LOADERS = ['/lib/ld-musl-x86_64.so.1', '/lib/ld-musl-aarch64.so.1'];
const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies'
];

/* Zip layout (APPNOTE.TXT): record signatures, and the offsets of the fields
 * read from the end-of-directory record, directory entries and local headers. */
const ZIP = {
	directoryEntry: 0x02014b50,
	endDirectoryOffset: 16,
	endEntryCount: 10,
	endOfDirectory: 0x06054b50,
	endRecordSize: 22,
	entryCommentLength: 32,
	entryCompressedSize: 20,
	entryExtraLength: 30,
	entryHeaderSize: 46,
	entryLocalOffset: 42,
	entryMethod: 10,
	entryNameLength: 28,
	localExtraLength: 28,
	localHeader: 0x04034b50,
	localHeaderSize: 30,
	localNameLength: 26,
	methodDeflate: 8,
	methodStored: 0
} as const;

const isAsset = (name: string): name is PatchedBunAsset =>
	Object.hasOwn(PATCHED_BUN_RELEASE.sha256, name);

const detectLibc = () => {
	if (process.platform === 'android') return 'android';
	if (MUSL_LOADERS.some((loader) => existsSync(loader))) return 'musl';

	return 'glibc';
};

const absoluteHome = (home: string) => join(home, '.absolutejs');

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

/** The release zip for a platform, named the way Bun names its own. */
export const installedPatchedBun = (home = homedir()) => {
	const asset = patchedBunAsset();
	if (!asset) return null;
	const path = patchedBunPath(asset, home);

	return existsSync(path) ? path : null;
};
export const patchedBunAsset = (
	platform: string = process.platform,
	arch: string = process.arch,
	libc: Libc = detectLibc()
) => {
	const cpu = { arm64: 'aarch64', x64: 'x64' }[arch];
	const system = {
		android: 'linux',
		darwin: 'darwin',
		freebsd: 'freebsd',
		linux: 'linux',
		win32: 'windows'
	}[platform];
	if (!cpu || !system) return null;
	const abi = system === 'linux' && libc !== 'glibc' ? `-${libc}` : '';
	const name = `bun-${system}-${cpu}${abi}`;

	return isAsset(name) ? name : null;
};
export const patchedBunPath = (asset: PatchedBunAsset, home = homedir()) =>
	join(
		absoluteHome(home),
		'bun',
		PATCHED_BUN_RELEASE.tag,
		asset,
		asset.startsWith('bun-windows') ? 'bun.exe' : 'bun'
	);
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
	if (!context.asset) return 'unsupported-platform';
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

const findEndOfDirectory = (view: DataView) => {
	for (
		let offset = view.byteLength - ZIP.endRecordSize;
		offset >= 0;
		offset--
	) {
		if (view.getUint32(offset, true) === ZIP.endOfDirectory) return offset;
	}
	throw new Error('Not a zip archive.');
};

const inflateEntry = (data: Uint8Array, method: number) => {
	if (method === ZIP.methodStored) return data;
	if (method === ZIP.methodDeflate)
		return new Uint8Array(inflateRawSync(data));
	throw new Error(`Unsupported zip compression method ${method}.`);
};

const readEntryData = (
	archive: Uint8Array,
	view: DataView,
	entry: ZipEntry
) => {
	if (view.getUint32(entry.localOffset, true) !== ZIP.localHeader)
		throw new Error('Corrupt zip entry.');
	const dataStart =
		entry.localOffset +
		ZIP.localHeaderSize +
		view.getUint16(entry.localOffset + ZIP.localNameLength, true) +
		view.getUint16(entry.localOffset + ZIP.localExtraLength, true);

	return inflateEntry(
		archive.subarray(dataStart, dataStart + entry.compressedSize),
		entry.method
	);
};

/** Reads one file out of a zip archive (stored or deflated entries). */
export const readZipEntry = (archive: Uint8Array, entryName: string) => {
	const view = new DataView(
		archive.buffer,
		archive.byteOffset,
		archive.byteLength
	);
	const end = findEndOfDirectory(view);
	const entries = view.getUint16(end + ZIP.endEntryCount, true);
	const decoder = new TextDecoder();
	let cursor = view.getUint32(end + ZIP.endDirectoryOffset, true);
	for (let index = 0; index < entries; index++) {
		if (view.getUint32(cursor, true) !== ZIP.directoryEntry)
			throw new Error('Corrupt zip directory.');
		const nameLength = view.getUint16(cursor + ZIP.entryNameLength, true);
		const nameStart = cursor + ZIP.entryHeaderSize;
		const name = decoder.decode(
			archive.subarray(nameStart, nameStart + nameLength)
		);
		const entry: ZipEntry = {
			compressedSize: view.getUint32(
				cursor + ZIP.entryCompressedSize,
				true
			),
			localOffset: view.getUint32(cursor + ZIP.entryLocalOffset, true),
			method: view.getUint16(cursor + ZIP.entryMethod, true)
		};
		if (name === entryName) return readEntryData(archive, view, entry);
		cursor +=
			ZIP.entryHeaderSize +
			nameLength +
			view.getUint16(cursor + ZIP.entryExtraLength, true) +
			view.getUint16(cursor + ZIP.entryCommentLength, true);
	}
	throw new Error(`${entryName} is not in the archive.`);
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

const sha256 = (bytes: Uint8Array) =>
	new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

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
	'It installs to ~/.absolutejs/bun and only `absolute dev` uses it; your `bun` is unchanged.'
];

/** Downloads, verifies and installs the patched build; returns its path. */
export const installPatchedBun = async (options: InstallOptions = {}) => {
	const asset = options.asset ?? patchedBunAsset();
	if (!asset)
		throw new Error(
			`No patched Bun build for ${process.platform}-${process.arch}.`
		);
	const home = options.home ?? homedir();
	const log = options.log ?? console.log;
	const url = patchedBunDownloadUrl(asset);
	log(`Downloading ${url}`);
	const response = await (options.fetchImpl ?? fetch)(url);
	if (!response.ok)
		throw new Error(`Download failed: ${url} answered ${response.status}.`);
	const archive = new Uint8Array(await response.arrayBuffer());
	const expected = (options.checksums ?? PATCHED_BUN_RELEASE.sha256)[asset];
	const actual = sha256(archive);
	if (actual !== expected)
		throw new Error(
			`${asset}.zip does not match its pinned SHA-256 (expected ${expected}, got ${actual}); not installing it.`
		);
	const target = patchedBunPath(asset, home);
	const binary = readZipEntry(
		archive,
		`${asset}/${target.endsWith('.exe') ? 'bun.exe' : 'bun'}`
	);
	mkdirSync(dirname(target), { recursive: true });
	const staging = `${target}.${process.pid}.tmp`;
	writeFileSync(staging, binary);
	chmodSync(staging, EXECUTABLE_MODE);
	renameSync(staging, target);
	log(`Installed patched Bun ${PATCHED_BUN_RELEASE.bunVersion} at ${target}`);

	return target;
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

export const patchedBunDownloadUrl = (asset: PatchedBunAsset) =>
	`https://github.com/${PATCHED_BUN_RELEASE.repo}/releases/download/${PATCHED_BUN_RELEASE.tag}/${asset}.zip`;

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

const installVerified = async (home: string) => {
	const path = await installPatchedBun({ home });
	if (!verifyPatchedBun(path)) {
		rmSync(path, { force: true });
		throw new Error(
			'the installed binary did not pass its check; removed it'
		);
	}
	writePatchedBunPreference(null, home);

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

/**
 * The Bun executable `absolute dev` runs its server with: the installed
 * patched build when there is one, otherwise `bun` from PATH after offering
 * the patched build once (Install now / Ask me later / Don't ask again).
 * Set ABSOLUTE_PATCHED_BUN=0 to always use PATH's bun.
 */
export const resolveDevBunExecutable = async (
	projectDir = process.cwd(),
	home = homedir()
) => {
	if (process.env.ABSOLUTE_PATCHED_BUN === '0') return 'bun';
	const installed = installedPatchedBun(home);
	if (installed) {
		console.log(
			`Using AbsoluteJS patched Bun ${PATCHED_BUN_RELEASE.bunVersion} for React Fast Refresh (${installed}).`
		);

		return installed;
	}
	const state = patchedBunOfferState({
		asset: patchedBunAsset(),
		bunVersion: Bun.version,
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
		return await installVerified(home);
	} catch (error) {
		console.error(
			`Could not install the patched Bun (${error instanceof Error ? error.message : String(error)}). Continuing with your bun; React edits will reload the page.`
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
	console.log(
		`Release: ${PATCHED_BUN_RELEASE.tag} (${PATCHED_BUN_RELEASE.issue})`
	);
	console.log(
		`Platform build: ${patchedBunAsset() ?? 'none for this platform'}`
	);
	console.log(
		`Your bun: ${Bun.version} (${supported ? 'already has the fix' : 'stock, no fix'})`
	);
	console.log(`Installed: ${describeInstalled(installedPatchedBun(home))}`);
	console.log(
		`Prompt: ${describePreference(readPatchedBunPreference(home))}`
	);
};

/** `absolute bun-patch [status|install|remove|reset]` */
export const bunPatch = async (args: string[], home = homedir()) => {
	const [action = 'status'] = args;
	if (action === 'status') {
		printStatus(home);

		return;
	}
	if (action === 'install') {
		await installVerified(home);
		console.log('`absolute dev` will use it from now on.');

		return;
	}
	if (action === 'remove') {
		rmSync(join(absoluteHome(home), 'bun'), {
			force: true,
			recursive: true
		});
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
