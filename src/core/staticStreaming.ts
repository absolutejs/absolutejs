import { statSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
	StreamingSlot,
	StreamingSlotPatchPayload
} from '../utils/streamingSlots';

export type StaticStreamingSlotResolver = () =>
	| Promise<StreamingSlotPatchPayload>
	| StreamingSlotPatchPayload;

export type StaticStreamingSlotDefinition = {
	resolve: StaticStreamingSlotResolver;
	timeoutMs?: number;
	errorHtml?: string;
};

export type StaticStreamingSlotDefinitions = Record<
	string,
	StaticStreamingSlotResolver | StaticStreamingSlotDefinition
>;

export const defineStaticStreamingSlots = <
	const T extends StaticStreamingSlotDefinitions
>(
	slots: T
) => slots;

const STATIC_SLOT_TAG_RE =
	/<abs-stream-slot\b([^>]*?)(?:\/>|>([\s\S]*?)<\/abs-stream-slot>)/gi;
const ATTRIBUTE_RE =
	/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

type StaticStreamingTagDefinition = {
	errorHtml?: string;
	fallbackHtml: string;
	id: string;
	resolver: string;
	timeoutMs?: number;
};

const parseAttributes = (attributeString: string) => {
	const attributes = new Map<string, string>();
	const setAttributeFromMatch = (matchParts: RegExpExecArray) => {
		const [, key, doubleQuotedValue, singleQuotedValue] = matchParts;
		if (!key) {
			return;
		}

		attributes.set(key, doubleQuotedValue ?? singleQuotedValue ?? '');
	};

	let match = ATTRIBUTE_RE.exec(attributeString);
	while (match) {
		setAttributeFromMatch(match);
		match = ATTRIBUTE_RE.exec(attributeString);
	}

	ATTRIBUTE_RE.lastIndex = 0;

	return attributes;
};

const parseTimeout = (value: string | undefined) => {
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(
			`Invalid <abs-stream-slot timeout-ms="${value}">. Expected a non-negative number.`
		);
	}

	return parsed;
};

const parseStaticStreamingTag = (
	attributeString: string,
	innerHtml: string | undefined
): StaticStreamingTagDefinition => {
	const attributes = parseAttributes(attributeString);
	const resolver = attributes.get('resolver');
	if (!resolver) {
		throw new Error(
			'Static <abs-stream-slot> requires a "resolver" attribute.'
		);
	}

	const id = attributes.get('id') ?? resolver;

	return {
		errorHtml: attributes.get('error-html') ?? undefined,
		fallbackHtml:
			innerHtml?.trim() ?? attributes.get('fallback-html') ?? '',
		id,
		resolver,
		timeoutMs: parseTimeout(attributes.get('timeout-ms') ?? undefined)
	};
};

export const extractStaticStreamingTags = (html: string) => {
	const tagRe = new RegExp(STATIC_SLOT_TAG_RE);
	const tags: StaticStreamingTagDefinition[] = [];
	let match = tagRe.exec(html);

	while (match) {
		const [, rawAttributeString, innerHtml] = match;
		tags.push(parseStaticStreamingTag(rawAttributeString ?? '', innerHtml));
		match = tagRe.exec(html);
	}

	return tags;
};

const toStaticStreamingSlotDefinition = (
	value: StaticStreamingSlotResolver | StaticStreamingSlotDefinition
) => (typeof value === 'function' ? { resolve: value } : value);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const toStaticStreamingDefinitionEntry = (
	entry: unknown
): StaticStreamingSlotDefinition | StaticStreamingSlotResolver | null => {
	if (typeof entry === 'function') {
		return () => entry();
	}

	if (!isObjectRecord(entry) || typeof entry.resolve !== 'function') {
		return null;
	}
	const { resolve } = entry;

	return {
		errorHtml:
			typeof entry.errorHtml === 'string' ? entry.errorHtml : undefined,
		timeoutMs:
			typeof entry.timeoutMs === 'number' ? entry.timeoutMs : undefined,
		resolve: () => resolve()
	};
};

const toStaticStreamingSlotDefinitions = (value: unknown) => {
	if (!isObjectRecord(value)) {
		return null;
	}

	const definitions: StaticStreamingSlotDefinitions = {};
	for (const [key, entry] of Object.entries(value)) {
		const definition = toStaticStreamingDefinitionEntry(entry);
		if (!definition) {
			return null;
		}

		definitions[key] = definition;
	}

	return definitions;
};

type StaticStreamingModuleExports = {
	default?: unknown;
	streamingSlots?: unknown;
};

const resolveStaticStreamingDefinitions = (
	moduleExports: StaticStreamingModuleExports
) =>
	toStaticStreamingSlotDefinitions(moduleExports.streamingSlots) ??
	toStaticStreamingSlotDefinitions(moduleExports.default);

const serverModuleExtensions = [
	'.server.ts',
	'.server.js',
	'.server.mjs',
	'.slots.ts',
	'.slots.js',
	'.slots.mjs'
] as const;

const resolveSidecarCandidates = (pagePath: string) => {
	const pageExt = extname(pagePath);
	if (!pageExt) return [];

	const pageStem = pagePath.slice(0, -pageExt.length);

	return serverModuleExtensions.map((extension) => `${pageStem}${extension}`);
};

const fileExists = async (path: string) => Bun.file(path).exists();

const loadStaticStreamingModule = async (pagePath: string) => {
	const loadCandidate = async (candidates: string[]) => {
		const [candidate, ...remaining] = candidates;
		if (!candidate) {
			return null;
		}
		if (!(await fileExists(candidate))) {
			return loadCandidate(remaining);
		}

		const version = statSync(candidate).mtimeMs;
		const moduleUrl = new URL(pathToFileURL(candidate).href);
		moduleUrl.searchParams.set('t', String(version));

		const moduleExports: StaticStreamingModuleExports = await import(
			moduleUrl.href
		);
		const definitions = resolveStaticStreamingDefinitions(moduleExports);
		if (!definitions) {
			throw new Error(
				`Static streaming module "${candidate}" must export a default value or named "streamingSlots" object.`
			);
		}

		return definitions;
	};

	return loadCandidate(resolveSidecarCandidates(pagePath));
};

export const loadStaticStreamingSlots = async (
	pagePath: string,
	html: string
) => {
	const tagDefinitions = extractStaticStreamingTags(html);
	if (tagDefinitions.length === 0) {
		return [];
	}

	const definitions = await loadStaticStreamingModule(pagePath);
	if (!definitions) {
		throw new Error(
			`Static page "${pagePath}" uses <abs-stream-slot> but no page-adjacent server module was found. Create a sibling ".server.ts" file that exports defineStaticStreamingSlots({...}).`
		);
	}

	return tagDefinitions.map((tag) => {
		const entry = definitions[tag.resolver];
		if (!entry) {
			throw new Error(
				`Static streaming resolver "${tag.resolver}" was not found for "${pagePath}".`
			);
		}

		const definition = toStaticStreamingSlotDefinition(entry);

		return {
			errorHtml: tag.errorHtml ?? definition.errorHtml,
			fallbackHtml: tag.fallbackHtml,
			id: tag.id,
			resolve: definition.resolve,
			timeoutMs: tag.timeoutMs ?? definition.timeoutMs
		} satisfies StreamingSlot;
	});
};
