import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
	resolveSyncLocalSchemaComponents,
	type SyncLocalCollectionMigrationOperation,
	type SyncLocalCollectionPolicy,
	type SyncLocalConflictPolicy,
	type SyncLocalDataPolicy,
	type SyncLocalJsonValue,
	type SyncLocalMutationPolicy,
	type SyncLocalStoreMigration,
	type SyncLocalStoreSchemaBundle,
	type SyncLocalStoreSchemaComponent
} from '@absolutejs/sync/client';

export type AbsoluteSyncSchemaDiscovery = {
	components: SyncLocalStoreSchemaBundle['components'];
	sources: { id: string; manifestPath: string }[];
};

// A predicate annotation is required so parsed package JSON remains `unknown`
// until every object boundary has been checked.
const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const manifestAt = (path: string) => {
	try {
		const value: unknown = JSON.parse(readFileSync(path, 'utf8'));

		return object(value) ? value : undefined;
	} catch {
		return undefined;
	}
};

const localSchemaMetadata = (manifest: object) => {
	const absolutejs = Reflect.get(manifest, 'absolutejs');
	if (!object(absolutejs)) return undefined;
	const sync = Reflect.get(absolutejs, 'sync');
	if (!object(sync)) return undefined;

	return Reflect.get(sync, 'localSchema');
};

const packageManifestPath = (projectRoot: string, packageName: string) => {
	let directory = resolve(projectRoot);
	while (true) {
		const candidate = join(
			directory,
			'node_modules',
			packageName,
			'package.json'
		);
		const manifest = manifestAt(candidate);
		if (manifest && Reflect.get(manifest, 'name') === packageName)
			return candidate;
		const parent = dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
};

const metadataError = (id: string, detail: string) =>
	new TypeError(
		`Invalid AbsoluteJS Sync schema metadata for ${id}: ${detail}`
	);

const positiveVersion = (value: unknown, id: string, field: string) => {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
		throw metadataError(id, `${field} must be a positive safe integer.`);

	return value;
};

const nonEmpty = (value: unknown, id: string, field: string) => {
	if (
		typeof value !== 'string' ||
		value.trim() !== value ||
		value.length === 0
	)
		throw metadataError(id, `${field} must be a non-empty trimmed string.`);

	return value;
};

const requireObject = (value: unknown, id: string, detail: string) => {
	if (!object(value)) throw metadataError(id, detail);

	return value;
};

const unknownField = (record: Record<string, unknown>, key: string) =>
	record[key];

const normalizeJsonValue: (
	value: unknown,
	id: string,
	field: string
) => SyncLocalJsonValue = (value, id, field) => {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean'
	)
		return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (Array.isArray(value))
		return value.map((entry) => normalizeJsonValue(entry, id, field));
	if (object(value))
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				normalizeJsonValue(entry, id, field)
			])
		);

	throw metadataError(id, `${field} must be JSON-safe.`);
};

const operation: (
	value: unknown,
	id: string,
	index: number
) => SyncLocalCollectionMigrationOperation = (value, id, index) => {
	const record = requireObject(
		value,
		id,
		`migration operation ${index} must be an object.`
	);
	const type = Reflect.get(record, 'type');
	const collection = nonEmpty(
		Reflect.get(record, 'collection'),
		id,
		`operation ${index}.collection`
	);
	if (type === 'delete-collection') return { collection, type };
	if (type === 'rename-field')
		return {
			collection,
			from: nonEmpty(
				Reflect.get(record, 'from'),
				id,
				`operation ${index}.from`
			),
			to: nonEmpty(
				Reflect.get(record, 'to'),
				id,
				`operation ${index}.to`
			),
			type
		};
	const field = nonEmpty(
		Reflect.get(record, 'field'),
		id,
		`operation ${index}.field`
	);
	if (type === 'remove-field') return { collection, field, type };
	if (type === 'set-default')
		return {
			collection,
			field,
			type,
			value: normalizeJsonValue(
				Reflect.get(record, 'value'),
				id,
				`operation ${index}.value`
			)
		};

	throw metadataError(id, `operation ${index}.type is not supported.`);
};

