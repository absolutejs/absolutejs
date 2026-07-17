import {
	existsSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { isRecord } from './config/guards';

const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'optionalDependencies',
	'peerDependencies'
] as const;

const TYPE_GRAPH_PACKAGES = ['elysia', '@sinclair/typebox'] as const;

type Manifest = Record<string, unknown>;
type PackageRequire = ReturnType<typeof createRequire>;
type Consumer = { manifest: Manifest; path: string };
type TargetInspection = {
	consumer?: Consumer;
	identity?: PackageIdentity;
	unresolved?: { consumer: string; packageName: string };
};

export type PackageIdentity = {
	consumer: string;
	packageName: string;
	packagePath: string;
	version: string;
};

export type TypeGraphReport = {
	identities: PackageIdentity[];
	installRoot: string;
	unresolved: { consumer: string; packageName: string }[];
};

const readManifest = (path: string) => {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));

		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

const dependencyRecord = (manifest: Manifest, field: string) => {
	const value = Reflect.get(manifest, field);

	return isRecord(value) ? value : {};
};

const dependencyNames = (manifest: Manifest) => [
	...new Set(
		DEPENDENCY_FIELDS.flatMap((field) =>
			Object.keys(dependencyRecord(manifest, field))
		)
	)
];

const declaresPackage = (manifest: Manifest, name: string) =>
	DEPENDENCY_FIELDS.some((field) =>
		Object.hasOwn(dependencyRecord(manifest, field), name)
	);

const manifestName = (manifest: Manifest, fallback: string) => {
	const name = Reflect.get(manifest, 'name');

	return typeof name === 'string' ? name : fallback;
};

const manifestVersion = (manifest: Manifest) => {
	const version = Reflect.get(manifest, 'version');

	return typeof version === 'string' ? version : 'unknown';
};

const packageJsonFromEntry = (entry: string, expectedName: string) => {
	let directory = dirname(entry);
	for (;;) {
		const candidate = join(directory, 'package.json');
		const manifest = readManifest(candidate);
		if (manifest && manifestName(manifest, '') === expectedName)
			return candidate;
		const parent = dirname(directory);
		if (parent === directory) return null;
		directory = parent;
	}
};

const resolvePackageJson = (
	requireFromConsumer: PackageRequire,
	name: string
) => {
	try {
		return requireFromConsumer.resolve(`${name}/package.json`);
	} catch {
		try {
			return packageJsonFromEntry(
				requireFromConsumer.resolve(name),
				name
			);
		} catch {
			return null;
		}
	}
};

const findInstallRoot = (cwd: string) => {
	let directory = resolve(cwd);
	for (;;) {
		if (
			existsSync(join(directory, 'bun.lock')) ||
			existsSync(join(directory, 'bun.lockb'))
		) {
			return directory;
		}
		const parent = dirname(directory);
		if (parent === directory) return resolve(cwd);
		directory = parent;
	}
};

const findProjectManifest = (cwd: string, installRoot: string) => {
	let directory = resolve(cwd);
	for (;;) {
		const candidate = join(directory, 'package.json');
		if (existsSync(candidate)) return candidate;
		if (directory === installRoot) return join(installRoot, 'package.json');
		const parent = dirname(directory);
		if (parent === directory) return join(installRoot, 'package.json');
		directory = parent;
	}
};

const appendConsumer = (
	consumers: Consumer[],
	consumerPaths: Set<string>,
	path: string,
	manifest: Manifest | null
) => {
	const physicalPath = realpathSync(path);
	if (!manifest || consumerPaths.has(physicalPath)) return;
	consumerPaths.add(physicalPath);
	consumers.push({ manifest, path });
};

const inspectTarget = (
	consumer: Consumer,
	consumerName: string,
	target: (typeof TYPE_GRAPH_PACKAGES)[number]
): TargetInspection => {
	if (!declaresPackage(consumer.manifest, target)) return {};
	const path = resolvePackageJson(createRequire(consumer.path), target);
	if (!path) {
		return {
			unresolved: { consumer: consumerName, packageName: target }
		};
	}
	const manifest = readManifest(path) ?? {};

	return {
		consumer: { manifest, path },
		identity: {
			consumer: consumerName,
			packageName: target,
			packagePath: realpathSync(path),
			version: manifestVersion(manifest)
		}
	};
};

const collectInspection = (
	inspection: TargetInspection,
	consumers: Consumer[],
	consumerPaths: Set<string>,
	identities: PackageIdentity[],
	unresolved: TypeGraphReport['unresolved']
) => {
	if (inspection.identity) identities.push(inspection.identity);
	if (inspection.unresolved) unresolved.push(inspection.unresolved);
	if (!inspection.consumer) return;
	appendConsumer(
		consumers,
		consumerPaths,
		inspection.consumer.path,
		inspection.consumer.manifest
	);
};

