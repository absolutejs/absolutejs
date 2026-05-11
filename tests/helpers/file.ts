import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type BackupEntry =
	| { kind: 'mutated'; path: string; content: string }
	| { kind: 'created'; path: string };

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
	writeFileSync(resolved, content, 'utf-8');
	backups.push({ kind: 'created', path: resolved });
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
		} else if (existsSync(entry.path)) {
			unlinkSync(entry.path);
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
	} else if (existsSync(entry.path)) {
		unlinkSync(entry.path);
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