const migration: (
	value: unknown,
	id: string,
	index: number
) => SyncLocalStoreMigration = (value, id, index) => {
	const record = requireObject(
		value,
		id,
		`migration ${index} must be an object.`
	);
	const allowed = new Set(['operations', 'toVersion']);
	const unsupported = Object.keys(record).find((key) => !allowed.has(key));
	if (unsupported)
		throw metadataError(
			id,
			`migration ${index}.${unsupported} is not declarative metadata.`
		);
	const declaredOperations = Reflect.get(record, 'operations');
	if (declaredOperations !== undefined && !Array.isArray(declaredOperations))
		throw metadataError(
			id,
			`migration ${index}.operations must be an array.`
		);
	const operations = Array.isArray(declaredOperations)
		? declaredOperations
		: [];

	return {
		operations: operations.map((entry, operationIndex) =>
			operation(entry, id, operationIndex)
		),
		toVersion: positiveVersion(
			Reflect.get(record, 'toVersion'),
			id,
			`migration ${index}.toVersion`
		)
	};
};

const localDataPolicy = (value: unknown, id: string): SyncLocalDataPolicy => {
	const record = requireObject(value, id, 'localData must be an object.');
	const allowed = new Set([
		'collections',
		'maxBytesPerNamespace',
		'mutations'
	]);
	const unsupported = Object.keys(record).find((key) => !allowed.has(key));
	if (unsupported)
		throw metadataError(id, `localData.${unsupported} is not supported.`);
	const collectionRules = Reflect.get(record, 'collections');
	const mutationRules = Reflect.get(record, 'mutations');
	if (collectionRules !== undefined && !Array.isArray(collectionRules))
		throw metadataError(id, 'localData.collections must be an array.');
	if (mutationRules !== undefined && !Array.isArray(mutationRules))
		throw metadataError(id, 'localData.mutations must be an array.');
	const collections: SyncLocalCollectionPolicy[] | undefined = Array.isArray(
		collectionRules
	)
		? collectionRules.map((entry, index) => {
				const rule = requireObject(
					entry,
					id,
					`localData.collections[${index}] must be an object.`
				);
				const allowedRuleKeys = new Set([
					'evictionPriority',
					'match',
					'maxAgeMs',
					'onProtectionUnavailable',
					'persistence',
					'protection',
					'sensitivity'
				]);
				const unsupportedRuleKey = Object.keys(rule).find(
					(key) => !allowedRuleKeys.has(key)
				);
				if (unsupportedRuleKey)
					throw metadataError(
						id,
						`localData.collections[${index}].${unsupportedRuleKey} is not supported.`
					);
				const match = nonEmpty(
					Reflect.get(rule, 'match'),
					id,
					`localData.collections[${index}].match`
				);
				const persistence = unknownField(rule, 'persistence');
				const sensitivity = unknownField(rule, 'sensitivity');
				const protection = unknownField(rule, 'protection');
				const onProtectionUnavailable = unknownField(
					rule,
					'onProtectionUnavailable'
				);
				const evictionPriority = unknownField(rule, 'evictionPriority');
				const maxAge = unknownField(rule, 'maxAgeMs');
				if (
					persistence !== undefined &&
					persistence !== 'durable' &&
					persistence !== 'memory-only'
				)
					throw metadataError(
						id,
						`localData.collections[${index}].persistence is invalid.`
					);
				if (
					sensitivity !== undefined &&
					sensitivity !== 'public' &&
					sensitivity !== 'private' &&
					sensitivity !== 'secret'
				)
					throw metadataError(
						id,
						`localData.collections[${index}].sensitivity is invalid.`
					);
				if (
					protection !== undefined &&
					protection !== 'none' &&
					protection !== 'required'
				)
					throw metadataError(
						id,
						`localData.collections[${index}].protection is invalid.`
					);
				if (
					onProtectionUnavailable !== undefined &&
					onProtectionUnavailable !== 'error' &&
					onProtectionUnavailable !== 'memory-only'
				)
					throw metadataError(
						id,
						`localData.collections[${index}].onProtectionUnavailable is invalid.`
					);
				if (
					evictionPriority !== undefined &&
					evictionPriority !== 'critical' &&
					evictionPriority !== 'normal' &&
					evictionPriority !== 'disposable'
				)
					throw metadataError(
						id,
						`localData.collections[${index}].evictionPriority is invalid.`
					);

				return {
					match,
					...(sensitivity ? { sensitivity } : {}),
					...(persistence ? { persistence } : {}),
					...(protection ? { protection } : {}),
					...(onProtectionUnavailable
						? {
								onProtectionUnavailable: onProtectionUnavailable
							}
						: {}),
					...(evictionPriority ? { evictionPriority } : {}),
					...(maxAge === undefined
						? {}
						: {
								maxAgeMs: positiveVersion(
									maxAge,
									id,
									`localData.collections[${index}].maxAgeMs`
								)
							})
				};
			})
		: undefined;
	const mutations: SyncLocalMutationPolicy[] | undefined = Array.isArray(
		mutationRules
	)
		? mutationRules.map((entry, index) => {
				const rule = requireObject(
					entry,
					id,
					`localData.mutations[${index}] must be an object.`
				);
				const allowedRuleKeys = new Set([
					'conflict',
					'match',
					'onProtectionUnavailable',
					'persistence',
					'protection',
					'sensitivity'
				]);
				const unsupportedRuleKey = Object.keys(rule).find(
					(key) => !allowedRuleKeys.has(key)
				);
				if (unsupportedRuleKey)
					throw metadataError(
						id,
						`localData.mutations[${index}].${unsupportedRuleKey} is not supported.`
					);
				const protection = unknownField(rule, 'protection');
				const sensitivity = unknownField(rule, 'sensitivity');
				const persistence = unknownField(rule, 'persistence');
				const onProtectionUnavailable = unknownField(
					rule,
					'onProtectionUnavailable'
				);
				const declaredConflict = unknownField(rule, 'conflict');
				let conflict: SyncLocalConflictPolicy | undefined;
				if (declaredConflict !== undefined) {
					const conflictRecord = requireObject(
						declaredConflict,
						id,
						`localData.mutations[${index}].conflict must be an object.`
					);
					const unsupportedConflictKey = Object.keys(
						conflictRecord
					).find(
						(key) => key !== 'maxAttempts' && key !== 'strategy'
					);
					if (unsupportedConflictKey)
						throw metadataError(
							id,
							`localData.mutations[${index}].conflict.${unsupportedConflictKey} is not supported.`
						);
					const strategy = unknownField(conflictRecord, 'strategy');
					if (
						strategy !== 'client-wins' &&
						strategy !== 'manual' &&
						strategy !== 'server-wins'
					)
						throw metadataError(
							id,
							`localData.mutations[${index}].conflict.strategy is invalid.`
						);
					const maxAttempts = unknownField(
						conflictRecord,
						'maxAttempts'
					);
					if (maxAttempts !== undefined && strategy !== 'client-wins')
						throw metadataError(
							id,
							`localData.mutations[${index}].conflict.maxAttempts requires client-wins.`
						);
					conflict = {
						strategy,
						...(maxAttempts === undefined
							? {}
							: {
									maxAttempts: positiveVersion(
										maxAttempts,
										id,
										`localData.mutations[${index}].conflict.maxAttempts`
									)
								})
					};
				}
				if (
					protection !== undefined &&
					protection !== 'none' &&
					protection !== 'required'
				)
					throw metadataError(
						id,
						`localData.mutations[${index}].protection is invalid.`
					);
				if (
					sensitivity !== undefined &&
					sensitivity !== 'public' &&
					sensitivity !== 'private' &&
					sensitivity !== 'secret'
				)
					throw metadataError(
						id,
						`localData.mutations[${index}].sensitivity is invalid.`
					);
				if (
					onProtectionUnavailable !== undefined &&
					onProtectionUnavailable !== 'error' &&
					onProtectionUnavailable !== 'memory-only'
				)
					throw metadataError(
						id,
						`localData.mutations[${index}].onProtectionUnavailable is invalid.`
					);
				if (
					persistence !== undefined &&
					persistence !== 'durable' &&
					persistence !== 'memory-only'
				)
					throw metadataError(
						id,
						`localData.mutations[${index}].persistence is invalid.`
					);

				return {
					match: nonEmpty(
						Reflect.get(rule, 'match'),
						id,
						`localData.mutations[${index}].match`
					),
					...(conflict ? { conflict } : {}),
					...(sensitivity ? { sensitivity } : {}),
					...(onProtectionUnavailable
						? { onProtectionUnavailable }
						: {}),
					...(persistence
						? {
								persistence: persistence
							}
						: {}),
					...(protection ? { protection: protection } : {})
				};
			})
		: undefined;
	const quota = Reflect.get(record, 'maxBytesPerNamespace');

	return {
		...(collections ? { collections } : {}),
		...(mutations ? { mutations } : {}),
		...(quota === undefined
			? {}
			: {
					maxBytesPerNamespace: positiveVersion(
						quota,
						id,
						'localData.maxBytesPerNamespace'
					)
				})
	};
};

