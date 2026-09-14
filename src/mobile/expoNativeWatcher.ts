import { watch, type FSWatcher } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const NATIVE_CHANGE_DEBOUNCE_MS = 500;
const ROOT_NATIVE_INPUTS = new Set([
	'absolute.config.js',
	'absolute.config.mjs',
	'absolute.config.ts',
	'absolutejs.config.js',
	'absolutejs.config.mjs',
	'absolutejs.config.ts',
	'bun.lock',
	'bun.lockb',
	'package.json'
]);
const EXPO_NATIVE_DIRECTORIES = ['modules', 'plugins'] as const;

export type AbsoluteExpoNativeChange = {
	afterFingerprint: string;
	beforeFingerprint: string;
	paths: string[];
	rootInputChanged: boolean;
};

export type AbsoluteExpoNativeWatcher = { close: () => void };

export type AbsoluteExpoNativeWatcherOptions = {
	debounceMs?: number;
	expoProjectDirectory: string;
	onChange: (change: AbsoluteExpoNativeChange) => Promise<void>;
	onError?: (error: unknown) => void;
	projectRoot: string;
	signal?: AbortSignal;
};

const exists = async (path: string) =>
	access(path).then(
		() => true,
		() => false
	);

const filesIn = async (
	directory: string,
	prefix: string
): Promise<Array<{ name: string; path: string }>> => {
	if (!(await exists(directory))) return [];
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			const name = `${prefix}/${entry.name}`;
			if (entry.isDirectory()) return filesIn(path, name);

			return Promise.resolve(entry.isFile() ? [{ name, path }] : []);
		})
	);

	return nested
		.flat()
		.sort((left, right) => left.name.localeCompare(right.name));
};

const fingerprintAbsoluteExpoNativeInputs = async (
	options: Pick<
		AbsoluteExpoNativeWatcherOptions,
		'expoProjectDirectory' | 'projectRoot'
	>
) => {
	const hash = createHash('sha256');
	const rootFiles = await Promise.all(
		[...ROOT_NATIVE_INPUTS].sort().map(async (name) => {
			const path = join(options.projectRoot, name);

			return (await exists(path)) ? [{ name: `root/${name}`, path }] : [];
		})
	);
	const nativeFiles = await Promise.all(
		EXPO_NATIVE_DIRECTORIES.map((name) =>
			filesIn(join(options.expoProjectDirectory, name), name)
		)
	);
	const files = [...rootFiles.flat(), ...nativeFiles.flat()].sort(
		(left, right) => left.name.localeCompare(right.name)
	);
	const contents = await Promise.all(files.map(({ path }) => readFile(path)));
	files.forEach(({ name }, index) => {
		hash.update(name);
		hash.update(contents[index] ?? Buffer.alloc(0));
	});

	return hash.digest('hex');
};

const isAbsoluteExpoNativeRootInput = (path: string) =>
	ROOT_NATIVE_INPUTS.has(basename(path));

const createAbsoluteExpoNativeWatcher = async (
	options: AbsoluteExpoNativeWatcherOptions
): Promise<AbsoluteExpoNativeWatcher> => {
	let fingerprint = await fingerprintAbsoluteExpoNativeInputs(options);
	let closed = false;
	let running = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let rootInputChanged = false;
	const changedPaths = new Set<string>();
	const watchers: FSWatcher[] = [];
	const debounceMs = options.debounceMs ?? NATIVE_CHANGE_DEBOUNCE_MS;

	const close = () => {
		if (closed) return;
		closed = true;
		if (timer) clearTimeout(timer);
		watchers.forEach((watcher) => watcher.close());
		options.signal?.removeEventListener('abort', close);
	};
	const schedule = () => {
		if (closed || running) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void flush(), debounceMs);
	};
	const record = (path: string, root: boolean) => {
		if (closed) return;
		changedPaths.add(path);
		rootInputChanged ||= root;
		schedule();
	};
	const flush = async () => {
		timer = undefined;
		if (closed || running || changedPaths.size === 0) return;
		running = true;
		const paths = [...changedPaths].sort();
		const rootChanged = rootInputChanged;
		changedPaths.clear();
		rootInputChanged = false;
		try {
			const next = await fingerprintAbsoluteExpoNativeInputs(options);
			if (next === fingerprint) return;
			await options.onChange({
				afterFingerprint: next,
				beforeFingerprint: fingerprint,
				paths,
				rootInputChanged: rootChanged
			});
			fingerprint = await fingerprintAbsoluteExpoNativeInputs(options);
		} catch (error) {
			options.onError?.(error);
		} finally {
			running = false;
			if (changedPaths.size > 0) schedule();
		}
	};

	const nativeDirectories = (
		await Promise.all(
			EXPO_NATIVE_DIRECTORIES.map(async (name) => {
				const directory = join(options.expoProjectDirectory, name);

				return (await exists(directory)) ? [directory] : [];
			})
		)
	).flat();
	nativeDirectories.forEach((directory) => {
		watchers.push(
			watch(directory, { recursive: true }, (_event, filename) => {
				if (!filename) return;
				record(
					relative(
						options.expoProjectDirectory,
						join(directory, String(filename))
					),
					false
				);
			})
		);
	});
	watchers.push(
		watch(options.projectRoot, (_event, filename) => {
			if (!filename) return;
			const path = String(filename);
			if (isAbsoluteExpoNativeRootInput(path)) record(path, true);
		})
	);
	watchers.forEach((watcher) =>
		watcher.on('error', (error) => options.onError?.(error))
	);
	options.signal?.addEventListener('abort', close, { once: true });

	return { close };
};

export {
	createAbsoluteExpoNativeWatcher,
	fingerprintAbsoluteExpoNativeInputs,
	isAbsoluteExpoNativeRootInput
};
