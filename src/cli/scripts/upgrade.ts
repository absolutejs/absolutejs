import { readdirSync, readFileSync, writeFileSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
	applyDependencyMigrations,
	applyMigrations,
	isDependencyMigration,
	mechanicalMigrations,
	migrationsBetween,
	packageVersions,
	publishedChangelog,
	type Migration
} from '@absolutejs/changelog';

/* `absolute upgrade [--to <version>] [--dry-run] [--yes]`
 *
 * What an upgrade costs a project, and the part of it a machine can do.
 *
 * This package releases often — 202 releases at the time of writing — and a
 * project several versions behind had no way to find out what its own code
 * had to change, short of reading every entry. The changelog already
 * carries that: a disruptive entry can declare a migration, and
 * `@absolutejs/changelog` exports the whole apparatus for applying one.
 * There was simply no entry point in this CLI, so the migrations shipped
 * and nothing ever read them.
 *
 * Measured against this package's own history: of 349 released entries, 9
 * declare a migration and 3 of those are MECHANICAL — two dependency
 * bumps and one rename of Elysia's lifecycle hooks. The other 6 are
 * instructions for a person. That ratio is the reason this command reports
 * as loudly as it edits: most of an upgrade is still a judgement, and a
 * command that silently rewrote three things while staying quiet about six
 * would be worse than one that says both.
 *
 * Order is load-bearing and comes from the library: a symbol renamed in
 * one release and moved in the next has to be renamed first, or the move
 * looks for a name that is no longer there. `migrationsBetween` returns
 * them in that order and this applies them as given. */

const PACKAGE = '@absolutejs/absolute';
const UNFOUND = -1;

const SKIP_DIRS = new Set([
	'.absolutejs',
	'.generated',
	'.git',
	'.next',
	'.svelte-kit',
	'.vercel',
	'build',
	'compiled',
	'coverage',
	'dist',
	'node_modules',
	'start-build'
]);

const SOURCE_EXTENSIONS = new Set([
	'.cjs',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.mts',
	'.svelte',
	'.ts',
	'.tsx',
	'.vue'
]);

const isWalkable = (name: string) =>
	!SKIP_DIRS.has(name) && !name.startsWith('.');

const isSource = (name: string) => {
	const dot = name.lastIndexOf('.');

	return dot !== UNFOUND && SOURCE_EXTENSIONS.has(name.slice(dot));
};

const collectEntry = (dir: string, entry: Dirent, found: string[]) => {
	const path = join(dir, entry.name);
	if (entry.isDirectory()) {
		if (isWalkable(entry.name)) collectSources(path, found);

		return;
	}
	if (isSource(entry.name)) found.push(path);
};

const collectSources = (dir: string, found: string[]) => {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) collectEntry(dir, entry, found);
};

/** The version of this package the project actually has installed, which is
 *  what an upgrade is FROM — not whatever its `package.json` range allows. */
const installedVersion = (projectRoot: string) => {
	try {
		const manifest: unknown = JSON.parse(
			readFileSync(
				join(projectRoot, 'node_modules', PACKAGE, 'package.json'),
				'utf-8'
			)
		);

		return typeof manifest === 'object' &&
			manifest !== null &&
			'version' in manifest &&
			typeof manifest.version === 'string'
			? manifest.version
			: undefined;
	} catch {
		return undefined;
	}
};

const latestVersion = async () => {
	const versions = await packageVersions(PACKAGE);

	return versions?.latest;
};

type Plan = {
	manual: { instruction: string; version: string }[];
	mechanical: { migration: Migration; version: string }[];
};

const planFor = (between: ReturnType<typeof migrationsBetween>): Plan => {
	const mechanicalSet = new Set(mechanicalMigrations(between));

	return {
		manual: between
			.filter((entry) => !mechanicalSet.has(entry))
			.map((entry) => ({
				instruction:
					entry.migration.instruction ?? 'See the changelog entry.',
				version: entry.version
			})),
		mechanical: between
			.filter((entry) => mechanicalSet.has(entry))
			.map((entry) => ({
				migration: entry.migration,
				version: entry.version
			}))
	};
};

/** The migration result for one file, or null when it is unreadable or
 *  nothing in it changed. Writes when asked, so the caller stays flat. */
const applyToFile = (
	file: string,
	migrations: readonly Migration[],
	write: boolean
) => {
	let source: string;
	try {
		source = readFileSync(file, 'utf-8');
	} catch {
		return null;
	}
	const result = applyMigrations(source, {
		migrations,
		packageName: PACKAGE,
		path: file
	});
	if (!result.changed) return null;
	if (write) writeFileSync(file, result.source);

	return result;
};

