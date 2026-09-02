import { afterEach, describe, expect, test } from 'bun:test';
import {
	BOOT_STATUS_HEADER,
	buildingResponse,
	releaseEarlyListener,
	startEarlyListener
} from '../../../src/dev/earlyListener';
import { setBootPhase } from '../../../src/dev/bootLifecycle';
import { getAvailablePort } from '../../helpers/ports';

const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_OK = 200;

afterEach(() => {
	releaseEarlyListener();
	setBootPhase('');
});

describe('early dev listener', () => {
	test('answers HTML, JSON and plain-text clients with 503 + Retry-After while building', async () => {
		const port = await getAvailablePort();
		setBootPhase('initial build');
		const listener = startEarlyListener({ host: 'localhost', port });
		expect(listener.server).not.toBeNull();

		const html = await fetch(`http://localhost:${port}/some/page`, {
			headers: { accept: 'text/html,application/xhtml+xml' }
		});
		expect(html.status).toBe(HTTP_SERVICE_UNAVAILABLE);
		expect(html.headers.get('retry-after')).toBe('2');
		expect(html.headers.get('cache-control')).toBe('no-store');
		expect(html.headers.get(BOOT_STATUS_HEADER)).toBe('building');
		expect(html.headers.get('content-type')).toContain('text/html');
		const page = await html.text();
		expect(page).toContain('Building…');
		expect(page).toContain('initial build');
		expect(page).toContain('location.reload()');

		const json = await fetch(`http://localhost:${port}/api/thing`, {
			headers: { accept: 'application/json' }
		});
		expect(json.status).toBe(HTTP_SERVICE_UNAVAILABLE);
		expect(json.headers.get('content-type')).toContain('application/json');
		const body = (await json.json()) as {
			status: string;
			phase: string;
			elapsedMs: number;
		};
		expect(body.status).toBe('building');
		expect(body.phase).toBe('initial build');
		expect(body.elapsedMs).toBeGreaterThanOrEqual(0);

		const text = await fetch(`http://localhost:${port}/`, {
			headers: { accept: '*/*' }
		});
		expect(text.status).toBe(HTTP_SERVICE_UNAVAILABLE);
		expect(text.headers.get('content-type')).toContain('text/plain');
		expect(await text.text()).toContain('building');
	});

	test('rejects websocket upgrades cleanly instead of crashing', async () => {
		const port = await getAvailablePort();
		startEarlyListener({ host: 'localhost', port });

		const outcome = await new Promise<'error' | 'open'>((resolve) => {
			const socket = new WebSocket(`ws://localhost:${port}/hmr`);
			socket.onopen = () => resolve('open');
			socket.onerror = () => resolve('error');
			socket.onclose = () => resolve('error');
		});
		expect(outcome).toBe('error');

		// The placeholder is still healthy after the failed handshake.
		const res = await fetch(`http://localhost:${port}/`);
		expect(res.status).toBe(HTTP_SERVICE_UNAVAILABLE);
	});

	test('release frees the port synchronously for the real server', async () => {
		const port = await getAvailablePort();
		startEarlyListener({ host: 'localhost', port });
		// Keep-alive connection open against the placeholder.
		await fetch(`http://localhost:${port}/`, {
			headers: { accept: 'text/html' }
		});

		expect(releaseEarlyListener()).toBe(true);
		expect(globalThis.__absoluteEarlyListener).toBeUndefined();

		const real = Bun.serve({
			hostname: 'localhost',
			port,
			fetch: () => new Response('real', { status: HTTP_OK })
		});
		try {
			const res = await fetch(`http://localhost:${port}/`);
			expect(res.status).toBe(HTTP_OK);
			expect(await res.text()).toBe('real');
		} finally {
			real.stop(true);
		}
		// Releasing twice is a no-op.
		expect(releaseEarlyListener()).toBe(false);
	});

	test('a busy port never throws — the placeholder just stays unbound', async () => {
		const port = await getAvailablePort();
		const occupant = Bun.serve({
			hostname: 'localhost',
			port,
			fetch: () => new Response('occupied')
		});
		try {
			const listener = startEarlyListener({ host: 'localhost', port });
			expect(listener.server).toBeNull();
			expect(listener.released).toBe(false);
			listener.release();
			expect(listener.released).toBe(true);
		} finally {
			occupant.stop(true);
		}
	});

	test('buildingResponse content negotiation is header-driven', () => {
		const startedAt = Date.now();
		const upgrade = buildingResponse(
			new Request('http://localhost/hmr', {
				headers: { accept: 'text/html', upgrade: 'websocket' }
			}),
			startedAt
		);
		expect(upgrade.status).toBe(HTTP_SERVICE_UNAVAILABLE);
		expect(upgrade.headers.get('content-type')).toContain('text/plain');

		const html = buildingResponse(
			new Request('http://localhost/', {
				headers: { accept: 'text/html' }
			}),
			startedAt
		);
		expect(html.headers.get('content-type')).toContain('text/html');
	});
});
