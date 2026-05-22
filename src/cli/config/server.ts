import { Elysia } from 'elysia';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigShell } from './page/ConfigShell';
import { DEFAULT_PANEL } from './panels';
import { applyRuleEdit } from './eslint/editConfigRule';
import { resolveRuleCatalog } from './eslint/resolveConfig';
import { ensureConfigCert } from './configCert';
import { isRecord } from './guards';
import { applyTsconfigEdit } from './tsconfig/editTsconfig';
import {
	findTsconfigPath,
	resolveTsconfigState
} from './tsconfig/resolveTsconfig';
import { applyPrettierEdit } from './prettier/editPrettier';
import { resolvePrettierState } from './prettier/resolvePrettier';
import { applyAbsoluteConfigEdit } from './absolute/editAbsoluteConfig';
import {
	findConfigPath,
	resolveAbsoluteConfigState
} from './absolute/resolveAbsoluteConfig';
import { applyFieldEdit, applyScriptEdit } from './packageJson/editPackageJson';
import {
	findPackageJsonPath,
	resolvePackageJsonState
} from './packageJson/resolvePackageJson';
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
import type { TsEditRequest, TsEditResult } from '../../../types/tsconfig';
import type {
	PrettierEditRequest,
	PrettierEditResult
} from '../../../types/prettier';
import type {
	AbsoluteConfigEditRequest,
	AbsoluteConfigEditResult
} from '../../../types/absoluteConfig';
import type {
	PackageFieldEdit,
	PackageJsonEditResult,
	PackageScriptEdit
} from '../../../types/packageJsonPanel';

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

// Renders only the shell (sidebar + skeleton) — instantly. The heavy data
// resolution (TS-type introspection, ESLint load) runs lazily when the client
// fetches /api/<panel>, so the first byte isn't blocked for seconds.
const renderShell = (panel: ConfigPanelId) =>
	handleReactPageRequest({
		Page: ConfigShell,
		index: CLIENT_ROUTE,
		props: { panel }
	});

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

const parseTsEditRequest = (body: unknown) => {
	if (!isRecord(body) || typeof body.name !== 'string') return null;

	const request: TsEditRequest = {
		name: body.name,
		remove: body.remove === true,
		value: body.value
	};

	return request;
};

const handleTsEdit = (cwd: string, body: unknown) => {
	const request = parseTsEditRequest(body);
	const configPath = findTsconfigPath(cwd);
	if (!request || !configPath) {
		const invalid: TsEditResult = {
			message: !configPath
				? 'No tsconfig.json found.'
				: 'Invalid edit request.',
			ok: false,
			state: null
		};

		return new Response(JSON.stringify(invalid), {
			headers: { 'Content-Type': 'application/json' },
			status: HTTP_STATUS_BAD_REQUEST
		});
	}

	const outcome = applyTsconfigEdit(configPath, request);
	const result: TsEditResult = {
		message: outcome.message,
		ok: outcome.ok,
		state: outcome.ok ? resolveTsconfigState(cwd) : null
	};

	return result;
};

const parsePrettierEdit = (body: unknown) => {
	if (!isRecord(body) || typeof body.name !== 'string') return null;

	const request: PrettierEditRequest = {
		name: body.name,
		remove: body.remove === true,
		value: body.value
	};

	return request;
};

const handlePrettierEdit = async (cwd: string, body: unknown) => {
	const request = parsePrettierEdit(body);
	const state = await resolvePrettierState(cwd);
	if (!request || !state.editable) {
		const invalid: PrettierEditResult = {
			message: !state.editable
				? 'This prettier config format is not editable here.'
				: 'Invalid edit request.',
			ok: false,
			state: null
		};

		return new Response(JSON.stringify(invalid), {
			headers: { 'Content-Type': 'application/json' },
			status: HTTP_STATUS_BAD_REQUEST
		});
	}

	const outcome = applyPrettierEdit(
		cwd,
		state.format,
		state.configPath,
		request
	);
	const result: PrettierEditResult = {
		message: outcome.message,
		ok: outcome.ok,
		state: outcome.ok ? await resolvePrettierState(cwd) : null
	};

	return result;
};

const parseAbsoluteEdit = (body: unknown) => {
	if (!isRecord(body) || typeof body.name !== 'string') return null;

	const request: AbsoluteConfigEditRequest = {
		name: body.name,
		remove: body.remove === true,
		value: body.value
	};

	return request;
};

