import { createHash } from 'node:crypto';
import type {
	AbsoluteMobilePageClient,
	AbsoluteMobilePageFramework,
	AbsoluteMobileUpgradeRequiredResult
} from './pageProtocol';

export const ABSOLUTE_MOBILE_COMPATIBILITY_FORMAT = 1 as const;
export const ABSOLUTE_MOBILE_RETAINED_GENERATIONS = 3;

export type AbsoluteMobileCompatibilityPage = {
	bundleHash: string;
	bundlePath: string;
	contract: string;
	framework: AbsoluteMobilePageFramework;
	pageId: string;
	propsSchemaHash: string;
};

export type AbsoluteMobileCompatibilityRoute = {
	method: 'GET' | 'HEAD';
	pageId: string;
	pattern: string;
};

export type AbsoluteMobileCompatibilityProducer = {
	bundleHash: string;
	bytes: number;
	exportName: string;
	module: string;
};

export type AbsoluteMobileCompatibilityArtifactInput = {
	appBuild: string;
	appId: string;
	generation: number;
	pages: readonly AbsoluteMobileCompatibilityPage[];
	producer: AbsoluteMobileCompatibilityProducer;
	routes: readonly AbsoluteMobileCompatibilityRoute[];
	runtime: string;
};

export type AbsoluteMobileCompatibilityArtifact = {
	appBuild: string;
	appId: string;
	format: typeof ABSOLUTE_MOBILE_COMPATIBILITY_FORMAT;
	generation: number;
	pages: AbsoluteMobileCompatibilityPage[];
	producer: AbsoluteMobileCompatibilityProducer;
	releaseId: string;
	routes: AbsoluteMobileCompatibilityRoute[];
	runtime: string;
};

export type AbsoluteMobileResolvedRelease =
	| {
			artifact: AbsoluteMobileCompatibilityArtifact;
			kind: 'retained';
			page: AbsoluteMobileCompatibilityPage;
	  }
	| {
			kind: 'upgrade-required';
			result: AbsoluteMobileUpgradeRequiredResult;
	  };

type CanonicalRecord = Record<string, unknown>;
type CanonicalValueNormalizer = (
	value: unknown,
	ancestors: Set<object>
) => unknown;
type CompatibilityArtifactContent = Omit<
	AbsoluteMobileCompatibilityArtifact,
	'releaseId'
>;

const SHA_256 = 'sha256';
const RELEASE_ID_PREFIX = 'amc_';
const MODULE_SEGMENT_PARENT = '..';
const EXPORT_NAME_PATTERN = /^[A-Z_a-z]\w*$/;
const frameworks = new Set<string>([
	'angular',
	'ember',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
]);

const isCanonicalRecord = (value: unknown): value is CanonicalRecord => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}

	const prototype: unknown = Object.getPrototypeOf(value);

	return prototype === Object.prototype || prototype === null;
};

const enterCanonicalValue = (value: object, ancestors: Set<object>) => {
	if (ancestors.has(value)) {
		throw new TypeError('Compatibility metadata cannot contain cycles.');
	}
	ancestors.add(value);
};

const normalizeCanonicalArray = (value: unknown[], ancestors: Set<object>) => {
	enterCanonicalValue(value, ancestors);
	const normalized = value.map((item) =>
		normalizeCanonicalValue(item, ancestors)
	);
	ancestors.delete(value);

	return normalized;
};

const normalizeCanonicalRecord = (
	value: CanonicalRecord,
	ancestors: Set<object>
) => {
	enterCanonicalValue(value, ancestors);
	const normalized = Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [
				key,
				normalizeCanonicalValue(item, ancestors)
			])
	);
	ancestors.delete(value);

	return normalized;
};

const normalizeCanonicalValue: CanonicalValueNormalizer = (
	value,
	ancestors
) => {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean'
	) {
		return value;
	}
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (Array.isArray(value)) return normalizeCanonicalArray(value, ancestors);
	if (isCanonicalRecord(value)) {
		return normalizeCanonicalRecord(value, ancestors);
	}

	throw new TypeError(
		'Compatibility metadata must contain only finite JSON values.'
	);
};

const canonicalJson = (value: unknown) =>
	JSON.stringify(normalizeCanonicalValue(value, new Set<object>()));

const hashCanonicalValue = (value: unknown) =>
	createHash(SHA_256).update(canonicalJson(value)).digest('hex');

const requireNonEmpty = (value: string, field: string) => {
	if (!value.trim()) {
		throw new TypeError(`${field} must not be empty.`);
	}

	return value;
};

