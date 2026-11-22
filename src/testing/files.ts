/* Editing a source file during a test, and putting it back.
 *
 * Testing hot reload means editing real files in a real project, which is
 * only safe if every edit is reversible — including when the assertion
 * between the edit and the restore throws. Everything here records what
 * it did so `restoreAllFiles()` in an `afterEach` returns the tree to
 * exactly what git has, whatever happened in between.
 *
 * The registry is module state, so the restore list is shared by every
 * importer of this module in a process. That is the point: one `afterEach`
 * cleans up after helpers called from anywhere. */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

type BackupEntry =
	| { content: string; kind: 'mutated'; path: string }
	| { createdDirs?: string[]; kind: 'created'; path: string };

const NOT_FOUND = -1;

const backups: BackupEntry[] = [];
let atomicWriteSequence = 0;

/* Temp file plus rename: the way most editors save, and the only way a
 * reader never observes a half-written file. */
const replaceFileAtomically = (path: string, content: string) => {
	atomicWriteSequence += 1;
	const temporaryPath = join(
		dirname(path),
		`.${basename(path)}.tmp.${process.pid}.${atomicWriteSequence}`
	);
	try {
		writeFileSync(temporaryPath, content, 'utf-8');
		renameSync(temporaryPath, path);
	} finally {
		if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
	}
};

/* A directory that has picked up unexpected siblings throws ENOTEMPTY and
 * is left alone rather than forced. */
const tryRemoveDir = (directory: string) => {
	try {
		rmdirSync(directory);
	} catch {
		/* Not empty, or already gone. */
	}
};

/** Deepest first, so a nested chain unwinds. */
const removeCreatedDirs = (created: readonly string[] | undefined) => {
	for (const directory of [...(created ?? [])].reverse())
		tryRemoveDir(directory);
};

/* Walked one level at a time rather than `mkdirSync({ recursive: true })`,
 * which reports nothing about which segments it created and so leaves
 * them behind on restore. */
const createMissingDirs = (target: string) => {
	const missing: string[] = [];
	let directory = dirname(target);
	while (!existsSync(directory) && directory !== '/' && directory !== '.') {
		missing.unshift(directory);
		directory = dirname(directory);
	}
	for (const path of missing) mkdirSync(path);

	return missing;
};

const undo = (entry: BackupEntry) => {
	if (entry.kind === 'mutated') {
		replaceFileAtomically(entry.path, entry.content);

		return;
	}
	if (existsSync(entry.path)) unlinkSync(entry.path);
	removeCreatedDirs(entry.createdDirs);
};

/** Write a file that does not exist yet, creating parent directories.
 *  Refuses to overwrite, because a test that silently replaced a real
 *  source file would restore it as if it had created it. */
export const createFile = (filePath: string, content: string) => {
	const resolved = resolve(filePath);
	if (existsSync(resolved))
		throw new Error(
			`createFile: refusing to overwrite existing file ${resolved}. Use mutateFile to modify one.`
		);
	const createdDirs = createMissingDirs(resolved);
	writeFileSync(resolved, content, 'utf-8');
	backups.push({
		createdDirs: createdDirs.length > 0 ? createdDirs : undefined,
		kind: 'created',
		path: resolved
	});
};

/** Transform a file's contents, recording the original. Written
 *  atomically, so a watcher sees a `rename`. */
export const mutateFile = (
	filePath: string,
	transform: (content: string) => string
) => {
	const resolved = resolve(filePath);
	const original = readFileSync(resolved, 'utf-8');
	backups.push({ content: original, kind: 'mutated', path: resolved });
	const transformed = transform(original);
	replaceFileAtomically(resolved, transformed);

	return { original, transformed };
};

/** Like `mutateFile`, but writes over the existing inode, so a watcher
 *  sees a `change` rather than a `rename`. Some editors and most agents
 *  save this way, and the two paths are not equivalent to a file
 *  watcher — which is the whole reason both exist. */
export const mutateFileInPlace = (
	filePath: string,
	transform: (content: string) => string
) => {
	const resolved = resolve(filePath);
	const original = readFileSync(resolved, 'utf-8');
	backups.push({ content: original, kind: 'mutated', path: resolved });
	const transformed = transform(original);
	writeFileSync(resolved, transformed, 'utf-8');

	return { original, transformed };
};

/** Move a file, recording both halves so the move is reversible. */
export const renameFile = (fromPath: string, toPath: string) => {
	const fromResolved = resolve(fromPath);
	const toResolved = resolve(toPath);
	if (!existsSync(fromResolved))
		throw new Error(`renameFile: source missing: ${fromResolved}`);
	if (existsSync(toResolved))
		throw new Error(
			`renameFile: destination already exists: ${toResolved}`
		);
	const content = readFileSync(fromResolved, 'utf-8');
	backups.push({ content, kind: 'mutated', path: fromResolved });
	writeFileSync(toResolved, content, 'utf-8');
	backups.push({ kind: 'created', path: toResolved });
	unlinkSync(fromResolved);
};

/** Undo every recorded edit, most recent first. Call it from an
 *  `afterEach` — including on the path where the test failed. */
export const restoreAllFiles = () => {
	while (backups.length > 0) {
		const entry = backups.pop();
		if (entry !== undefined) undo(entry);
	}
};

/** Undo one file's most recent recorded edit, if it has one.
 *
 *  The LAST entry, not the first. A fixture is often created and then
 *  mutated — `createFile` then `mutateFile` — which records two entries
 *  for one path. Taking the first undid the *creation*, so `restoreFile`
 *  deleted a file the caller only wanted un-mutated, and left the
 *  mutation entry behind for `restoreAllFiles` to resurrect it from.
 *  Undoing the newest edit makes mutate / restore / mutate cycles work on
 *  a created fixture, and leaves the creation for the final cleanup. */
export const restoreFile = (filePath: string) => {
	const resolved = resolve(filePath);
	const index = backups.findLastIndex((entry) => entry.path === resolved);
	if (index === NOT_FOUND) return;
	const [entry] = backups.splice(index, 1);
	if (entry !== undefined) undo(entry);
};

/** Edit a file, run `body`, and restore the file whether or not `body`
 *  threw. The shape to reach for first: nothing to remember in a
 *  teardown, so nothing to forget. */
export const withFileMutation = async <Result>(
	filePath: string,
	transform: (content: string) => string,
	body: () => Promise<Result> | Result
) => {
	mutateFile(filePath, transform);
	try {
		return await body();
	} finally {
		restoreFile(filePath);
	}
};
