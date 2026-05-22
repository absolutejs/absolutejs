import { Elysia } from 'elysia';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigShell } from './page/ConfigShell';
import { DEFAULT_PANEL } from './panels';
import { applyRuleEdit } from './eslint/editConfigRule';
import { resolveRuleCatalog } from './eslint/resolveConfig';
import { ensureConfigCert } from './configCert';
import { isRecord } from './guards';
import {
	CONFIG_DEFAULT_HOST,
	CONFIG_DEFAULT_PORT,
	HTTP_STATUS_BAD_REQUEST,
	UNFOUND_INDEX
} from '../../constants';
import { handleReactPageRequest } from '../../react/pageHandler';
import { killStaleProcesses, openUrlInBrowser } from '../utils';
import type { ConfigPanelId } from '../../../types/config';
import type {
	RuleEditRequest,
	RuleEditResult,
	RuleSeverity
} from '../../../types/eslintConfig';

const CLIENT_ROUTE = '/config-client.js';

const flagValue = (args: string[], flag: string) => {
	const index = args.indexOf(flag);

	return index !== UNFOUND_INDEX ? args[index + 1] : undefined;
};

const resolvePort = (args: string[]) => {
	const fromFlag = Number(flagValue(args, '--port'));
	if (Number.isInteger(fromFlag) && fromFlag > 0) return fromFlag;

	const fromEnv = Number(process.env.ABSOLUTE_CONFIG_PORT);
	if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;

	return CONFIG_DEFAULT_PORT;
};

const resolveHost = (args: string[]) =>
	flagValue(args, '--host') ||
	process.env.ABSOLUTE_CONFIG_HOST ||
	CONFIG_DEFAULT_HOST;

const fileScopeOf = (query: Record<string, unknown>) =>
	typeof query.file === 'string' ? query.file : undefined;

/** Built client bundle shipped beside this file in `dist/`; absent when
 *  running from source, where we build it on the fly instead. */
const distClientBundle = resolve(import.meta.dir, 'client.js');
const sourceClientEntry = resolve(import.meta.dir, 'client.tsx');

let cachedClientBundle: string | null = null;

const buildClientBundle = async () => {
	const built = await Bun.build({
		define: { 'process.env.NODE_ENV': '"production"' },
		entrypoints: [sourceClientEntry],
		minify: true,
		target: 'browser'
	});
	if (!built.success) {
		throw new Error(
			`Failed to build Absolute Config client: ${built.logs.join('\n')}`
		);
	}

	const [output] = built.outputs;
	if (!output) throw new Error('Absolute Config client produced no output.');

	return output.text();
};

const getClientBundle = async () => {
	if (cachedClientBundle !== null) return cachedClientBundle;

	cachedClientBundle = existsSync(distClientBundle)
		? readFileSync(distClientBundle, 'utf-8')
		: await buildClientBundle();

	return cachedClientBundle;
};

const renderShell = async (
	panel: ConfigPanelId,
	cwd: string,
	fileScope?: string
) => {
	const eslintCatalog =
		panel === 'eslint' ? await resolveRuleCatalog(cwd, fileScope) : null;

	return handleReactPageRequest({
		Page: ConfigShell,
		index: CLIENT_ROUTE,
		props: { eslintCatalog, panel }
	});
};

const isSeverity = (value: unknown): value is RuleSeverity =>
	value === 'off' || value === 'warn' || value === 'error';

const parseEditRequest = (body: unknown) => {
	if (!isRecord(body)) return null;
	const { name, options, severity, sourceIndex } = body;
	if (
		typeof name !== 'string' ||
		typeof sourceIndex !== 'number' ||
		!isSeverity(severity)
	) {
		return null;
	}

	const request: RuleEditRequest = {
		name,
		options: Array.isArray(options) ? options : undefined,
		severity,
		sourceIndex
	};

	return request;
};

const handleEdit = async (cwd: string, body: unknown) => {
	const request = parseEditRequest(body);
	if (!request) {
		const invalid: RuleEditResult = {
			catalog: null,
			message: 'Invalid edit request.',
			ok: false
		};

		return new Response(JSON.stringify(invalid), {
			headers: { 'Content-Type': 'application/json' },
			status: HTTP_STATUS_BAD_REQUEST
		});
	}

	const fileScope =
		isRecord(body) && typeof body.file === 'string' ? body.file : undefined;
	const { configPath } = await resolveRuleCatalog(cwd);
	const outcome = applyRuleEdit(configPath, request);
	const result: RuleEditResult = {
		catalog: outcome.ok ? await resolveRuleCatalog(cwd, fileScope) : null,
		message: outcome.message,
		ok: outcome.ok
	};

	return result;
};

const listenOptions = (
	port: number,
	cert: { cert: string; key: string } | null
) =>
	cert
		? { hostname: '127.0.0.1', port, tls: cert }
		: { hostname: '127.0.0.1', port };

export const launchConfig = async (args: string[], cwd = process.cwd()) => {
	const port = resolvePort(args);
	const host = resolveHost(args);
	const httpsRequested = !args.includes('--no-https');
	killStaleProcesses(port);

	const cert = httpsRequested ? ensureConfigCert(host) : null;

	const app = new Elysia()
		.get('/', ({ query }) =>
			renderShell(DEFAULT_PANEL, cwd, fileScopeOf(query))
		)
		.get('/eslint', ({ query }) =>
			renderShell('eslint', cwd, fileScopeOf(query))
		)
		.get('/tsconfig', () => renderShell('tsconfig', cwd))
		.get('/prettier', () => renderShell('prettier', cwd))
		.get(CLIENT_ROUTE, async () => {
			const bundle = await getClientBundle();

			return new Response(bundle, {
				headers: { 'Content-Type': 'text/javascript; charset=utf-8' }
			});
		})
		.get('/api/rules', ({ query }) =>
			resolveRuleCatalog(cwd, fileScopeOf(query))
		)
		.post('/api/rules', ({ body }) => handleEdit(cwd, body))
		.listen(listenOptions(port, cert));

	const url = cert ? `https://${host}:${port}` : `http://localhost:${port}`;
	const green = '\x1b[32m';
	const dim = '\x1b[2m';
	const reset = '\x1b[0m';
	console.log(`\n${green}✓ Absolute Config${reset} running at ${url}`);
	console.log(
		`${dim}ESLint · tsconfig · Prettier — press Ctrl+C to stop${reset}`
	);
	if (!cert && httpsRequested) {
		console.log(
			`${dim}Tip: install mkcert (\`absolute mkcert\`) to serve a trusted https://${host}${reset}`
		);
	}
	console.log('');
	openUrlInBrowser(url, (message) => console.warn(message));

	process.on('SIGINT', () => {
		app.stop();
		process.exit(0);
	});

	// The listening server keeps the event loop alive; nothing else to await.
	return app;
};
