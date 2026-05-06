import type { IslandFramework, IslandHydrate } from '../../types/island';

/* `<Island>` (Vue/Svelte/React/Angular component form) historically took
   `props` as an object, while `<absolute-island>` (custom-element form
   used in HTML/HTMX hosts) takes `props` as a JSON-serialized string.
   The two surfaces have the same mental model — "render an island" —
   but a value that's valid in one shape would silently break in the
   other. This helper normalizes whichever shape arrives at runtime. */
const EMPTY_PROPS: Record<string, unknown> = {};

const ISLAND_FRAMEWORKS: readonly IslandFramework[] = [
	'react',
	'svelte',
	'vue',
	'angular',
	'ember'
];

const ISLAND_HYDRATE_MODES: readonly IslandHydrate[] = [
	'load',
	'idle',
	'visible',
	'none'
];

const isIslandFramework = (value: string): value is IslandFramework =>
	ISLAND_FRAMEWORKS.some((framework) => framework === value);

const isIslandHydrate = (value: string): value is IslandHydrate =>
	ISLAND_HYDRATE_MODES.some((mode) => mode === value);

type RawIslandProps = {
	component: string;
	framework: string;
	hydrate?: string | undefined;
	props: unknown;
};

export const normalizeRuntimeIslandRenderProps = (raw: RawIslandProps) => {
	const { component, framework, hydrate, props } = raw;
	if (!isIslandFramework(framework)) {
		throw new Error(`Unknown island framework: "${framework}".`);
	}

	if (hydrate !== undefined && !isIslandHydrate(hydrate)) {
		throw new Error(`Unknown island hydrate mode: "${hydrate}".`);
	}

	return {
		component,
		framework,
		hydrate,
		props: normalizeIslandProps(props)
	};
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const safeJsonParseObject = (raw: string) => {
	const trimmed = raw.trim();
	if (!trimmed) return EMPTY_PROPS;

	try {
		const parsed: unknown = JSON.parse(trimmed);

		return isPlainObject(parsed) ? parsed : EMPTY_PROPS;
	} catch {
		return EMPTY_PROPS;
	}
};

export const normalizeIslandProps = (value: unknown) => {
	if (typeof value === 'string') return safeJsonParseObject(value);
	if (isPlainObject(value)) return value;

	return EMPTY_PROPS;
};
