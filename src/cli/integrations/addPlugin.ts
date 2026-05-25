import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installPackages } from '../add/dependencies';
import { applyAbsoluteConfigEdit } from '../config/absolute/editAbsoluteConfig';
import { readAbsoluteConfigValues } from '../config/absolute/resolveAbsoluteConfig';
import { findIntegration, INTEGRATIONS, type IntegrationWiring } from './catalog';
import type {
	IntegrationAddResult,
	IntegrationItem,
	IntegrationsPanelState
} from '../../../types/integrationsPanel';

type AddOptions = {
	install?: boolean;
	override?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const readPackageJson = (cwd: string) => {
	const path = join(cwd, 'package.json');
	if (!existsSync(path)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));

		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

const addGroupKeys = (group: unknown, names: Set<string>) => {
	if (!isRecord(group)) return;
	for (const name of Object.keys(group)) names.add(name);
};

// Names of every dependency declared in the project's package.json.
const declaredDeps = (cwd: string) => {
	const names = new Set<string>();
	const pkg = readPackageJson(cwd);
	if (!pkg) return names;
	for (const field of ['dependencies', 'devDependencies']) {
		addGroupKeys(pkg[field], names);
	}

	return names;
};

const snippetFor = (wiring: IntegrationWiring) =>
	wiring.kind === 'use' ? `${wiring.importLine}\n${wiring.useLine}` : null;

const toItem = (
	meta: (typeof INTEGRATIONS)[number],
	deps: Set<string>,
	current: Record<string, unknown>
): IntegrationItem => {
	const installed = meta.packages.every((pkg) => deps.has(pkg));
	const enabled =
		meta.wiring.kind === 'config'
			? current[meta.wiring.field] === true
			: installed;

	return {
		blurb: meta.blurb,
		enabled,
		id: meta.id,
		installed,
		kind: meta.wiring.kind,
		label: meta.label,
		note: meta.note ?? null,
		packages: meta.packages,
		wiringSnippet: snippetFor(meta.wiring)
	};
};

export const resolveIntegrationsState = (
	cwd: string,
	override?: string
): IntegrationsPanelState => {
	const deps = declaredDeps(cwd);
	const { configPath, current } = readAbsoluteConfigValues(cwd, override);

	return {
		configPath,
		items: INTEGRATIONS.map((meta) => toItem(meta, deps, current))
	};
};

const baseMessage = (
	meta: (typeof INTEGRATIONS)[number],
	willInstall: boolean,
	installOk: boolean
) => {
	if (!installOk) {
		return `Couldn't install ${meta.packages.join(', ')} — run \`bun add\` manually.`;
	}
	if (willInstall) return `Installed ${meta.label}.`;
	if (meta.packages.length > 0) {
		return `Skipped install (--no-install) for ${meta.label}.`;
	}

	return `${meta.label} is built in — no install needed.`;
};

const failure = (message: string): IntegrationAddResult => ({
	installed: false,
	item: null,
	message,
	ok: false,
	wired: false,
	wiringSnippet: null
});

export const addIntegration = (
	cwd: string,
	id: string,
	options: AddOptions = {}
): IntegrationAddResult => {
	const meta = findIntegration(id);
	if (!meta) return failure(`Unknown integration "${id}".`);

	const install = options.install ?? true;
	const willInstall = install && meta.packages.length > 0;
	const installOk = willInstall ? installPackages(cwd, meta.packages) : true;

	const { configPath } = readAbsoluteConfigValues(cwd, options.override);
	let wired = false;
	let message = baseMessage(meta, willInstall, installOk);

	if (meta.wiring.kind === 'config') {
		if (!configPath) return failure('No absolute.config.ts found.');
		const edit = applyAbsoluteConfigEdit(configPath, {
			name: meta.wiring.field,
			value: true
		});
		wired = edit.ok;
		message = edit.ok
			? `Enabled ${meta.label} in absolute.config.ts.`
			: `Installed, but couldn't edit config: ${edit.message}`;
	}

	const state = resolveIntegrationsState(cwd, options.override);
	const item = state.items.find((entry) => entry.id === id) ?? null;

	return {
		installed: item?.installed ?? installOk,
		item,
		message,
		ok: true,
		wired,
		wiringSnippet: item?.wiringSnippet ?? snippetFor(meta.wiring)
	};
};
