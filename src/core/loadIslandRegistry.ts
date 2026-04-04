import { resolve } from 'node:path';
import type { IslandRegistryInput } from '../../types/island';

type RegistryModuleExport = {
	default?: unknown;
	islandRegistry?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const resolveRegistryExport = (mod: RegistryModuleExport) => {
	if (isRecord(mod.islandRegistry)) return mod.islandRegistry;
	if (isRecord(mod.default)) return mod.default;

	throw new Error(
		'Island registry module must export `islandRegistry` or a default registry object.'
	);
};

const isRegistryModuleExport = (
	value: unknown
): value is RegistryModuleExport => isRecord(value);

const isIslandRegistryInput = (value: unknown): value is IslandRegistryInput =>
	isRecord(value);

export const loadIslandRegistry = async (registryPath: string) => {
	const resolvedRegistryPath = resolve(registryPath);
	const importedModule: unknown = await import(resolvedRegistryPath);
	if (!isRegistryModuleExport(importedModule)) {
		throw new Error(
			'Island registry module must export an object namespace.'
		);
	}

	const registryExport = resolveRegistryExport(importedModule);
	if (!isIslandRegistryInput(registryExport)) {
		throw new Error('Resolved island registry export is not an object.');
	}

	return registryExport;
};