const inspectTypeGraph = (cwd: string): TypeGraphReport => {
	const installRoot = findInstallRoot(cwd);
	const rootManifestPath = join(installRoot, 'package.json');
	const rootManifest = readManifest(rootManifestPath) ?? {};
	const consumers: Consumer[] = [
		{ manifest: rootManifest, path: rootManifestPath }
	];
	const consumerPaths = new Set([realpathSync(rootManifestPath)]);
	const projectManifestPath = findProjectManifest(cwd, installRoot);
	appendConsumer(
		consumers,
		consumerPaths,
		projectManifestPath,
		readManifest(projectManifestPath)
	);
	const projectConsumers = [...consumers];

	projectConsumers.forEach((consumer) => {
		const projectRequire = createRequire(consumer.path);
		dependencyNames(consumer.manifest).forEach((dependency) => {
			const path = resolvePackageJson(projectRequire, dependency);
			if (!path) return;
			appendConsumer(consumers, consumerPaths, path, readManifest(path));
		});
	});

	const identities: PackageIdentity[] = [];
	const unresolved: TypeGraphReport['unresolved'] = [];
	for (const consumer of consumers) {
		const consumerName = manifestName(consumer.manifest, '<workspace>');
		const inspections = TYPE_GRAPH_PACKAGES.map((target) =>
			inspectTarget(consumer, consumerName, target)
		);
		inspections.forEach((inspection) =>
			collectInspection(
				inspection,
				consumers,
				consumerPaths,
				identities,
				unresolved
			)
		);
	}

	return { identities, installRoot, unresolved };
};

const duplicateTypeGraphPackages = (report: TypeGraphReport) =>
	TYPE_GRAPH_PACKAGES.flatMap((name) => {
		const identities = report.identities.filter(
			(identity) => identity.packageName === name
		);
		const paths = [
			...new Set(identities.map((identity) => identity.packagePath))
		];

		return paths.length > 1 ? [{ identities, name, paths }] : [];
	});

type DuplicatePackage = ReturnType<typeof duplicateTypeGraphPackages>[number];

const preferredIdentity = (duplicate: DuplicatePackage, rootName: string) =>
	duplicate.identities.find((identity) => identity.consumer === rootName) ??
	duplicate.identities.toSorted(
		(left, right) => left.packagePath.length - right.packagePath.length
	)[0];

const alignTypeGraphOverrides = (report: TypeGraphReport) => {
	const duplicates = duplicateTypeGraphPackages(report);
	if (duplicates.length === 0) return [];
	const manifestPath = join(report.installRoot, 'package.json');
	const manifest = readManifest(manifestPath);
	if (!manifest) return [];
	const existing = Reflect.get(manifest, 'overrides');
	const overrides: Manifest = isRecord(existing) ? existing : {};
	const changes: string[] = [];
	const rootName = manifestName(manifest, '<workspace>');

	for (const duplicate of duplicates) {
		const selected = preferredIdentity(duplicate, rootName);
		if (
			!selected ||
			Reflect.get(overrides, duplicate.name) === selected.version
		)
			continue;
		Reflect.set(overrides, duplicate.name, selected.version);
		changes.push(`${duplicate.name}@${selected.version}`);
	}

	if (changes.length > 0) {
		Reflect.set(manifest, 'overrides', overrides);
		writeFileSync(
			manifestPath,
			`${JSON.stringify(manifest, null, '\t')}\n`
		);
	}

	return changes;
};

const removeDuplicateTypeGraphPackages = (report: TypeGraphReport) => {
	const manifest =
		readManifest(join(report.installRoot, 'package.json')) ?? {};
	const rootName = manifestName(manifest, '<workspace>');
	const installPrefix = `${realpathSync(report.installRoot)}${sep}`;
	const nodeModulesSegment = `${sep}node_modules${sep}`;
	const removed: string[] = [];
	const stalePaths = duplicateTypeGraphPackages(report).flatMap(
		(duplicate) => {
			const selected = preferredIdentity(duplicate, rootName);

			return selected
				? duplicate.paths.filter(
						(path) => path !== selected.packagePath
					)
				: [];
		}
	);

	for (const stalePath of stalePaths) {
		if (
			!stalePath.startsWith(installPrefix) ||
			!stalePath.includes(nodeModulesSegment)
		)
			continue;
		rmSync(dirname(stalePath), { force: true, recursive: true });
		removed.push(stalePath);
	}

	return removed;
};

type TypeGraphCoherence = {
	alignTypeGraphOverrides: typeof alignTypeGraphOverrides;
	duplicateTypeGraphPackages: typeof duplicateTypeGraphPackages;
	findInstallRoot: typeof findInstallRoot;
	inspectTypeGraph: typeof inspectTypeGraph;
	removeDuplicateTypeGraphPackages: typeof removeDuplicateTypeGraphPackages;
};

export const typeGraphCoherence: TypeGraphCoherence = {
	alignTypeGraphOverrides,
	duplicateTypeGraphPackages,
	findInstallRoot,
	inspectTypeGraph,
	removeDuplicateTypeGraphPackages
};
