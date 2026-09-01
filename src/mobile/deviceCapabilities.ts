import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type AbsoluteDeviceCapabilityProvider = {
	factory: string;
	module: string;
	plugins?: string[];
	native?: {
		android?: { permissions: string[] };
		ios?: {
			privacyAccessedApis?: Partial<
				Record<AbsoluteIosPrivacyAccessedApi, string[]>
			>;
			pushNotifications?: true;
			systemBars?: true;
			usageDescriptions?: AbsoluteIosUsageDescription[];
		};
	};
	packages: string[];
};

export type AbsoluteIosUsageDescription =
	| 'camera'
	| 'location-always'
	| 'location-when-in-use'
	| 'photo-library'
	| 'photo-library-add';

export type AbsoluteIosPrivacyAccessedApi =
	'NSPrivacyAccessedAPICategoryFileTimestamp';

export type AbsoluteDeviceCapabilityPlan = {
	capabilities: string[];
	providers: Record<string, AbsoluteDeviceCapabilityProvider>;
	requiredPackages: string[];
};

const DEVICES_PACKAGE = '@absolutejs/devices';
export type AbsoluteDeviceProvider = 'capacitor' | 'expo';
const ADAPTERS: Record<AbsoluteDeviceProvider, string> = {
	capacitor: '@absolutejs/devices-capacitor',
	expo: '@absolutejs/devices-expo'
};
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
const providerModulePattern = (provider: AbsoluteDeviceProvider) =>
	new RegExp(`^@absolutejs/devices-${provider}/[a-z][a-z0-9-]*$`, 'u');
const providerPackagePattern = (provider: AbsoluteDeviceProvider) =>
	provider === 'capacitor'
		? /^@capacitor\/[a-z][a-z0-9-]*@\d+\.\d+\.\d+$/u
		: /^(?:expo-[a-z][a-z0-9-]*|@react-native-[a-z0-9-]+\/[a-z][a-z0-9-]*)@\d+\.\d+\.\d+$/u;
const providerLabel = (provider: AbsoluteDeviceProvider) =>
	provider === 'capacitor' ? 'Capacitor' : 'Expo';
const ANDROID_PERMISSION_PATTERN = /^android\.permission\.[A-Z][A-Z0-9_]*$/u;
const IOS_USAGE_DESCRIPTIONS: ReadonlySet<string> = new Set([
	'camera',
	'location-always',
	'location-when-in-use',
	'photo-library',
	'photo-library-add'
]);
const IOS_PRIVACY_ACCESSED_API_REASONS: Readonly<
	Record<AbsoluteIosPrivacyAccessedApi, ReadonlySet<string>>
> = {
	NSPrivacyAccessedAPICategoryFileTimestamp: new Set(['C617.1'])
};
const IOS_PRIVACY_ACCESSED_APIS: readonly AbsoluteIosPrivacyAccessedApi[] = [
	'NSPrivacyAccessedAPICategoryFileTimestamp'
];

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

const androidPermissions = (value: unknown, field: string) => {
	if (value === undefined) return undefined;
	if (!object(value)) throw new TypeError(`${field} must be an object.`);
	const { permissions } = value;
	if (
		!Array.isArray(permissions) ||
		!permissions.every(
			(permission): permission is string =>
				typeof permission === 'string' &&
				ANDROID_PERMISSION_PATTERN.test(permission)
		)
	)
		throw new TypeError(
			`${field}.permissions must contain Android permission names.`
		);

	return [...permissions];
};

const iosPrivacyAccessedApis = (value: unknown, field: string) => {
	if (value === undefined) return undefined;
	if (!object(value)) throw new TypeError(`${field} must be an object.`);
	const privacy: Partial<Record<AbsoluteIosPrivacyAccessedApi, string[]>> =
		{};
	for (const api of IOS_PRIVACY_ACCESSED_APIS) {
		const reasons = value[api];
		if (reasons === undefined) continue;
		const supported = IOS_PRIVACY_ACCESSED_API_REASONS[api];
		if (
			!Array.isArray(reasons) ||
			reasons.length === 0 ||
			!reasons.every(
				(reason): reason is string =>
					typeof reason === 'string' && supported.has(reason)
			)
		)
			throw new TypeError(
				`${field} contains an unsupported API or reason.`
			);
		privacy[api] = [...reasons];
	}
	if (
		Object.keys(value).some(
			(api) => !IOS_PRIVACY_ACCESSED_APIS.some((known) => known === api)
		)
	)
		throw new TypeError(`${field} contains an unsupported API or reason.`);

	return privacy;
};

