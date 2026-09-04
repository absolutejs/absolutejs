/* Restart-surviving cache for the dev vendor bundles.
 *
 * Every `absolute dev` boot rebuilds the same few megabytes of vendor
 * bundles (React/Vue/Svelte/Angular runtimes plus one file per npm
 * dependency) and then rewrites cross-vendor specifiers in them — roughly
 * three quarters of a second on a large app, repeated on every restart
 * even when nothing about the dependencies changed.
 *
 * The outputs are a pure function of: the installed dependency tree (the
 * lockfile), the framework version, the bundler (Bun) version, the set of
 * specifiers that were vendored, and the framework directories the scan
 * ran over. Hash those into a key, keep the POST-rewrite vendor
 * directories under `.absolutejs/vendor-cache/<key>/`, and a restart with
 * unchanged dependencies copies them back instead of rebuilding.
 *
 * Only ever consulted in dev (`core/devBuild.ts`); the production build
 * path never calls in here. Opt out with `ABSOLUTE_DEV_VENDOR_CACHE=0`. */

import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync
} from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const CACHE_ROOT = join('.absolutejs', 'vendor-cache');
const CACHE_FORMAT_VERSION = 1;
const KEY_LENGTH = 32;
const LOCKFILES = [
	'bun.lock',
	'bun.lockb',
	'package-lock.json',
	'pnpm-lock.yaml',
	'yarn.lock'
];

export type VendorCachePayload = {
	depPaths: Record<string, string>;
	angularSpecifiers?: string[];
};

export type VendorCacheInputs = {
	/** Absolute paths of the vendor directories to cache, in build order. */
	vendorDirs: string[];
	/** Every specifier that was vendored, in any order. */
	specifiers: string[];
	/** Framework directories the vendor scan ran over. */
	sourceDirs: string[];
	frameworkVersion: string;
	runtimeVersion: string;
	lockfileHash: string;
};

export const computeVendorCacheKey = (inputs: VendorCacheInputs) => {
	const hash = createHash('sha256');
	hash.update(String(CACHE_FORMAT_VERSION));
	hash.update('\0');
	hash.update(inputs.lockfileHash);
	hash.update('\0');
	hash.update(inputs.frameworkVersion);
	hash.update('\0');
	hash.update(inputs.runtimeVersion);
	for (const dir of [...inputs.sourceDirs].sort()) {
		hash.update('\0d');
		hash.update(dir);
	}
	for (const specifier of [...inputs.specifiers].sort()) {
		hash.update('\0s');
		hash.update(specifier);
	}
	for (const dir of inputs.vendorDirs) {
		hash.update('\0v');
		hash.update(basename(resolve(dir, '..')));
	}

	return hash.digest('hex').slice(0, KEY_LENGTH);
};
export const readLockfileHash = (projectRoot = process.cwd()) => {
	const hash = createHash('sha256');
	let found = false;
	for (const name of LOCKFILES) {
		const path = join(projectRoot, name);
		if (!existsSync(path)) continue;
		found = true;
		hash.update(name);
		hash.update(readFileSync(path));
	}

	return found ? hash.digest('hex') : null;
};
export const vendorCacheEnabled = () =>
	process.env.ABSOLUTE_DEV_VENDOR_CACHE !== '0';

/** `fs.cp` walks and stats far more than this needs; a plain parallel
 *  recursive copy of a flat vendor directory is an order of magnitude
 *  faster and is all the cache ever has to move. */
const copyTree = (fromDir: string, toDir: string) => {
	mkdirSync(toDir, { recursive: true });
	for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
		const source = join(fromDir, entry.name);
		const destination = join(toDir, entry.name);
		if (entry.isDirectory()) copyTree(source, destination);
		else copyFileSync(source, destination);
	}
};

/** Cache entry → build dir. Throws on an incomplete entry, which the
 *  caller turns into a cache miss. */
const copySlotsInto = (cacheDir: string, vendorDirs: string[]) => {
	for (const [index, dir] of vendorDirs.entries()) {
		const source = join(cacheDir, slotName(index, dir));
		if (!existsSync(source)) {
			throw new Error(`missing cached vendor dir ${source}`);
		}
		copyTree(source, dir);
	}
};

/** Build dir → staging dir of a new cache entry. */
const copySlotsFrom = (stagingDir: string, vendorDirs: string[]) => {
	for (const [index, dir] of vendorDirs.entries()) {
		if (!existsSync(dir)) continue;
		copyTree(dir, join(stagingDir, slotName(index, dir)));
	}
};

const isVendorCachePayload = (value: unknown): value is VendorCachePayload =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'depPaths') === 'object';

const cacheDirFor = (key: string, projectRoot: string) =>
	resolve(projectRoot, CACHE_ROOT, key);

const slotName = (index: number, dir: string) =>
	`${index}-${basename(resolve(dir, '..'))}`;

/** Copy the cached vendor directories back into the build dir. Returns
 *  the cached payload on a hit, `null` on a miss. */
export const restoreVendorCache = async (
	key: string,
	vendorDirs: string[],
	projectRoot = process.cwd()
) => {
	const cacheDir = cacheDirFor(key, projectRoot);
	const payloadPath = join(cacheDir, 'payload.json');
	if (!existsSync(payloadPath)) return null;
	try {
		const payload: unknown = JSON.parse(
			await readFile(payloadPath, 'utf8')
		);
		if (!isVendorCachePayload(payload)) return null;
		copySlotsInto(cacheDir, vendorDirs);

		return payload;
	} catch {
		// A half-written or unreadable cache entry is a miss, never a
		// build failure.
		return null;
	}
};

/** Store the (already rewritten) vendor directories under `key`. Written
 *  to a temp dir and renamed so a concurrent boot never sees a partial
 *  entry. Failures are swallowed: the cache is an optimisation. */
export const saveVendorCache = async (
	key: string,
	vendorDirs: string[],
	payload: VendorCachePayload,
	projectRoot = process.cwd()
) => {
	const cacheDir = cacheDirFor(key, projectRoot);
	if (existsSync(join(cacheDir, 'payload.json'))) return;
	const stagingDir = `${cacheDir}.${process.pid}.tmp`;
	try {
		await rm(stagingDir, { force: true, recursive: true });
		await mkdir(stagingDir, { recursive: true });
		copySlotsFrom(stagingDir, vendorDirs);
		await writeFile(
			join(stagingDir, 'payload.json'),
			JSON.stringify(payload)
		);
		await rm(cacheDir, { force: true, recursive: true });
		await rename(stagingDir, cacheDir);
	} catch {
		await rm(stagingDir, { force: true, recursive: true }).catch(
			() => undefined
		);
	}
};
