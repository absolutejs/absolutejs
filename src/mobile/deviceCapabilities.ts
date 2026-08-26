import { readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

export type AbsoluteDeviceCapabilityProvider = {
	factory: string;
	module: string;
	packages: string[];
};

export type AbsoluteDeviceCapabilityPlan = {
	capabilities: string[];
	providers: Record<string, AbsoluteDeviceCapabilityProvider>;
	requiredPackages: string[];
};

const DEVICES_PACKAGE = '@absolutejs/devices';
const CAPACITOR_ADAPTER = '@absolutejs/devices-capacitor';
const SOURCE_GLOB = new Bun.Glob('**/*.{js,jsx,ts,tsx,svelte,vue}');
const IGNORED_DIRECTORIES = new Set([
	'.absolutejs',
	'.git',
	'.test-builds',
	'.test-shards',
	'build',
	'dist',
	'node_modules',
	'test',
	'tests'
]);
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/u;
const CAPACITOR_MODULE_PATTERN =
	/^@absolutejs\/devices-capacitor\/[a-z][a-z0-9-]*$/u;
const CAPACITOR_PACKAGE_PATTERN =
	/^@capacitor\/[a-z][a-z0-9-]*@\d+\.\d+\.\d+$/u;

const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const readJson = (path: string) => {
	const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (!object(value)) throw new TypeError(`${path} must contain an object.`);

	return value;
};

const text = (value: unknown, field: string) => {
	if (typeof value !== 'string' || value.length === 0)
		throw new TypeError(`${field} must be a non-empty string.`);

	return value;
};

const parseProvider = (
	name: string,
	value: unknown
): AbsoluteDeviceCapabilityProvider => {
	if (!IDENTIFIER_PATTERN.test(name))
		throw new TypeError('Device capability names must be identifiers.');
	if (!object(value))
		throw new TypeError(`Device capability ${name} must be an object.`);
	const factory = text(value.factory, `${name}.factory`);
	const module = text(value.module, `${name}.module`);
	if (!IDENTIFIER_PATTERN.test(factory))
		throw new TypeError(`${name}.factory must be a JavaScript identifier.`);
	if (!CAPACITOR_MODULE_PATTERN.test(module))
		throw new TypeError(
			`${name}.module must be an official devices-capacitor subpath.`
		);
	if (
		!Array.isArray(value.packages) ||
		!value.packages.every(
			(spec): spec is string =>
				typeof spec === 'string' && CAPACITOR_PACKAGE_PATTERN.test(spec)
		)
	)
		throw new TypeError(
			`${name}.packages must contain exact official Capacitor package versions.`
		);

	return { factory, module, packages: [...value.packages] };
};

export const loadAbsoluteDeviceCapabilityProviders = (projectRoot: string) => {
	const path = join(
		resolve(projectRoot),
		'node_modules',
		CAPACITOR_ADAPTER,
		'package.json'
	);
	const manifest = readJson(path);
	const { absolutejs } = manifest;
	const devices = object(absolutejs) ? absolutejs.devices : undefined;
	if (
		!object(devices) ||
		devices.format !== 1 ||
		devices.provider !== 'capacitor' ||
		!object(devices.capabilities)
	)
		throw new TypeError(
			`${CAPACITOR_ADAPTER} does not publish supported capability metadata.`
		);

	const entries = Object.entries(devices.capabilities).map(
		([name, provider]) => ({
			name,
			provider: parseProvider(name, provider)
		})
	);

	return Object.fromEntries(
		entries
			.sort((left, right) => left.name.localeCompare(right.name))
			.map(({ name, provider }) => [name, provider])
	);
};

const isIgnored = (path: string) =>
	path.split('/').some((segment) => IGNORED_DIRECTORIES.has(segment));

const importedCapabilities = (source: string, file: string) => {
	const names = new Set<string>();
	const namespaces = new Set<string>();
	const visit = (node: ts.Node) => {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			node.moduleSpecifier.text === DEVICES_PACKAGE &&
			!node.importClause?.isTypeOnly
		) {
			const bindings = node.importClause?.namedBindings;
			if (bindings && ts.isNamedImports(bindings))
				for (const element of bindings.elements)
					if (!element.isTypeOnly)
						names.add((element.propertyName ?? element.name).text);
			if (bindings && ts.isNamespaceImport(bindings))
				namespaces.add(bindings.name.text);
		}
		if (
			ts.isExportDeclaration(node) &&
			!node.isTypeOnly &&
			node.moduleSpecifier !== undefined &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			node.moduleSpecifier.text === DEVICES_PACKAGE &&
			node.exportClause &&
			ts.isNamedExports(node.exportClause)
		)
			for (const element of node.exportClause.elements)
				if (!element.isTypeOnly)
					names.add((element.propertyName ?? element.name).text);
		if (
			ts.isPropertyAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			namespaces.has(node.expression.text)
		)
			names.add(node.name.text);
		ts.forEachChild(node, visit);
	};
	const extension = extname(file).toLowerCase();
	const sources =
		extension === '.svelte' || extension === '.vue'
			? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)]
					.map((match) => match[1])
					.filter((value): value is string => value !== undefined)
			: [source];
	for (const [index, script] of sources.entries())
		visit(
			ts.createSourceFile(
				`${file}#script-${index}`,
				script,
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TSX
			)
		);

	return names;
};

