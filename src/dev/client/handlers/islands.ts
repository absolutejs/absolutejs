/* Island HMR update handler
   The server rebuilt the bundles of the listed islands. The island runtime
   that hydrated this page re-mounts each matching island in place from its
   new bundle (Window['__ABS_ISLAND_HMR__']); a page without that runtime, or
   an island it cannot swap (Angular), reloads instead. */

import { hideErrorOverlay } from '../errorOverlay';
import { sendAbsoluteHmrTiming } from '../hmrTiming';

type IslandUpdate = {
	component: string;
	framework: string;
	modulePath: string;
	/** The island's rebuilt stylesheet; the island runtime swaps it in. */
	stylePath?: string;
};

const isIslandUpdate = (value: unknown): value is IslandUpdate =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'component') === 'string' &&
	typeof Reflect.get(value, 'framework') === 'string' &&
	typeof Reflect.get(value, 'modulePath') === 'string';

const rendersIsland = ({ component, framework }: IslandUpdate) =>
	Array.from(
		document.querySelectorAll<HTMLElement>('[data-island="true"]')
	).some(
		(element) =>
			element.dataset.framework === framework &&
			element.dataset.component === component
	);

const reloadForIslands = (
	clientStart: number,
	serverDuration?: number,
	updateId?: number
) => {
	sendAbsoluteHmrTiming({
		clientStart,
		kind: 'component',
		outcome: 'reloaded',
		serverMs: serverDuration,
		updateId
	});
	window.location.reload();
};

type IslandUpdateMessage = {
	data: { islands?: unknown; serverDuration?: number };
	timestamp?: number;
};

export const handleIslandUpdate = (message: IslandUpdateMessage) => {
	const updates = Array.isArray(message.data.islands)
		? message.data.islands.filter(isIslandUpdate)
		: [];
	const onPage = updates.filter(rendersIsland);
	if (onPage.length === 0) return;

	const clientStart = performance.now();
	const { serverDuration } = message.data;
	const applyUpdate = window.__ABS_ISLAND_HMR__;
	if (!applyUpdate) {
		reloadForIslands(clientStart, serverDuration, message.timestamp);

		return;
	}

	void applyUpdate(onPage).then((applied) => {
		if (!applied) {
			reloadForIslands(clientStart, serverDuration, message.timestamp);

			return undefined;
		}
		hideErrorOverlay();
		sendAbsoluteHmrTiming({
			clientStart,
			kind: 'component',
			serverMs: serverDuration,
			updateId: message.timestamp
		});

		return undefined;
	});
};
