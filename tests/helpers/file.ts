import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type BackupEntry = { path: string; content: string };

const backups: BackupEntry[] = [];

export const mutateFile = (
	filePath: string,
	transform: (content: string) => string
) => {
	const resolved = resolve(filePath);
	const original = readFileSync(resolved, 'utf-8');
	backups.push({ content: original, path: resolved });
	const transformed = transform(original);
	writeFileSync(resolved, transformed, 'utf-8');

	return { original, transformed };
};
export const restoreAllFiles = () => {
	while (backups.length > 0) {
		const entry = backups.pop();
		if (entry) writeFileSync(entry.path, entry.content, 'utf-8');
	}
};
export const restoreFile = (filePath: string) => {
	const resolved = resolve(filePath);
	const idx = backups.findIndex((b) => b.path === resolved);
	if (idx === -1) return;
	const [entry] = backups.splice(idx, 1);
	writeFileSync(resolved, entry.content, 'utf-8');
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