const component: (
	id: string,
	value: unknown
) => SyncLocalStoreSchemaComponent = (id, value) => {
	const record = requireObject(value, id, 'localSchema must be an object.');
	const allowed = new Set([
		'localData',
		'migrations',
		'minimumCompatibleVersion',
		'version'
	]);
	const unsupported = Object.keys(record).find((key) => !allowed.has(key));
	if (unsupported)
		throw metadataError(id, `${unsupported} is not supported.`);
	const version = positiveVersion(
		Reflect.get(record, 'version'),
		id,
		'version'
	);
	const declaredMinimum = Reflect.get(record, 'minimumCompatibleVersion');
	const minimumCompatibleVersion =
		declaredMinimum === undefined
			? Math.max(1, version - 2)
			: positiveVersion(declaredMinimum, id, 'minimumCompatibleVersion');
	const declaredMigrations = Reflect.get(record, 'migrations');
	const declaredLocalData = Reflect.get(record, 'localData');
	if (declaredMigrations !== undefined && !Array.isArray(declaredMigrations))
		throw metadataError(id, 'migrations must be an array.');
	const migrations = Array.isArray(declaredMigrations)
		? declaredMigrations
		: undefined;

	return {
		id,
		...(declaredLocalData === undefined
			? {}
			: { localData: localDataPolicy(declaredLocalData, id) }),
		minimumCompatibleVersion,
		...(Array.isArray(migrations)
			? {
					migrations: migrations.map((entry, index) =>
						migration(entry, id, index)
					)
				}
			: {}),
		version
	};
};