export const assertAbsoluteDeviceCapabilityPackages = (
	projectRoot: string,
	plan: AbsoluteDeviceCapabilityPlan
) => {
	const missing = missingAbsoluteDeviceCapabilityPackages(
		plan,
		directAbsoluteProjectPackages(projectRoot)
	);
	const mismatched = plan.requiredPackages.filter((spec) => {
		const separator = spec.lastIndexOf('@');
		const packageName = spec.slice(0, separator);
		if (missing.includes(spec)) return false;
		try {
			return (
				readJson(
					join(
						resolve(projectRoot),
						'node_modules',
						packageName,
						'package.json'
					)
				).version !== spec.slice(separator + 1)
			);
		} catch {
			return true;
		}
	});
	const unmet = [...missing, ...mismatched];
	if (unmet.length > 0)
		throw new TypeError(
			`Device capabilities ${plan.capabilities.join(', ')} require ${unmet.join(', ')}. Run absolute mobile sync and approve the detected capability plugins.`
		);
};

export const directAbsoluteProjectPackages = (projectRoot: string) => {
	const manifest = readJson(join(resolve(projectRoot), 'package.json'));
	const packages = new Set<string>();
	for (const field of ['dependencies', 'devDependencies']) {
		const dependencies = manifest[field];
		if (object(dependencies))
			for (const name of Object.keys(dependencies)) packages.add(name);
	}

	return packages;
};

export const discoverAbsoluteDeviceCapabilities = (
	projectRoot: string,
	providers = loadAbsoluteDeviceCapabilityProviders(projectRoot)
) => {
	const root = resolve(projectRoot);
	const known = new Set(Object.keys(providers));
	const capabilities = new Set<string>();
	for (const path of SOURCE_GLOB.scanSync({ cwd: root })) {
		const portable = relative(root, resolve(root, path)).replaceAll(
			'\\',
			'/'
		);
		if (isIgnored(portable)) continue;
		const source = readFileSync(resolve(root, portable), 'utf8');
		for (const name of importedCapabilities(source, portable))
			if (known.has(name)) capabilities.add(name);
	}

	return [...capabilities].sort();
};

export const missingAbsoluteDeviceCapabilityPackages = (
	plan: AbsoluteDeviceCapabilityPlan,
	directPackages: ReadonlySet<string>
) =>
	plan.requiredPackages.filter((spec) => {
		const packageName = spec.slice(0, spec.lastIndexOf('@'));

		return !directPackages.has(packageName);
	});

export const resolveAbsoluteDeviceCapabilityPlan = (
	projectRoot: string
): AbsoluteDeviceCapabilityPlan => {
	const allProviders = loadAbsoluteDeviceCapabilityProviders(projectRoot);
	const capabilities = discoverAbsoluteDeviceCapabilities(
		projectRoot,
		allProviders
	);
	const providers: Record<string, AbsoluteDeviceCapabilityProvider> = {};
	for (const name of capabilities) {
		const provider = allProviders[name];
		if (provider) providers[name] = provider;
	}

	return {
		capabilities,
		providers,
		requiredPackages: [
			...new Set(
				capabilities.flatMap((name) => providers[name]?.packages ?? [])
			)
		].sort()
	};
};
