/* The filesystem edge of the migration engine.
 *
 * Everything else in `src/migrate` is pure so it can be tested without
 * fixtures and reused over a Studio workspace. This module is the one place
 * that touches disk, kept deliberately small: read a manifest, list some
 * files, find which of them import a dependency. */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import catalogSnapshot from './catalogSnapshot.json';
import { detectStack } from './detect';
import {
	planSubstitutions,
	type CatalogEntryLike,
	type SubstitutionRule
} from './substitutions';
import type { MigrationPlan } from './types';

/** Directories never worth walking: none of them hold source a migration
 *  should reason about, and `node_modules` alone would dominate the scan. */
const SKIP_DIRECTORIES = new Set([
	'.git',
	'.next',
	'.turbo',
	'build',
	'coverage',
	'dist',
	'node_modules',
	'out'
]);

const SOURCE_EXTENSIONS = [
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.vue',
	'.svelte'
];

/** Bounded so a scan of an unexpectedly large repository stays interactive.
 *  Detection needs root files; substitution needs enough source to find
 *  imports. Neither improves much past this. */
const MAX_FILES = 5000;

const isSource = (file: string) =>
	SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension));

/* Every filesystem call here answers a question rather than throwing: a
 * repository with an unreadable directory or a dangling symlink should still
 * produce a report. */
const entriesOf = (directory: string) => {
	try {
		return readdirSync(directory);
	} catch {
		return [];
	}
};

const isDirectory = (path: string) => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

const textOf = (path: string) => {
	try {
		return readFileSync(path, 'utf-8');
	} catch {
		return '';
	}
};

type Walk = { directories: string[]; files: string[] };

const walkOne = (root: string, directory: string) =>
	entriesOf(directory).reduce<Walk>(
		(carry, entry) => {
			if (SKIP_DIRECTORIES.has(entry)) return carry;
			const absolute = join(directory, entry);
			if (isDirectory(absolute)) {
				carry.directories.push(absolute);

				return carry;
			}
			carry.files.push(relative(root, absolute));

			return carry;
		},
		{ directories: [], files: [] }
	);

/** Repo-relative paths, skipping build output and vendored code. */
export const listProjectFiles = (root: string, limit = MAX_FILES) => {
	const found: string[] = [];
	const queue = [root];
	while (queue.length > 0 && found.length < limit) {
		const directory = queue.shift();
		if (directory === undefined) break;
		const walk = walkOne(root, directory);
		queue.push(...walk.directories);
		found.push(...walk.files.slice(0, limit - found.length));
	}

	return found;
};

type Manifest = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const sectionNames = (value: unknown) =>
	isRecord(value) ? Object.keys(value) : [];

const readManifest = (root: string) => {
	const path = join(root, 'package.json');
	if (!existsSync(path)) return null;
	// A manifest that will not parse is the same as none for our purposes; a
	// migration should not die on someone's trailing comma before it has
	// said anything useful.
	const parsed: unknown = JSON.parse(textOf(path) || 'null');
	if (!isRecord(parsed)) return null;

	return parsed;
};

const declaredDependencies = (manifest: Manifest | null) => {
	if (!manifest) return [];
	const source: Record<string, unknown> = manifest;

	return ['dependencies', 'devDependencies', 'peerDependencies'].flatMap(
		(section) => sectionNames(source[section])
	);
};

const importsInFile = (text: string, packages: readonly string[]) =>
	packages.filter(
		(name) => text.includes(`'${name}`) || text.includes(`"${name}`)
	);

/** Which files import each of `packages`. A plain substring test over the
 *  quoted specifier: an import map does not need a parser, and being wrong
 *  here costs a slightly long list, not a bad edit. */
export const findImporters = (
	root: string,
	files: readonly string[],
	packages: readonly string[]
) =>
	files.filter(isSource).reduce<Record<string, string[]>>((carry, file) => {
		for (const name of importsInFile(textOf(join(root, file)), packages)) {
			carry[name] = [...(carry[name] ?? []), file];
		}

		return carry;
	}, {});

export type ScanOptions = {
	catalog?: readonly CatalogEntryLike[];
	rules?: readonly SubstitutionRule[];
};

/** Read a project and produce the plan. Does not modify anything. */
export const scanProject = (
	root: string,
	{ catalog, rules }: ScanOptions = {}
): MigrationPlan => {
	const manifest = readManifest(root);
	const files = listProjectFiles(root);
	const dependencies = declaredDependencies(manifest);
	// Studio passes its live catalog; the CLI falls back to the snapshot so
	// suggestions stay validated with no network and no Studio present.
	const resolvedCatalog =
		catalog ?? catalogSnapshot.names.map((name) => ({ name }));

	return {
		detection: detectStack({ files, manifest }),
		substitutions: planSubstitutions({
			catalog: resolvedCatalog,
			dependencies,
			importsByPackage: findImporters(root, files, dependencies),
			rules
		})
	};
};