const handleAbsoluteEdit = (cwd: string, body: unknown, override?: string) => {
	const request = parseAbsoluteEdit(body);
	const configPath = findConfigPath(cwd, override);
	if (!request || !configPath) {
		const invalid: AbsoluteConfigEditResult = {
			message: !configPath
				? 'No absolute.config.ts found.'
				: 'Invalid edit request.',
			ok: false,
			state: null
		};

		return new Response(JSON.stringify(invalid), {
			headers: { 'Content-Type': 'application/json' },
			status: HTTP_STATUS_BAD_REQUEST
		});
	}

	const outcome = applyAbsoluteConfigEdit(configPath, request);
	const result: AbsoluteConfigEditResult = {
		message: outcome.message,
		ok: outcome.ok,
		state: outcome.ok ? resolveAbsoluteConfigState(cwd, override) : null
	};

	return result;
};

const packageError = (message: string) => {
	const invalid: PackageJsonEditResult = { message, ok: false, state: null };

	return new Response(JSON.stringify(invalid), {
		headers: { 'Content-Type': 'application/json' },
		status: HTTP_STATUS_BAD_REQUEST
	});
};

const handleScriptEdit = (cwd: string, body: unknown) => {
	const configPath = findPackageJsonPath(cwd);
	if (!isRecord(body) || typeof body.name !== 'string' || !configPath) {
		return packageError(
			configPath ? 'Invalid script edit.' : 'No package.json found.'
		);
	}

	const edit: PackageScriptEdit = {
		command: typeof body.command === 'string' ? body.command : undefined,
		name: body.name,
		remove: body.remove === true,
		rename: typeof body.rename === 'string' ? body.rename : undefined
	};
	const outcome = applyScriptEdit(configPath, edit);
	const result: PackageJsonEditResult = {
		message: outcome.message,
		ok: outcome.ok,
		state: outcome.ok ? resolvePackageJsonState(cwd) : null
	};

	return result;
};

const handleFieldEdit = (cwd: string, body: unknown) => {
	const configPath = findPackageJsonPath(cwd);
	if (!isRecord(body) || typeof body.name !== 'string' || !configPath) {
		return packageError(
			configPath ? 'Invalid field edit.' : 'No package.json found.'
		);
	}

	const edit: PackageFieldEdit = {
		name: body.name,
		remove: body.remove === true,
		value: body.value
	};
	const outcome = applyFieldEdit(configPath, edit);
	const result: PackageJsonEditResult = {
		message: outcome.message,
		ok: outcome.ok,
		state: outcome.ok ? resolvePackageJsonState(cwd) : null
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
	const shouldOpen = args.includes('--open');
	const configOverride = flagValue(args, '--config');
	killStaleProcesses(port);

	const cert = httpsRequested ? ensureConfigCert(host) : null;

	const app = new Elysia()
		.get('/', () => renderShell(DEFAULT_PANEL))
		.get('/eslint', () => renderShell('eslint'))
		.get('/tsconfig', () => renderShell('tsconfig'))
		.get('/prettier', () => renderShell('prettier'))
		.get('/absolute', () => renderShell('absolute'))
		.get('/package', () => renderShell('package'))
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
		.get('/api/tsconfig', () => resolveTsconfigState(cwd))
		.post('/api/tsconfig', ({ body }) => handleTsEdit(cwd, body))
		.get('/api/prettier', () => resolvePrettierState(cwd))
		.post('/api/prettier', ({ body }) => handlePrettierEdit(cwd, body))
		.get('/api/absolute', () =>
			resolveAbsoluteConfigState(cwd, configOverride)
		)
		.post('/api/absolute', ({ body }) =>
			handleAbsoluteEdit(cwd, body, configOverride)
		)
		.get('/api/package', () => resolvePackageJsonState(cwd))
		.post('/api/package/script', ({ body }) => handleScriptEdit(cwd, body))
		.post('/api/package/field', ({ body }) => handleFieldEdit(cwd, body))
		.listen(listenOptions(port, cert));

	const url = cert ? `https://${host}:${port}` : `http://localhost:${port}`;
	const green = '\x1b[32m';
	const dim = '\x1b[2m';
	const reset = '\x1b[0m';
	console.log(`\n${green}✓ Absolute Config${reset} running at ${url}`);
	console.log(
		`${dim}absolute.config · package.json · ESLint · tsconfig · Prettier — Ctrl+C to stop${reset}`
	);
	if (!cert && httpsRequested) {
		console.log(
			`${dim}Tip: install mkcert (\`absolute mkcert\`) to serve a trusted https://${host}${reset}`
		);
	}
	if (shouldOpen) {
		openUrlInBrowser(url, (message) => console.warn(message));
	} else {
		console.log(`${dim}Open it in your browser, or pass --open.${reset}`);
	}
	console.log('');

	process.on('SIGINT', () => {
		app.stop();
		process.exit(0);
	});

	// The listening server keeps the event loop alive; nothing else to await.
	return app;
};
