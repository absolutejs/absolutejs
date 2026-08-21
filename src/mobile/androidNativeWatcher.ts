import { watch, type FSWatcher } from 'node:fs';
import { basename } from 'node:path';
import {
	fingerprintAbsoluteAndroidNativeProject,
	type AbsoluteAndroidDevProject
} from './androidEmulatorController';

const NATIVE_CHANGE_DEBOUNCE_MS = 500;
const ROOT_NATIVE_INPUTS = new Set([
	'absolute.config.js',
	'absolute.config.mjs',
	'absolute.config.ts',
	'bun.lock',
	'bun.lockb',
	'capacitor.config.js',
	'capacitor.config.ts',
	'package.json'
]);

export type AbsoluteAndroidNativeChange = {
	afterFingerprint: string;
	beforeFingerprint: string;
	paths: string[];
	rootInputChanged: boolean;
};

export type AbsoluteAndroidNativeWatcher = {
	close: () => void;
};

export type AbsoluteAndroidNativeWatcherOptions = {
	debounceMs?: number;
	onChange: (change: AbsoluteAndroidNativeChange) => Promise<void>;
	onError?: (error: unknown) => void;
	project: AbsoluteAndroidDevProject;
	signal?: AbortSignal;
};

export const createAbsoluteAndroidNativeWatcher = async (
	options: AbsoluteAndroidNativeWatcherOptions
): Promise<AbsoluteAndroidNativeWatcher> => {
	let fingerprint = await fingerprintAbsoluteAndroidNativeProject(
		options.project
	);
	let closed = false;
	let running = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let rootInputChanged = false;
	const changedPaths = new Set<string>();
	const watchers: FSWatcher[] = [];
	const debounceMs = options.debounceMs ?? NATIVE_CHANGE_DEBOUNCE_MS;
	const applyFingerprint = async (
		next: string,
		forced: boolean,
		paths: string[]
	) => {
		if (!forced && next === fingerprint) return;
		await options.onChange({
			afterFingerprint: next,
			beforeFingerprint: fingerprint,
			paths,
			rootInputChanged: forced
		});
		fingerprint = await fingerprintAbsoluteAndroidNativeProject(
			options.project
		);
	};

	const close = () => {
		if (closed) return;
		closed = true;
		if (timer) clearTimeout(timer);
		watchers.forEach((watcher) => watcher.close());
		options.signal?.removeEventListener('abort', close);
	};

	const flush = async () => {
		timer = undefined;
		if (closed || running || changedPaths.size === 0) return;
		running = true;
		const paths = [...changedPaths].sort();
		const forced = rootInputChanged;
		changedPaths.clear();
		rootInputChanged = false;
		try {
			const next = await fingerprintAbsoluteAndroidNativeProject(
				options.project
			);
			await applyFingerprint(next, forced, paths);
		} catch (error) {
			options.onError?.(error);
		} finally {
			running = false;
			if (changedPaths.size > 0) schedule();
		}
	};

	const schedule = () => {
		if (closed || running) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void flush(), debounceMs);
	};

	const record = (path: string, force: boolean) => {
		if (closed) return;
		changedPaths.add(path);
		rootInputChanged ||= force;
		schedule();
	};

	watchers.push(
		watch(
			options.project.nativeDirectory,
			{ recursive: true },
			(_event, filename) => {
				if (filename) record(String(filename), false);
			}
		)
	);
	watchers.push(
		watch(options.project.projectRoot, (_event, filename) => {
			if (!filename) return;
			const path = String(filename);
			if (isAbsoluteAndroidNativeRootInput(path)) record(path, true);
		})
	);
	watchers.forEach((watcher) => {
		watcher.on('error', (error) => options.onError?.(error));
	});
	options.signal?.addEventListener('abort', close, { once: true });

	return { close };
};

export const isAbsoluteAndroidNativeRootInput = (path: string) =>
	ROOT_NATIVE_INPUTS.has(basename(path));
