import { relative, resolve } from 'node:path';
import { decodeSrcPath, encodeSrcPath } from './srcPath';
import { transitiveImporters } from './transformCache';

export const CLIENT_MODULE_PREFIX = '/@hmr/client-module/';

export const clientModuleUpdates = (
	manifest: Record<string, string>,
	files: string[],
	canRefresh: (file: string) => boolean
) => {
	const entries = Object.values(manifest).filter((url) =>
		url.startsWith(CLIENT_MODULE_PREFIX)
	);
	if (!entries.length) return {};
	const changes = files.map((file) => ({
		file: resolve(file),
		importers: transitiveImporters(resolve(file))
	}));
	const updates: Record<string, { urls: string[]; refresh: boolean }> = {};
	for (const entry of entries) {
		const source = resolve(
			decodeSrcPath(entry.slice(CLIENT_MODULE_PREFIX.length))
		);
		const affected = changes.filter((change) =>
			change.importers.has(source)
		);
		if (!affected.length) continue;
		updates[entry] = {
			refresh: affected.every(
				({ file }) => file !== source && canRefresh(file)
			),
			urls: affected.map(
				({ file }) =>
					'/@src/' + encodeSrcPath(relative(process.cwd(), file))
			)
		};
	}
	return updates;
};

// The host owns the mount arguments and disposal handle. A subscribing
// host gets the current namespace immediately, including edits made while
// its panel was closed. Ordinary named imports remain available.
export const clientModuleBootstrap = (entry: string) => {
	const source = JSON.stringify(
		'/@src/' + entry.slice(CLIENT_MODULE_PREFIX.length)
	);
	return `export * from ${source};
import * as initial from ${source};
let current = initial;
const subscribers = new Set();
export function onClientModuleReplace(apply) {
	apply(current);
	subscribers.add(apply);
	return () => subscribers.delete(apply);
}
const entry = ${JSON.stringify(entry)};
const base = new URL(import.meta.url);
const app = new URL(base.pathname.slice(0, base.pathname.indexOf('/@hmr/')) + '/', base);
const socketURL = new URL('hmr', app);
socketURL.protocol = socketURL.protocol === 'https:' ? 'wss:' : 'ws:';
const fresh = (path, stamp) => import(new URL(path.slice(1) + '?t=' + stamp, app).href);
let pending = Promise.resolve();
function connect() {
	const socket = new WebSocket(socketURL);
	socket.onclose = () => setTimeout(connect, 1000);
	socket.onmessage = ({data}) => {
		const message = JSON.parse(data);
		const update = message.data?.clientModules?.[entry];
		if (!update || message.type !== 'react-update') return;
		pending = pending.then(async () => {
			if (update.refresh && window.$RefreshRuntime$) {
				await Promise.all(update.urls.map(url => fresh(url, message.timestamp)));
				window.$RefreshRuntime$.performReactRefresh();
				return;
			}
			current = await fresh(${source}, message.timestamp);
			for (const apply of subscribers) apply(current);
		}).catch(error => console.error('[clientModules]', error));
	};
}
connect();
`;
};
