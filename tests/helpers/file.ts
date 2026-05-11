import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmdirSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';

type BackupEntry =
	| { kind: 'mutated'; path: string; content: string }
	| { kind: 'created'; path: string; createdDirs?: string[] };

const backups: BackupEntry[] = [];

export const mutateFile = (
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
export const createFile = (filePath: string, content: string) => {
	const resolved = resolve(filePath);
	if (existsSync(resolved)) {
		throw new Error(
			`createFile: refusing to overwrite existing file ${resolved}. Use mutateFile if you mean to modify.`
		);
	}
	// Walk up missing parent dirs so we can roll them back individually
	// during restoreAllFiles — `mkdirSync({ recursive: true })` would
	// silently leave behind whatever it created if any path segment was
	// already present.
	const createdDirs: string[] = [];
	let dir = dirname(resolved);
	const missing: string[] = [];
	while (!existsSync(dir) && dir !== '/' && dir !== '.') {
		missing.unshift(dir);
		dir = dirname(dir);
	}
	for (const d of missing) {
		mkdirSync(d);
		createdDirs.push(d);
	}
	writeFileSync(resolved, content, 'utf-8');
	backups.push({
		createdDirs: createdDirs.length > 0 ? createdDirs : undefined,
		kind: 'created',
		path: resolved
	});
};
/* Rename a file in two steps so the existing backup tape can roll
 * the change back: record a `mutated` backup for the source path
 * (so restoreAllFiles writes the original content back), then
 * `created` for the destination (so the new file gets unlinked on
 * teardown). The new file's content is identical to the original
 * — callers typically follow up with `mutateFile` on the new path
 * if they need to alter it. */
export const renameFile = (fromPath: string, toPath: string) => {
	const fromResolved = resolve(fromPath);
	const toResolved = resolve(toPath);
	if (!existsSync(fromResolved)) {
		throw new Error(`renameFile: source missing: ${fromResolved}`);
	}
	if (existsSync(toResolved)) {
		throw new Error(
			`renameFile: destination already exists: ${toResolved}`
		);
	}
	const content = readFileSync(fromResolved, 'utf-8');
	backups.push({ content, kind: 'mutated', path: fromResolved });
	writeFileSync(toResolved, content, 'utf-8');
	backups.push({ kind: 'created', path: toResolved });
	unlinkSync(fromResolved);
};
export const restoreAllFiles = () => {
	while (backups.length > 0) {
		const entry = backups.pop();
		if (!entry) continue;
		if (entry.kind === 'mutated') {
			writeFileSync(entry.path, entry.content, 'utf-8');
		} else {
			if (existsSync(entry.path)) {
				unlinkSync(entry.path);
			}
			// Pop dirs we created from deepest to shallowest. If any
			// of them already has unexpected siblings the rmdir
			// throws ENOTEMPTY and we leave it alone.
			if (entry.createdDirs) {
				for (const d of [...entry.createdDirs].reverse()) {
					try {
						rmdirSync(d);
					} catch {
						/* not empty or already gone — leave it */
					}
				}
			}
		}
	}
};
export const restoreFile = (filePath: string) => {
	const resolved = resolve(filePath);
	const idx = backups.findIndex((b) => b.path === resolved);
	if (idx === -1) return;
	const [entry] = backups.splice(idx, 1);
	if (!entry) return;
	if (entry.kind === 'mutated') {
		writeFileSync(entry.path, entry.content, 'utf-8');
		return;
	}
	if (existsSync(entry.path)) {
		unlinkSync(entry.path);
	}
	if (entry.createdDirs) {
		for (const d of [...entry.createdDirs].reverse()) {
			try {
				rmdirSync(d);
			} catch {
				/* not empty or already gone — leave it */
			}
		}
	}
};
export const withFileMutation = async <T>(
	filePath: string,
	transform: (content: string) => string,
	fn: () => T | Promise<T>
) => {
	mutateFile(filePath, transform);
	try {
		return await fn();
	} finally {
		restoreFile(filePath);
	}
};