const iosNativeRequirements = (value: unknown, field: string) => {
	if (value === undefined) return undefined;
	if (!object(value)) throw new TypeError(`${field} must be an object.`);
	const {
		privacyAccessedApis,
		pushNotifications,
		systemBars,
		usageDescriptions
	} = value;
	if (pushNotifications !== undefined && pushNotifications !== true)
		throw new TypeError(`${field}.pushNotifications must be true.`);
	if (systemBars !== undefined && systemBars !== true)
		throw new TypeError(`${field}.systemBars must be true.`);
	if (
		usageDescriptions !== undefined &&
		(!Array.isArray(usageDescriptions) ||
			!usageDescriptions.every(
				(purpose): purpose is AbsoluteIosUsageDescription =>
					typeof purpose === 'string' &&
					IOS_USAGE_DESCRIPTIONS.has(purpose)
			))
	)
		throw new TypeError(
			`${field}.usageDescriptions contains an unsupported purpose.`
		);
	const privacy = iosPrivacyAccessedApis(
		privacyAccessedApis,
		`${field}.privacyAccessedApis`
	);

	return {
		...(privacy === undefined ? {} : { privacyAccessedApis: privacy }),
		...(pushNotifications === true
			? { pushNotifications: true as const }
			: {}),
		...(systemBars === true ? { systemBars: true as const } : {}),
		...(usageDescriptions === undefined
			? {}
			: { usageDescriptions: [...usageDescriptions] })
	};
};

const parseProvider = (
	name: string,
	value: unknown,
	providerName: AbsoluteDeviceProvider
): AbsoluteDeviceCapabilityProvider => {
	if (!IDENTIFIER_PATTERN.test(name))
		throw new TypeError('Device capability names must be identifiers.');
	if (!object(value))
		throw new TypeError(`Device capability ${name} must be an object.`);
	const factory = text(value.factory, `${name}.factory`);
	const module = text(value.module, `${name}.module`);
	if (!IDENTIFIER_PATTERN.test(factory))
		throw new TypeError(`${name}.factory must be a JavaScript identifier.`);
	if (!providerModulePattern(providerName).test(module))
		throw new TypeError(
			`${name}.module must be an official devices-${providerName} subpath.`
		);
	if (
		!Array.isArray(value.packages) ||
		!value.packages.every(
			(spec): spec is string =>
				typeof spec === 'string' &&
				providerPackagePattern(providerName).test(spec)
		)
	)
		throw new TypeError(
			`${name}.packages must contain exact official ${providerLabel(providerName)} package versions.`
		);
	const { plugins } = value;
	if (
		plugins !== undefined &&
		(!Array.isArray(plugins) ||
			!plugins.every(
				(plugin): plugin is string =>
					typeof plugin === 'string' &&
					/^expo-[a-z][a-z0-9-]*$/u.test(plugin)
			))
	)
		throw new TypeError(
			`${name}.plugins must contain Expo config plugin names.`
		);
	let native: AbsoluteDeviceCapabilityProvider['native'];
	const { native: nativeMetadata } = value;
	if (nativeMetadata !== undefined) {
		if (!object(nativeMetadata))
			throw new TypeError(`${name}.native must be an object.`);
		const { android, ios } = nativeMetadata;
		const permissions = androidPermissions(
			android,
			`${name}.native.android`
		);
		const iosRequirements = iosNativeRequirements(
			ios,
			`${name}.native.ios`
		);
		native = {
			...(permissions === undefined ? {} : { android: { permissions } }),
			...(iosRequirements === undefined ? {} : { ios: iosRequirements })
		};
	}

	return {
		factory,
		module,
		...(native === undefined ? {} : { native }),
		...(plugins === undefined ? {} : { plugins: [...plugins] }),
		packages: [...value.packages]
	};
};