const dependencyNames = (manifest: object) =>
	[
		Reflect.get(manifest, 'dependencies'),
		Reflect.get(manifest, 'optionalDependencies'),
		Reflect.get(manifest, 'devDependencies'),
		Reflect.get(manifest, 'peerDependencies')
	]
		.flatMap((dependencies) =>
			object(dependencies) ? Object.keys(dependencies) : []
		)
		.filter((name, index, names) => names.indexOf(name) === index)
		.sort();

export const discoverAbsoluteSyncSchema = (
	projectRoot: string
): AbsoluteSyncSchemaDiscovery => {
	const appManifestPath = join(resolve(projectRoot), 'package.json');
	const appManifest = manifestAt(appManifestPath);
	if (!appManifest)
		return {
			components: [
				{
					id: '@absolutejs/app',
					minimumCompatibleVersion: 1,
					version: 1
				}
			],
			sources: []
		};
	const appMetadata = localSchemaMetadata(appManifest);
	const components: SyncLocalStoreSchemaComponent[] = [
		appMetadata === undefined
			? { id: '@absolutejs/app', minimumCompatibleVersion: 1, version: 1 }
			: component('@absolutejs/app', appMetadata)
	];
	const sources: AbsoluteSyncSchemaDiscovery['sources'] = [
		{ id: '@absolutejs/app', manifestPath: appManifestPath }
	];
	for (const name of dependencyNames(appManifest)) {
		const manifestPath = packageManifestPath(projectRoot, name);
		if (!manifestPath) continue;
		const manifest = manifestAt(manifestPath);
		if (!manifest) continue;
		const metadata = localSchemaMetadata(manifest);
		if (metadata === undefined) continue;
		components.push(component(name, metadata));
		sources.push({ id: name, manifestPath });
	}
	components.sort((left, right) => left.id.localeCompare(right.id));
	sources.sort((left, right) => left.id.localeCompare(right.id));
	resolveSyncLocalSchemaComponents({}, { components });

	return { components, sources };
};