const applyToSources = (
	projectRoot: string,
	migrations: readonly Migration[],
	write: boolean
) => {
	const files: string[] = [];
	collectSources(projectRoot, files);
	const touched: string[] = [];
	const notes: string[] = [];
	for (const file of files) {
		const result = applyToFile(file, migrations, write);
		if (!result) continue;
		touched.push(relative(projectRoot, file).split(sep).join('/'));
		notes.push(...result.notes);
	}

	return { notes: [...new Set(notes)], touched };
};

const applyToManifest = (
	projectRoot: string,
	migrations: readonly Migration[],
	write: boolean
) => {
	const path = join(projectRoot, 'package.json');
	let manifest: string;
	try {
		manifest = readFileSync(path, 'utf-8');
	} catch {
		return [];
	}
	const outcome = applyDependencyMigrations(manifest, migrations);
	if (outcome.edits.length > 0 && write)
		writeFileSync(path, outcome.manifest);

	return outcome.edits;
};

const report = (plan: Plan, from: string, target: string) => {
	console.log(`${PACKAGE} ${from} → ${target}`);
	if (plan.mechanical.length === 0 && plan.manual.length === 0) {
		console.log(
			'No release in that range declares a migration, so nothing in your code has to change for this upgrade.'
		);

		return;
	}
	if (plan.manual.length === 0) return;
	console.log(
		`\n${plan.manual.length} change${plan.manual.length === 1 ? '' : 's'} need${plan.manual.length === 1 ? 's' : ''} a person. No command can make these:`
	);
	for (const item of plan.manual)
		console.log(`  ${item.version}  ${item.instruction}`);
};

export const upgrade = async (args: readonly string[]) => {
	const projectRoot = process.cwd();
	const from = installedVersion(projectRoot);
	if (from === undefined) {
		console.error(
			`${PACKAGE} is not installed in this project, so there is nothing to upgrade from. Run \`bun add ${PACKAGE}\` first.`
		);
		process.exit(1);
	}
	const flagIndex = args.indexOf('--to');
	const asked = flagIndex === UNFOUND ? undefined : args[flagIndex + 1];
	const target = asked ?? (await latestVersion());
	if (target === undefined) {
		console.error(
			`Could not read the published versions of ${PACKAGE}. Pass --to <version> to upgrade to a known one.`
		);
		process.exit(1);
	}
	if (target === from) {
		console.log(`${PACKAGE} ${from} is already the target. Nothing to do.`);

		return;
	}

	const changelog = await publishedChangelog(PACKAGE, target);
	if (!changelog) {
		console.error(
			`${PACKAGE}@${target} ships no changelog, so its migrations cannot be read. Upgrade by hand, or pass --to a version that has one.`
		);
		process.exit(1);
	}
	const plan = planFor(migrationsBetween(changelog, from, target));
	const dryRun = args.includes('--dry-run');
	const write = !dryRun;
	const migrations = plan.mechanical.map((item) => item.migration);
	const edits = applyToManifest(
		projectRoot,
		migrations.filter((migration) => isDependencyMigration(migration)),
		write
	);
	const sources = applyToSources(
		projectRoot,
		migrations.filter((migration) => !isDependencyMigration(migration)),
		write
	);

	report(plan, from, target);
	const verb = dryRun ? 'would change' : 'changed';
	for (const edit of edits)
		console.log(
			`\n${verb} package.json: ${edit.name} ${edit.from} → ${edit.to} (${edit.section})`
		);
	if (sources.touched.length > 0)
		console.log(
			`\n${verb} ${sources.touched.length} file${sources.touched.length === 1 ? '' : 's'}:\n${sources.touched.map((file) => `  ${file}`).join('\n')}`
		);
	for (const note of sources.notes) console.log(`  note: ${note}`);
	if (dryRun && (edits.length > 0 || sources.touched.length > 0))
		console.log('\nNothing was written: --dry-run.');
	/* The version in package.json is deliberately not bumped here. Which
	 * range a project wants, and which package manager writes its lockfile,
	 * are not this command's to decide — and a manifest edited to a version
	 * nobody installed would be worse than one left alone. */
	if (!dryRun)
		console.log(
			`\nInstall the target when ready: \`bun add ${PACKAGE}@${target}\`.`
		);
};
