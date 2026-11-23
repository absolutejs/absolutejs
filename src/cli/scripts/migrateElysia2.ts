import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	checkElysia2Source,
	type MigrationDiagnostic
} from '../../migrate/elysia2';

const skipped = new Set(['node_modules', 'build', 'dist', 'out', 'coverage']);
const sources = function* (root: string, directory = ''): Generator<string> {
	const entries = readdirSync(join(root, directory), { withFileTypes: true });
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name)
	)) {
		if (entry.name.startsWith('.') || skipped.has(entry.name)) continue;
		const file = join(directory, entry.name);
		if (entry.isDirectory()) yield* sources(root, file);
		else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(file)) yield file;
	}
};

const inspectFile = (root: string, file: string, apply: boolean) => {
	const path = join(root, file);
	const content = readFileSync(path, 'utf8');
	let diagnostics = checkElysia2Source(file, content);
	const edits = apply
		? diagnostics
				.flatMap((item) => item.edit ?? [])
				.sort((left, right) => right.start - left.start)
		: [];
	if (!edits.length) return { applied: 0, diagnostics };
	const updated = edits.reduce(
		(text, edit) =>
			text.slice(0, edit.start) + edit.text + text.slice(edit.end),
		content
	);
	writeFileSync(path, updated);

	diagnostics = checkElysia2Source(file, updated);

	return { applied: edits.length, diagnostics };
};

export const migrateElysia2 = (root: string, args: string[]) => {
	const findings: MigrationDiagnostic[] = [];
	let applied = 0;
	for (const file of sources(root)) {
		const result = inspectFile(root, file, args.includes('--apply'));
		applied += result.applied;
		findings.push(...result.diagnostics);
	}
	if (args.includes('--json'))
		console.log(JSON.stringify({ applied, findings, target: 'elysia-2' }));
	else {
		for (const finding of findings)
			console.log(`${finding.file}:${finding.line} ${finding.message}`);
		console.log(
			`${findings.length} migration findings remaining. Applied ${applied} edits.`
		);
	}
	if (args.includes('--check') && findings.length) process.exitCode = 1;
};