const isPageFramework = (
	value: unknown
): value is AbsoluteMobilePageFramework =>
	typeof value === 'string' && frameworks.has(value);

const readString = (value: unknown, field: string) => {
	if (typeof value !== 'string') {
		throw new TypeError(`${field} must be a string.`);
	}

	return value;
};

const parseCompatibilityPage = (value: unknown) => {
	if (!isCanonicalRecord(value) || !isPageFramework(value.framework)) {
		throw new TypeError('Compatibility artifact contains an invalid page.');
	}

	return {
		bundleHash: readString(value.bundleHash, 'page.bundleHash'),
		bundlePath: readString(value.bundlePath, 'page.bundlePath'),
		contract: readString(value.contract, 'page.contract'),
		framework: value.framework,
		pageId: readString(value.pageId, 'page.pageId'),
		propsSchemaHash: readString(
			value.propsSchemaHash,
			'page.propsSchemaHash'
		)
	} satisfies AbsoluteMobileCompatibilityPage;
};

const parseCompatibilityRoute = (value: unknown) => {
	if (
		!isCanonicalRecord(value) ||
		(value.method !== 'GET' && value.method !== 'HEAD')
	) {
		throw new TypeError(
			'Compatibility artifact contains an invalid route.'
		);
	}

	return {
		method: value.method,
		pageId: readString(value.pageId, 'route.pageId'),
		pattern: readString(value.pattern, 'route.pattern')
	} satisfies AbsoluteMobileCompatibilityRoute;
};

const parseCompatibilityProducer = (value: unknown) => {
	if (!isCanonicalRecord(value) || typeof value.bytes !== 'number') {
		throw new TypeError(
			'Compatibility artifact contains an invalid producer.'
		);
	}

	return {
		bundleHash: readString(value.bundleHash, 'producer.bundleHash'),
		bytes: value.bytes,
		exportName: readString(value.exportName, 'producer.exportName'),
		module: readString(value.module, 'producer.module')
	} satisfies AbsoluteMobileCompatibilityProducer;
};

const validateProducerModule = (module: string) => {
	requireNonEmpty(module, 'producer.module');
	const segments = module.split('/');
	if (
		module.startsWith('/') ||
		module.includes('\\') ||
		segments.includes(MODULE_SEGMENT_PARENT)
	) {
		throw new TypeError('producer.module must be a safe relative path.');
	}

	return module;
};

const normalizePage = (
	page: AbsoluteMobileCompatibilityPage
): AbsoluteMobileCompatibilityPage => ({
	bundleHash: requireNonEmpty(page.bundleHash, 'page.bundleHash'),
	bundlePath: requireNonEmpty(page.bundlePath, 'page.bundlePath'),
	contract: requireNonEmpty(page.contract, 'page.contract'),
	framework: page.framework,
	pageId: requireNonEmpty(page.pageId, 'page.pageId'),
	propsSchemaHash: requireNonEmpty(
		page.propsSchemaHash,
		'page.propsSchemaHash'
	)
});

const normalizeRoute = (
	route: AbsoluteMobileCompatibilityRoute
): AbsoluteMobileCompatibilityRoute => {
	if (!route.pattern.startsWith('/')) {
		throw new TypeError('route.pattern must start with /.');
	}

	return {
		method: route.method,
		pageId: requireNonEmpty(route.pageId, 'route.pageId'),
		pattern: route.pattern
	};
};

const assertUnique = (values: string[], field: string) => {
	if (new Set(values).size !== values.length) {
		throw new TypeError(`${field} values must be unique.`);
	}
};

