import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { StreamingSlot } from '../utils/streamingSlots';

/* Partial prerendering: the render-side half.
 *
 * A pre-rendered route whose page has dynamic streaming slots
 * (`dynamic: true`) is stored as a static shell. Two render modes make
 * that work, both entered through `withRegisteredStreamingSlots`:
 *
 * - Shell capture. The build (and an ISR re-render) requests the route
 *   with PARTIAL_SHELL_HEADER. Static slots resolve into the page as
 *   usual; dynamic slots keep their fallback, and their ids go back in
 *   PARTIAL_HOLES_HEADER so the shell is stored with its list of holes.
 * - Hole collection. Serving a shell, the server renders the route again
 *   in-process under `collectPartialHoles`. The page hands over its
 *   registered dynamic slots instead of a body, and the server resolves
 *   them into the shell it already sent (partialPrerenderServe.ts).
 *
 * The storage lives on globalThis under Symbol.for so the server runtime
 * and each framework's page-handler bundle share one instance. */

/** Response header listing a captured shell's dynamic slot ids. */
export const PARTIAL_HOLES_HEADER = 'X-Absolute-Partial-Holes';
/** Request header asking a page render for its static shell. */
export const PARTIAL_SHELL_HEADER = 'X-Absolute-Partial-Shell';

type HolesSink = { slots: StreamingSlot[] | undefined };

const SINK_STORAGE_KEY = Symbol.for('absolutejs.partialPrerenderHolesSink');

const isSinkStorage = (value: unknown): value is AsyncLocalStorage<HolesSink> =>
	value instanceof AsyncLocalStorage;

const getSinkStorage = () => {
	const existing: unknown = Reflect.get(globalThis, SINK_STORAGE_KEY);
	if (isSinkStorage(existing)) return existing;
	const created = new AsyncLocalStorage<HolesSink>();
	Reflect.set(globalThis, SINK_STORAGE_KEY, created);

	return created;
};

/** The hole sink of the request being rendered, when it's a hole
 *  collection render. */
export const activePartialHolesSink = () => getSinkStorage().getStore();

/** Runs `render` (a request through the app) and returns the dynamic
 *  slots the page registered. `slots` is undefined when the request never
 *  reached a page that collects streaming slots. */
export const collectPartialHoles = async (
	render: () => Promise<Response> | Response
) => {
	const sink: HolesSink = { slots: undefined };
	const response = await getSinkStorage().run(sink, render);

	return { response, slots: sink.slots };
};

export const decodePartialHoles = (value: string | null | undefined) =>
	value
		? value
				.split(',')
				.filter(Boolean)
				.map((id) => decodeURIComponent(id))
		: [];

export const encodePartialHoles = (ids: string[]) =>
	ids.map((id) => encodeURIComponent(id)).join(',');

export const isDynamicStreamingSlot = (slot: StreamingSlot) =>
	slot.dynamic === true;

export const isPartialShellCapture = (request: Request | undefined) =>
	request?.headers.get(PARTIAL_SHELL_HEADER) === '1';

/* A shell captured with holes is stored with `<page>.holes` next to it: one
 * URI-encoded slot id per line. */
const holesPath = (htmlPath: string) => htmlPath.replace(/\.html$/, '.holes');

/** Dynamic slot ids a shell was captured with; none for a fully
 *  pre-rendered page. */
export const readPartialHoles = (htmlPath: string) => {
	const path = holesPath(htmlPath);
	if (!existsSync(path)) return [];

	return decodePartialHoles(
		readFileSync(path, 'utf-8').trim().split('\n').join(',')
	);
};

/** Stores (or clears) the holes a shell render reported, returning them. */
export const writePartialHoles = async (
	htmlPath: string,
	response: Response
) => {
	const ids = decodePartialHoles(response.headers.get(PARTIAL_HOLES_HEADER));
	if (ids.length > 0) {
		await Bun.write(
			holesPath(htmlPath),
			`${encodePartialHoles(ids).split(',').join('\n')}\n`
		);
	} else {
		await rm(holesPath(htmlPath), { force: true });
	}

	return ids;
};
