/* TypeScript helper emission for the Vue pipeline.
 *
 * A Vue page's components pull in plain `.ts` helpers (stores, composables,
 * shared utilities), and every one of them has to land in the generated
 * client and server trees so the relative imports inside the compiled
 * intermediates resolve. `cleanup/generated` wipes that tree after every
 * build, so the emission repeats on every build — on a large app that is
 * several hundred files of TS-stripping plus a line-preserving inline
 * sourcemap each, which measured as the single largest slice of an
 * on-demand page build.
 *
 * Two things make that cheap here:
 *
 *   - the work is pure (source path in, two identical output files out),
 *     so it fans out across the build worker pool. This module is the
 *     shared handler: the worker entry and the pool's inline fallback both
 *     call it, which is what keeps the two modes byte-for-byte equivalent;
 *   - the emitted bytes are a pure function of the source text plus the
 *     framework version, so they are also kept under
 *     `.absolutejs/compile-cache/vue-helpers/`. A file whose content has
 *     not changed is copied back instead of transpiled — the same
 *     restart-surviving contract `vueCompileCache` gives SFCs, and the
 *     same opt-out (`ABSOLUTE_COMPILE_CACHE=0`).
 */

import { file, Transpiler, write } from 'bun';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
	TsHelperEmitInput,
	TsHelperEmitOutput
} from '../../types/workerPool';
import { inlineLineMapComment } from './chainInlineSourcemaps';
import {
	frameworkVersionForCache,
	hashContent,
	hashParts,
	vueCompileCacheEnabled
} from './vueCompileCache';

const CACHE_DIR_NAME = 'vue-helpers';
const CACHE_FORMAT_VERSION = 1;
const HASH_LENGTH = 24;

/* One transpiler per thread. `loader: 'ts'` + `target: 'browser'` matches
 * what `compileVue` used when this ran inline, so the emitted bytes are
 * unchanged. */
const transpiler = new Transpiler({ loader: 'ts', target: 'browser' });

const cacheDir = () =>
	join(process.cwd(), '.absolutejs', 'compile-cache', CACHE_DIR_NAME);

const cacheKey = (sourcePath: string, sourceCode: string) => {
	const frameworkVersion = frameworkVersionForCache();
	if (!frameworkVersion || !vueCompileCacheEnabled()) return null;

	return {
		content: hashContent(sourceCode).slice(0, HASH_LENGTH),
		path: hashParts([
			String(CACHE_FORMAT_VERSION),
			frameworkVersion,
			sourcePath
		]).slice(0, HASH_LENGTH)
	};
};

/* Cache entries are content addressed, so an edited helper leaves its
 * previous entry behind. The directory listing is read once per thread and
 * used to drop the superseded entries for a path as it is rewritten,
 * which bounds the directory at one file per helper. */
let existingEntries: Map<string, string[]> | undefined;

const listCacheDir = (directory: string) => {
	try {
		return readdirSync(directory);
	} catch {
		/* first run — nothing cached yet */
		return [];
	}
};

const indexCacheDir = (directory: string) => {
	const index = new Map<string, string[]>();
	for (const name of listCacheDir(directory)) {
		const [prefix] = name.split('-');
		if (prefix === undefined) continue;
		index.set(prefix, [...(index.get(prefix) ?? []), name]);
	}

	return index;
};

const entriesForPath = (directory: string, pathHash: string) => {
	existingEntries ??= indexCacheDir(directory);

	return existingEntries.get(pathHash) ?? [];
};

const publishCacheEntry = async (
	directory: string,
	fileName: string,
	pathHash: string,
	content: string
) => {
	try {
		await mkdir(directory, { recursive: true });
		const target = join(directory, fileName);
		const temporary = `${target}.${process.pid}.tmp`;
		await writeFile(temporary, content);
		await rename(temporary, target);
		const superseded = entriesForPath(directory, pathHash).filter(
			(name) => name !== fileName
		);
		existingEntries?.set(pathHash, [fileName]);
		await Promise.all(
			superseded.map((name) =>
				Bun.file(join(directory, name))
					.delete()
					.catch(() => undefined)
			)
		);
	} catch {
		/* best-effort: a read-only checkout just means no cache next time */
	}
};

const writeBoth = async (
	clientOutputPath: string,
	serverOutputPath: string,
	content: string
) => {
	await Promise.all([
		mkdir(dirname(clientOutputPath), { recursive: true }),
		mkdir(dirname(serverOutputPath), { recursive: true })
	]);
	await Promise.all([
		write(clientOutputPath, content),
		write(serverOutputPath, content)
	]);
};

const copyBoth = async (
	clientOutputPath: string,
	serverOutputPath: string,
	cachedPath: string
) => {
	await Promise.all([
		mkdir(dirname(clientOutputPath), { recursive: true }),
		mkdir(dirname(serverOutputPath), { recursive: true })
	]);
	copyFileSync(cachedPath, clientOutputPath);
	copyFileSync(cachedPath, serverOutputPath);
};

const emitOne = async ({
	clientOutputPath,
	serverOutputPath,
	sourcePath
}: TsHelperEmitInput['files'][number]) => {
	const sourceCode = await file(sourcePath).text();
	const key = cacheKey(sourcePath, sourceCode);
	const directory = cacheDir();
	const fileName = key ? `${key.path}-${key.content}.js` : null;
	const cachedPath = fileName ? join(directory, fileName) : null;
	if (cachedPath && existsSync(cachedPath)) {
		await copyBoth(clientOutputPath, serverOutputPath, cachedPath);

		return;
	}
	const transpiledCode = transpiler.transformSync(sourceCode);
	// Append an inline map back to the .ts source (TS-stripping is
	// line-preserving) so the production external-sourcemap chain
	// resolves stacks to the .ts, not this transpiled intermediate.
	const withMap =
		transpiledCode +
		inlineLineMapComment(sourcePath, sourceCode, transpiledCode);
	await writeBoth(clientOutputPath, serverOutputPath, withMap);
	if (key && fileName) {
		await publishCacheEntry(directory, fileName, key.path, withMap);
	}
};

export const emitTsHelpers = async ({
	files
}: TsHelperEmitInput): Promise<TsHelperEmitOutput> => {
	await Promise.all(files.map(emitOne));

	return { emitted: files.length };
};