const normalizeArtifactContent = (
	input: AbsoluteMobileCompatibilityArtifactInput
): CompatibilityArtifactContent => {
	if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
		throw new TypeError('generation must be a positive safe integer.');
	}
	if (
		!Number.isSafeInteger(input.producer.bytes) ||
		input.producer.bytes < 1
	) {
		throw new TypeError('producer.bytes must be a positive safe integer.');
	}

	const pages = input.pages
		.map(normalizePage)
		.sort((left, right) => left.pageId.localeCompare(right.pageId));
	const routes = input.routes
		.map(normalizeRoute)
		.sort((left, right) =>
			`${left.pattern}:${left.method}`.localeCompare(
				`${right.pattern}:${right.method}`
			)
		);
	assertUnique(
		pages.map(({ pageId }) => pageId),
		'page.pageId'
	);
	assertUnique(
		routes.map(({ method, pattern }) => `${method}:${pattern}`),
		'route method and pattern'
	);
	const pageIds = new Set(pages.map(({ pageId }) => pageId));
	const missingPage = routes.find(({ pageId }) => !pageIds.has(pageId));
	if (missingPage) {
		throw new TypeError(
			`Route ${missingPage.pattern} references unknown page ${missingPage.pageId}.`
		);
	}
	if (!EXPORT_NAME_PATTERN.test(input.producer.exportName)) {
		throw new TypeError(
			'producer.exportName must be a JavaScript identifier.'
		);
	}

	return {
		appBuild: requireNonEmpty(input.appBuild, 'appBuild'),
		appId: requireNonEmpty(input.appId, 'appId'),
		format: ABSOLUTE_MOBILE_COMPATIBILITY_FORMAT,
		generation: input.generation,
		pages,
		producer: {
			bundleHash: requireNonEmpty(
				input.producer.bundleHash,
				'producer.bundleHash'
			),
			bytes: input.producer.bytes,
			exportName: input.producer.exportName,
			module: validateProducerModule(input.producer.module)
		},
		routes,
		runtime: requireNonEmpty(input.runtime, 'runtime')
	};
};

export const createAbsoluteMobileCompatibilityArtifact = (
	input: AbsoluteMobileCompatibilityArtifactInput
) => {
	const content = normalizeArtifactContent(input);

	return {
		...content,
		releaseId: `${RELEASE_ID_PREFIX}${hashCanonicalValue(content)}`
	} satisfies AbsoluteMobileCompatibilityArtifact;
};

export const hashAbsoluteMobilePropsSchema = (schema: unknown) =>
	hashCanonicalValue(schema);

export const parseAbsoluteMobileCompatibilityArtifact = (value: unknown) => {
	if (
		!isCanonicalRecord(value) ||
		value.format !== ABSOLUTE_MOBILE_COMPATIBILITY_FORMAT ||
		typeof value.generation !== 'number' ||
		!Array.isArray(value.pages) ||
		!Array.isArray(value.routes)
	) {
		throw new TypeError('Invalid mobile compatibility artifact.');
	}

	const releaseId = readString(value.releaseId, 'releaseId');
	const artifact = createAbsoluteMobileCompatibilityArtifact({
		appBuild: readString(value.appBuild, 'appBuild'),
		appId: readString(value.appId, 'appId'),
		generation: value.generation,
		pages: value.pages.map(parseCompatibilityPage),
		producer: parseCompatibilityProducer(value.producer),
		routes: value.routes.map(parseCompatibilityRoute),
		runtime: readString(value.runtime, 'runtime')
	});
	if (artifact.releaseId !== releaseId) {
		throw new TypeError('Mobile compatibility artifact integrity failed.');
	}

	return artifact;
};

export const resolveAbsoluteMobileCompatibilityRelease = (
	client: AbsoluteMobilePageClient,
	artifacts: readonly AbsoluteMobileCompatibilityArtifact[]
): AbsoluteMobileResolvedRelease => {
	const artifact = artifacts.find(
		(candidate) =>
			candidate.appBuild === client.appBuild &&
			candidate.runtime === client.runtime
	);
	if (!artifact) {
		return {
			kind: 'upgrade-required',
			result: {
				kind: 'upgrade-required',
				pageId: client.pageId,
				reason: 'app-release'
			}
		};
	}

	const page = artifact.pages.find(
		(candidate) =>
			candidate.pageId === client.pageId &&
			candidate.bundleHash === client.pageBundle &&
			client.pageContracts.includes(candidate.contract)
	);
	if (!page) {
		return {
			kind: 'upgrade-required',
			result: {
				kind: 'upgrade-required',
				pageId: client.pageId,
				reason: 'page-contract',
				supportedContracts: artifact.pages
					.filter(({ pageId }) => pageId === client.pageId)
					.map(({ contract }) => contract)
			}
		};
	}

	return { artifact, kind: 'retained', page };
};

export const retainAbsoluteMobileCompatibilityArtifacts = (
	artifacts: readonly AbsoluteMobileCompatibilityArtifact[]
) => {
	const appIds = new Set(artifacts.map(({ appId }) => appId));
	if (appIds.size > 1) {
		throw new TypeError(
			'Cannot retain compatibility artifacts for multiple apps.'
		);
	}
	assertUnique(
		artifacts.map(({ appBuild }) => appBuild),
		'appBuild'
	);
	assertUnique(
		artifacts.map(({ generation }) => String(generation)),
		'generation'
	);

	return [...artifacts]
		.sort((left, right) => right.generation - left.generation)
		.slice(0, ABSOLUTE_MOBILE_RETAINED_GENERATIONS);
};
