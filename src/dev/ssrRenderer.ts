import { resolve } from 'node:path';

type RenderRequest = {
	componentPath: string;
	indexPath: string;
	props?: Record<string, unknown>;
};

type PendingRender = {
	resolve: (html: string) => void;
	reject: (error: Error) => void;
};

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, PendingRender>();

const getWorker = () => {
	if (worker) return worker;

	// Resolve from the package's dist/dev/ directory. The worker runs in
	// the user's project context so it can resolve their node_modules.
	const workerPath = resolve(import.meta.dir, 'ssrWorker.ts');
	worker = new Worker(workerPath, { cwd: process.cwd() } as ConstructorParameters<typeof Worker>[1]);

	worker.onmessage = (event) => {
		const { id, ok, html, error } = event.data;
		const req = pending.get(id);
		if (!req) return;
		pending.delete(id);

		if (ok) {
			req.resolve(html);
		} else {
			req.reject(new Error(error ?? 'SSR render failed'));
		}
	};

	worker.onerror = (event) => {
		console.error('[SSR Worker] Error:', event);
		// Reject all pending
		for (const [id, req] of pending) {
			req.reject(new Error('SSR worker crashed'));
			pending.delete(id);
		}
		worker = null;
	};

	return worker;
};

export const renderInWorker = (request: RenderRequest) =>
	new Promise<string>((resolvePromise, rejectPromise) => {
		const id = ++requestId;
		pending.set(id, {
			reject: rejectPromise,
			resolve: resolvePromise
		});

		const w = getWorker();
		w.postMessage({
			componentPath: resolve(request.componentPath),
			id,
			indexPath: request.indexPath,
			props: request.props
		});
	});
