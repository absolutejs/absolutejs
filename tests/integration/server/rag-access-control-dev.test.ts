import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDevServer, type DevServer } from '../../helpers/devServer';
import { getAvailablePort } from '../../helpers/ports';

let server: DevServer;

const pickChromeExecutable = () => {
	const candidates = [
		process.env.GOOGLE_CHROME_BINARY,
		process.env.GOOGLE_CHROME_PATH,
		process.env.CHROME_EXECUTABLE,
		process.env.PUPPETEER_EXECUTABLE_PATH,
		process.env.PUPPETEER_CHROME_PATH,
		'google-chrome',
		'google-chrome-stable',
		'chromium-browser',
		'chromium'
	].filter(Boolean) as string[];

	for (const candidate of candidates) {
		if (candidate.includes('/')) {
			if (existsSync(candidate)) return candidate;
			continue;
		}
		if (Bun.which(candidate)) return candidate;
	}

	return null;
};

const waitFor = async (
	callback: () => Promise<boolean>,
	timeoutMs = 10_000,
	intervalMs = 100
) => {
	const start = Date.now();
	for (;;) {
		if (await callback()) {
			return;
		}
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out after ${timeoutMs}ms`);
		}
		await Bun.sleep(intervalMs);
	}
};

const connectCDP = async (wsUrl: string) => {
	const ws = new WebSocket(wsUrl);
	const pending = new Map<
		number,
		{
			reject: (error: unknown) => void;
			resolve: (value: unknown) => void;
		}
	>();
	let nextId = 0;

	ws.addEventListener('message', (event) => {
		const payload = JSON.parse(String(event.data)) as {
			error?: { message?: string };
			id?: number;
			result?: unknown;
		};
		if (typeof payload.id !== 'number') {
			return;
		}
		const entry = pending.get(payload.id);
		if (!entry) {
			return;
		}
		pending.delete(payload.id);
		if (payload.error) {
			entry.reject(new Error(payload.error.message ?? 'CDP error'));
			return;
		}
		entry.resolve(payload.result);
	});

	await new Promise<void>((resolve, reject) => {
		ws.addEventListener('open', () => resolve(), { once: true });
		ws.addEventListener('error', (event) => reject(event), { once: true });
	});

	const send = <T>(method: string, params?: Record<string, unknown>) =>
		new Promise<T>((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, {
				reject,
				resolve: resolve as (value: unknown) => void
			});
			ws.send(JSON.stringify({ id, method, params }));
		});

	return {
		close() {
			ws.close();
		},
		send,
		ws
	};
};

const evaluateCDP = async <T>(
	client: Awaited<ReturnType<typeof connectCDP>>,
	input: {
		awaitPromise?: boolean;
		expression: string;
		returnByValue?: boolean;
	},
	retries = 5
) => {
	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			return await client.send<T>('Runtime.evaluate', input);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			if (
				!message.includes('Execution context was destroyed') ||
				attempt === retries - 1
			) {
				throw error;
			}
			await Bun.sleep(200);
		}
	}

	throw new Error('Unreachable');
};

afterAll(async () => {
	await server?.kill();
});

describe('dev server rag access control example', () => {
	test('scopes rag-demo documents by workspace header', async () => {
		server = await startDevServer();

		const alphaResponse = await fetch(
			`${server.baseUrl}/rag-demo/documents`
		);
		const alphaBody = (await alphaResponse.json()) as {
			documents: Array<{ id: string }>;
			ok: boolean;
		};

		expect(alphaResponse.status).toBe(200);
		expect(alphaBody.ok).toBe(true);
		expect(alphaBody.documents.map((entry) => entry.id)).toEqual([
			'alpha-shared-policy'
		]);

		const betaResponse = await fetch(
			`${server.baseUrl}/rag-demo/documents`,
			{
				headers: {
					'x-rag-workspace': 'beta'
				}
			}
		);
		const betaBody = (await betaResponse.json()) as {
			documents: Array<{ id: string }>;
			ok: boolean;
		};

		expect(betaResponse.status).toBe(200);
		expect(betaBody.ok).toBe(true);
		expect(betaBody.documents.map((entry) => entry.id)).toEqual([
			'beta-shared-policy'
		]);
	}, 60_000);

	test('shapes rag-demo ops capabilities and denies viewer writes', async () => {
		const viewerOpsResponse = await fetch(`${server.baseUrl}/rag-demo/ops`);
		const viewerOpsBody = (await viewerOpsResponse.json()) as {
			admin: { canCreateDocument: boolean };
			ok: boolean;
		};

		expect(viewerOpsResponse.status).toBe(200);
		expect(viewerOpsBody.ok).toBe(true);
		expect(viewerOpsBody.admin.canCreateDocument).toBe(false);

		const adminOpsResponse = await fetch(`${server.baseUrl}/rag-demo/ops`, {
			headers: {
				'x-rag-role': 'admin'
			}
		});
		const adminOpsBody = (await adminOpsResponse.json()) as {
			admin: { canCreateDocument: boolean };
			ok: boolean;
		};

		expect(adminOpsResponse.status).toBe(200);
		expect(adminOpsBody.ok).toBe(true);
		expect(adminOpsBody.admin.canCreateDocument).toBe(true);

		const deniedWriteResponse = await fetch(
			`${server.baseUrl}/rag-demo/documents`,
			{
				body: JSON.stringify({
					id: 'viewer-write',
					source: 'shared/new.md',
					text: 'viewer write attempt',
					title: 'Viewer write'
				}),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			}
		);

		expect(deniedWriteResponse.status).toBe(403);
		expect(await deniedWriteResponse.json()).toEqual({
			error: 'Admin role required for RAG mutations',
			ok: false
		});
	}, 60_000);

	test('scopes rag-demo retrieval governance by corpus group', async () => {
		const alphaHistoryResponse = await fetch(
			`${server.baseUrl}/rag-demo/compare/retrieval/release-history?groupKey=shared-release&corpusGroupKey=alpha`
		);
		const alphaHistoryBody = (await alphaHistoryResponse.json()) as {
			ok: boolean;
			corpusGroupKey?: string;
			runs?: Array<{ id: string; corpusGroupKey?: string }>;
			baselines?: Array<{ id: string; corpusGroupKey?: string }>;
			decisions?: Array<{ id: string; corpusGroupKey?: string }>;
		};

		expect(alphaHistoryResponse.status).toBe(200);
		expect(alphaHistoryBody.ok).toBe(true);
		expect(alphaHistoryBody.corpusGroupKey).toBe('alpha');
		expect(alphaHistoryBody.runs?.map((entry) => entry.id)).toEqual([
			'alpha-run'
		]);
		expect(alphaHistoryBody.baselines?.map((entry) => entry.id)).toEqual([
			'alpha-baseline'
		]);
		expect(alphaHistoryBody.decisions?.map((entry) => entry.id)).toEqual([
			'alpha-decision'
		]);

		const betaHistoryResponse = await fetch(
			`${server.baseUrl}/rag-demo/compare/retrieval/release-history?groupKey=shared-release&corpusGroupKey=beta`,
			{
				headers: {
					'x-rag-workspace': 'beta'
				}
			}
		);
		const betaHistoryBody = (await betaHistoryResponse.json()) as {
			ok: boolean;
			corpusGroupKey?: string;
			runs?: Array<{ id: string; corpusGroupKey?: string }>;
			baselines?: Array<{ id: string; corpusGroupKey?: string }>;
			decisions?: Array<{ id: string; corpusGroupKey?: string }>;
		};

		expect(betaHistoryResponse.status).toBe(200);
		expect(betaHistoryBody.ok).toBe(true);
		expect(betaHistoryBody.corpusGroupKey).toBe('beta');
		expect(betaHistoryBody.runs?.map((entry) => entry.id)).toEqual([
			'beta-run'
		]);
		expect(betaHistoryBody.baselines?.map((entry) => entry.id)).toEqual([
			'beta-baseline'
		]);
		expect(betaHistoryBody.decisions?.map((entry) => entry.id)).toEqual([
			'beta-decision'
		]);

		const alphaOpsResponse = await fetch(`${server.baseUrl}/rag-demo/ops`);
		const alphaOpsBody = (await alphaOpsResponse.json()) as {
			ok: boolean;
			retrievalComparisons?: {
				releaseGroups?: Array<{
					groupKey: string;
					corpusGroupKey?: string;
				}>;
			};
		};

		expect(alphaOpsResponse.status).toBe(200);
		expect(alphaOpsBody.ok).toBe(true);
		expect(
			alphaOpsBody.retrievalComparisons?.releaseGroups?.find(
				(entry) => entry.groupKey === 'shared-release'
			)?.corpusGroupKey
		).toBe('alpha');

		const betaOpsResponse = await fetch(`${server.baseUrl}/rag-demo/ops`, {
			headers: {
				'x-rag-workspace': 'beta'
			}
		});
		const betaOpsBody = (await betaOpsResponse.json()) as {
			ok: boolean;
			retrievalComparisons?: {
				releaseGroups?: Array<{
					groupKey: string;
					corpusGroupKey?: string;
				}>;
			};
		};

		expect(betaOpsResponse.status).toBe(200);
		expect(betaOpsBody.ok).toBe(true);
		expect(
			betaOpsBody.retrievalComparisons?.releaseGroups?.find(
				(entry) => entry.groupKey === 'shared-release'
			)?.corpusGroupKey
		).toBe('beta');
	}, 60_000);

	test('persists rag-demo retrieval governance across dev server restarts', async () => {
		const summarizeRuns = (
			entries: Array<{ id: string; corpusGroupKey?: string }> | undefined
		) => entries?.map(({ corpusGroupKey, id }) => ({ corpusGroupKey, id }));
		const summarizeBaselines = (
			entries: Array<{ id: string; corpusGroupKey?: string }> | undefined
		) => entries?.map(({ corpusGroupKey, id }) => ({ corpusGroupKey, id }));
		const summarizeDecisions = (
			entries:
				| Array<{
						id: string;
						corpusGroupKey?: string;
						kind?: string;
						sourceRunId?: string;
						targetRolloutLabel?: string;
				  }>
				| undefined
		) =>
			entries?.map(
				({
					corpusGroupKey,
					id,
					kind,
					sourceRunId,
					targetRolloutLabel
				}) => ({
					corpusGroupKey,
					id,
					kind,
					sourceRunId,
					targetRolloutLabel
				})
			);

		const readAlphaReleaseHistory = async (baseUrl: string) => {
			const response = await fetch(
				`${baseUrl}/rag-demo/compare/retrieval/release-history?groupKey=shared-release&corpusGroupKey=alpha`
			);
			const body = (await response.json()) as {
				ok: boolean;
				corpusGroupKey?: string;
				runs?: Array<{ id: string; corpusGroupKey?: string }>;
				baselines?: Array<{ id: string; corpusGroupKey?: string }>;
				decisions?: Array<{
					id: string;
					corpusGroupKey?: string;
					kind?: string;
					sourceRunId?: string;
					targetRolloutLabel?: string;
				}>;
			};

			expect(response.status).toBe(200);
			expect(body.ok).toBe(true);
			expect(body.corpusGroupKey).toBe('alpha');

			return body;
		};

		const beforeRestart = await readAlphaReleaseHistory(server.baseUrl);

		expect(beforeRestart.runs?.map((entry) => entry.id)).toEqual([
			'alpha-run'
		]);
		expect(beforeRestart.baselines?.map((entry) => entry.id)).toEqual([
			'alpha-baseline'
		]);
		expect(beforeRestart.decisions?.map((entry) => entry.id)).toEqual([
			'alpha-decision'
		]);

		await server.kill();
		server = await startDevServer();

		const afterRestart = await readAlphaReleaseHistory(server.baseUrl);

		expect(summarizeRuns(afterRestart.runs)).toEqual(
			summarizeRuns(beforeRestart.runs)
		);
		expect(summarizeBaselines(afterRestart.baselines)).toEqual(
			summarizeBaselines(beforeRestart.baselines)
		);
		expect(summarizeDecisions(afterRestart.decisions)).toEqual(
			summarizeDecisions(beforeRestart.decisions)
		);
	}, 60_000);

	test('renders persisted sqlite governance status page per workspace', async () => {
		const alphaResponse = await fetch(
			`${server.baseUrl}/demo/ops/sqlite-native`
		);
		const alphaHtml = await alphaResponse.text();

		expect(alphaResponse.status).toBe(200);
		expect(alphaResponse.headers.get('content-type')).toContain(
			'text/html'
		);
		expect(alphaHtml).toContain('SQLite-backed release status');
		expect(alphaHtml).toContain('alpha-run');
		expect(alphaHtml).toContain('alpha-baseline');
		expect(alphaHtml).toContain('alpha-decision');
		expect(alphaHtml).toContain('alpha-incident');
		expect(alphaHtml).toContain('alpha-handoff-decision');
		expect(alphaHtml).toContain('alpha-handoff-incident');
		expect(alphaHtml).toContain('alpha-handoff-history-ack');
		expect(alphaHtml).toContain('alpha-remediation-plan');
		expect(alphaHtml).toContain('alpha-remediation-execution');
		expect(alphaHtml).toContain('Comparison Lead Drift');
		expect(alphaHtml).toContain(
			'Vector · lead cues docs/alpha-release.md · drift none'
		);
		expect(alphaHtml).toContain(
			'Lexical · lead cues docs/alpha-release.md#stable-blockers · drift alpha policy retrieval docs/alpha-release.md→docs/alpha-release.md#stable-blockers'
		);
		expect(alphaHtml).toContain('Chunk Provenance Preview');
		expect(alphaHtml).toContain('Chunk boundary section');
		expect(alphaHtml).toContain(
			'Source-aware section Release Ops Overview &gt; Stable Lane'
		);
		expect(alphaHtml).toContain(
			'Source-aware spreadsheet Release Tracker Table 2 of 2'
		);
		expect(alphaHtml).toContain(
			'sourceAwareChunkReason: Chunk boundary size limit'
		);
		expect(alphaHtml).toContain(
			'/rag-demo/compare/retrieval/incidents?groupKey=shared-release&amp;corpusGroupKey=alpha&amp;limit=5'
		);
		expect(alphaHtml).toContain(
			'/rag-demo/compare/retrieval/handoffs/decisions?groupKey=shared-release&amp;corpusGroupKey=alpha&amp;targetRolloutLabel=stable&amp;limit=5'
		);
		expect(alphaHtml).toContain(
			'hx-post="/rag-demo/compare/retrieval/incidents/resolve"'
		);
		expect(alphaHtml).toContain(
			'hx-post="/rag-demo/compare/retrieval/handoffs/incidents/resolve"'
		);
		expect(alphaHtml).toContain(
			'hx-post="/rag-demo/compare/retrieval/baselines/approve"'
		);
		expect(alphaHtml).toContain(
			'/demo/ops/sqlite-native/fragments/baselines?workspace='
		);
		expect(alphaHtml).toContain(
			'&quot;x-rag-role&quot;:&quot;admin&quot;,&quot;x-rag-workspace&quot;:&quot;alpha&quot;'
		);
		expect(alphaHtml).toContain(
			'/demo/ops/sqlite-native/fragments/incidents?workspace='
		);
		expect(alphaHtml).not.toContain('beta-run');

		const betaResponse = await fetch(
			`${server.baseUrl}/demo/ops/sqlite-native?workspace=beta`
		);
		const betaHtml = await betaResponse.text();

		expect(betaResponse.status).toBe(200);
		expect(betaHtml).toContain('beta-run');
		expect(betaHtml).toContain('beta-baseline');
		expect(betaHtml).toContain('beta-decision');
		expect(betaHtml).toContain('beta-incident');
		expect(betaHtml).toContain('beta-handoff-decision');
		expect(betaHtml).toContain('beta-handoff-incident');
		expect(betaHtml).toContain('beta-handoff-history-resolved');
		expect(betaHtml).toContain('beta-remediation-plan');
		expect(betaHtml).toContain('beta-remediation-execution');
		expect(betaHtml).toContain('Chunk Provenance Preview');
		expect(betaHtml).toContain(
			'/rag-demo/compare/retrieval/incidents/remediations?groupKey=shared-release&amp;corpusGroupKey=beta&amp;limit=5'
		);
		expect(betaHtml).not.toContain('alpha-run');
	}, 60_000);

	test('links example pages to the persisted governance surface', async () => {
		const htmlPageResponse = await fetch(`${server.baseUrl}/html`);
		const htmlPage = await htmlPageResponse.text();

		expect(htmlPageResponse.status).toBe(200);
		expect(htmlPage).toContain('href="/demo/ops/sqlite-native"');

		const reactPageResponse = await fetch(`${server.baseUrl}/react`);
		const reactPage = await reactPageResponse.text();

		expect(reactPageResponse.status).toBe(200);
		expect(reactPage).toContain('href="/demo/ops/sqlite-native"');
	}, 60_000);

	test('renders incident fragment region for workspace refreshes', async () => {
		const response = await fetch(
			`${server.baseUrl}/demo/ops/sqlite-native/fragments/incidents?workspace=alpha`
		);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('id="governance-incident-region"');
		expect(html).toContain('alpha-incident');
		expect(html).toContain('alpha-handoff-incident');
		expect(html).toContain('alpha-handoff-history-ack');
		expect(html).toContain('alpha-remediation-plan');
		expect(html).toContain('alpha-remediation-execution');
		expect(html).toContain(
			'hx-post="/rag-demo/compare/retrieval/incidents/resolve"'
		);
	}, 60_000);

	test('renders baseline fragment region for workspace refreshes', async () => {
		const response = await fetch(
			`${server.baseUrl}/demo/ops/sqlite-native/fragments/baselines?workspace=alpha`
		);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('id="governance-baseline-region"');
		expect(html).toContain('alpha-run');
		expect(html).toContain('alpha-baseline');
		expect(html).toContain('alpha-decision');
		expect(html).toContain('Comparison Lead Drift');
		expect(html).toContain(
			'Lexical · lead cues docs/alpha-release.md#stable-blockers'
		);
		expect(html).toContain(
			'hx-post="/rag-demo/compare/retrieval/baselines/approve"'
		);
		expect(html).toContain(
			'hx-post="/rag-demo/compare/retrieval/baselines/promote-run"'
		);
	}, 60_000);

	test('applies HTMX incident mutation without full page reload in a browser', async () => {
		const chromeExecutable = pickChromeExecutable();
		if (!chromeExecutable) {
			return;
		}

		const debugPort = await getAvailablePort();
		const userDataDir = mkdtempSync(
			join(tmpdir(), 'absolutejs-rag-governance-browser-')
		);
		const chrome = Bun.spawn(
			[
				chromeExecutable,
				'--headless=new',
				'--disable-gpu',
				'--no-first-run',
				'--no-default-browser-check',
				`--remote-debugging-port=${debugPort}`,
				`--user-data-dir=${userDataDir}`,
				`${server.baseUrl}/demo/ops/sqlite-native?workspace=alpha`
			],
			{
				stderr: 'pipe',
				stdout: 'pipe'
			}
		);

		let client: Awaited<ReturnType<typeof connectCDP>> | undefined;

		try {
			await waitFor(async () => {
				try {
					const response = await fetch(
						`http://127.0.0.1:${debugPort}/json/list`
					);
					if (!response.ok) {
						return false;
					}
					const targets = (await response.json()) as Array<{
						type?: string;
						url?: string;
						webSocketDebuggerUrl?: string;
					}>;
					return targets.some(
						(entry) =>
							entry.type === 'page' &&
							typeof entry.url === 'string' &&
							entry.url.includes('/demo/ops/sqlite-native') &&
							typeof entry.webSocketDebuggerUrl === 'string'
					);
				} catch {
					return false;
				}
			}, 15_000);

			const targets = (await fetch(
				`http://127.0.0.1:${debugPort}/json/list`
			).then((response) => response.json())) as Array<{
				type?: string;
				url?: string;
				webSocketDebuggerUrl?: string;
			}>;
			const target = targets.find(
				(entry) =>
					entry.type === 'page' &&
					typeof entry.url === 'string' &&
					entry.url.includes('/demo/ops/sqlite-native') &&
					typeof entry.webSocketDebuggerUrl === 'string'
			);
			expect(target?.webSocketDebuggerUrl).toBeDefined();

			client = await connectCDP(target!.webSocketDebuggerUrl!);
			await client.send('Runtime.enable');
			await client.send('Page.enable');

			await evaluateCDP(client, {
				awaitPromise: true,
				expression: `new Promise((resolve) => {
					if (document.readyState === 'complete') {
						resolve(true);
						return;
					}
					window.addEventListener('load', () => resolve(true), { once: true });
				})`,
				returnByValue: true
			});
			await evaluateCDP(client, {
				awaitPromise: true,
				expression: `new Promise((resolve, reject) => {
					const startedAt = Date.now();
					const tick = () => {
						const region = document.getElementById('governance-incident-region');
						if (region && region.textContent && region.textContent.includes('alpha-incident')) {
							resolve(true);
							return;
						}
						if (Date.now() - startedAt > 15000) {
							reject(new Error(document.body?.textContent ?? 'Timed out waiting for governance region'));
							return;
						}
						setTimeout(tick, 100);
					};
					tick();
				})`,
				returnByValue: true
			});

			const initialStatus = (await evaluateCDP<{
				result?: { value?: string };
			}>(client, {
				expression: `(() => {
					const region = document.getElementById('governance-incident-region');
					return region?.textContent ?? '';
				})()`,
				returnByValue: true
			})) as { result?: { value?: string } };
			expect(initialStatus.result?.value).toContain('alpha-incident');
			expect(initialStatus.result?.value).toContain('open');

			const clickResult = (await evaluateCDP<{
				result?: { value?: string };
			}>(client, {
				expression: `(() => {
					const cards = Array.from(document.querySelectorAll('#governance-incident-region .admin-card'));
					const card = cards.find((entry) => entry.textContent?.includes('alpha-incident'));
					if (!card) return 'missing-card';
					const button = Array.from(card.querySelectorAll('button')).find((entry) =>
						entry.textContent?.includes('Resolve')
					);
					if (!button) return 'missing-button';
					button.click();
					return 'clicked';
				})()`,
				returnByValue: true
			})) as { result?: { value?: string } };
			expect(clickResult.result?.value).toBe('clicked');

			await evaluateCDP(client, {
				awaitPromise: true,
				expression: `new Promise((resolve, reject) => {
					const startedAt = Date.now();
					const tick = () => {
						const region = document.getElementById('governance-incident-region');
						const text = region?.textContent ?? '';
						if (text.includes('alpha-incident') && text.includes('resolved')) {
							resolve(true);
							return;
						}
						if (Date.now() - startedAt > 15000) {
							reject(new Error(text || 'Timed out waiting for incident fragment update'));
							return;
						}
						setTimeout(tick, 100);
					};
					tick();
				})`,
				returnByValue: true
			});
		} finally {
			client?.close();
			try {
				chrome.kill();
			} catch {
				// already exited
			}
			await chrome.exited.catch(() => {});
			rmSync(userDataDir, { force: true, recursive: true });
		}
	}, 60_000);
});