export const absoluteDeviceNativeRequirements = (
	plan: AbsoluteDeviceCapabilityPlan
) => {
	const privacy = plan.capabilities.reduce<
		Partial<Record<AbsoluteIosPrivacyAccessedApi, Set<string>>>
	>((requirements, name) => {
		for (const api of IOS_PRIVACY_ACCESSED_APIS) {
			const reasons =
				plan.providers[name]?.native?.ios?.privacyAccessedApis?.[api] ??
				[];
			if (reasons.length === 0) continue;
			const current = requirements[api] ?? new Set<string>();
			for (const reason of reasons) current.add(reason);
			requirements[api] = current;
		}

		return requirements;
	}, {});

	return {
		androidPermissions: [
			...new Set(
				plan.capabilities.flatMap(
					(name) =>
						plan.providers[name]?.native?.android?.permissions ?? []
				)
			)
		].sort(),
		iosPrivacyAccessedApis: IOS_PRIVACY_ACCESSED_APIS.flatMap((api) => {
			const reasons = privacy[api];

			return reasons ? [{ api, reasons: [...reasons].sort() }] : [];
		}),
		iosPushNotifications: plan.capabilities.some(
			(name) =>
				plan.providers[name]?.native?.ios?.pushNotifications === true
		),
		iosSystemBars: plan.capabilities.some(
			(name) => plan.providers[name]?.native?.ios?.systemBars === true
		),
		iosUsageDescriptions: [
			...new Set(
				plan.capabilities.flatMap(
					(name) =>
						plan.providers[name]?.native?.ios?.usageDescriptions ??
						[]
				)
			)
		].sort()
	};
};

export const loadAbsoluteDeviceCapabilityProviders = (
	projectRoot: string,
	provider: AbsoluteDeviceProvider = 'capacitor'
) => {
	const adapter = ADAPTERS[provider];
	let path = join(
		resolve(projectRoot),
		'node_modules',
		adapter,
		'package.json'
	);
	try {
		readFileSync(path, 'utf8');
	} catch {
		path = fileURLToPath(import.meta.resolve(`${adapter}/package.json`));
	}
	const manifest = readJson(path);
	const { absolutejs } = manifest;
	const devices = object(absolutejs) ? absolutejs.devices : undefined;
	if (
		!object(devices) ||
		devices.format !== 1 ||
		devices.provider !== provider ||
		!object(devices.capabilities)
	)
		throw new TypeError(
			`${adapter} does not publish supported capability metadata.`
		);

	const entries = Object.entries(devices.capabilities).map(
		([name, capability]) => ({
			name,
			provider: parseProvider(name, capability, provider)
		})
	);

	return Object.fromEntries(
		entries
			.sort((left, right) => left.name.localeCompare(right.name))
			.map(({ name, provider: capabilityProvider }) => [
				name,
				capabilityProvider
			])
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
	if (!existsSync(root)) return [];
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

/** Framework-agnostic capability discovery used by web/PWA builds. This does
 * not load a native provider manifest, so Web Push never requires Capacitor. */
export const projectImportsAbsoluteDeviceCapability = (
	projectRoot: string,
	capability: string
) => {
	const root = resolve(projectRoot);
	for (const path of SOURCE_GLOB.scanSync({ cwd: root })) {
		const portable = relative(root, resolve(root, path)).replaceAll(
			'\\',
			'/'
		);
		if (isIgnored(portable)) continue;
		const source = readFileSync(resolve(root, portable), 'utf8');
		if (importedCapabilities(source, portable).has(capability)) return true;
	}

	return false;
};

export const resolveAbsoluteDeviceCapabilityPlan = (
	projectRoot: string,
	provider: AbsoluteDeviceProvider = 'capacitor'
): AbsoluteDeviceCapabilityPlan => {
	const allProviders = loadAbsoluteDeviceCapabilityProviders(
		projectRoot,
		provider
	);
	const capabilities = discoverAbsoluteDeviceCapabilities(
		projectRoot,
		allProviders
	);
	const providers: Record<string, AbsoluteDeviceCapabilityProvider> = {};
	for (const name of capabilities) {
		const capabilityProvider = allProviders[name];
		if (capabilityProvider) providers[name] = capabilityProvider;
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
