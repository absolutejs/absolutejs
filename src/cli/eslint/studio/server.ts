import { Elysia } from 'elysia';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyRuleEdit } from './editConfigRule';
import { isRecord } from './guards';
import { EslintStudio } from './page/EslintStudio';
import { resolveRuleCatalog } from './resolveConfig';
import { ensureStudioCert } from './studioCert';
import {
	ESLINT_STUDIO_DEFAULT_HOST,
	ESLINT_STUDIO_DEFAULT_PORT,
	HTTP_STATUS_BAD_REQUEST,
	UNFOUND_INDEX
} from '../../../constants';
import { handleReactPageRequest } from '../../../react/pageHandler';
import { killStaleProcesses, openUrlInBrowser } from '../../utils';
import type {
	RuleEditRequest,
	RuleEditResult,
	RuleSeverity
} from '../../../../types/eslintStudio';

const CLIENT_ROUTE = '/studio-client.js';

const flagValue = (args: string[], flag: string) => {
	const index = args.indexOf(flag);

	return index !== UNFOUND_INDEX ? args[index + 1] : undefined;
};

const resolvePort = (args: string[]) => {
	const fromFlag = Number(flagValue(args, '--port'));
	if (Number.isInteger(fromFlag) && fromFlag > 0) return fromFlag;

	const fromEnv = Number(process.env.ABSOLUTE_ESLINT_STUDIO_PORT);
	if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;

	return ESLINT_STUDIO_DEFAULT_PORT;
};

const resolveHost = (args: string[]) =>
	flagValue(args, '--host') ||
	process.env.ABSOLUTE_ESLINT_STUDIO_HOST ||
	ESLINT_STUDIO_DEFAULT_HOST;

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
			`Failed to build ESLint Studio client: ${built.logs.join('\n')}`
		);
	}

	const [output] = built.outputs;
	if (!output) throw new Error('ESLint Studio client produced no output.');

	return output.text();
};

const getClientBundle = async () => {
	if (cachedClientBundle !== null) return cachedClientBundle;

	cachedClientBundle = existsSync(distClientBundle)
		? readFileSync(distClientBundle, 'utf-8')
		: await buildClientBundle();

	return cachedClientBundle;
};

const renderPage = async (cwd: string, fileScope?: string) => {
	const catalog = await resolveRuleCatalog(cwd, fileScope);

	return handleReactPageRequest({
		index: CLIENT_ROUTE,
		Page: EslintStudio,
		props: { catalog }
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

export const launchEslintStudio = async (
	args: string[],
	cwd = process.cwd()
) => {
	const port = resolvePort(args);
	const host = resolveHost(args);
	const httpsRequested = !args.includes('--no-https');
	killStaleProcesses(port);

	// Fail fast with a clear message before binding a port if the project
	// has no flat config to manage.
	const { configPath } = await resolveRuleCatalog(cwd);

	const cert = httpsRequested ? ensureStudioCert(host) : null;

	const app = new Elysia()
		.get('/', ({ query }) => renderPage(cwd, fileScopeOf(query)))
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
	console.log(`\n${green}✓ ESLint Studio${reset} running at ${url}`);
	console.log(`${dim}Editing ${configPath} — press Ctrl+C to stop${reset}`);
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
