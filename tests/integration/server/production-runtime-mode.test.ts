import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RUNTIME_NODE_ENV_DEFINE } from '../../../scripts/runtimeNodeEnv';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* The published dist/ must decide development vs production from the
 * consumer's NODE_ENV at runtime. Bun.build folds a literal
 * `process.env.NODE_ENV` to "development" when nothing defines it, so
 * beta.168/169 shipped `isDev = () => true`: production error pages carried
 * `error.stack`, `client: 'none'` Vue pages inlined the dev reload client,
 * and React's production branch was dead code.
 *
 * Each case imports the built dist/ in a child process under both NODE_ENV
 * values; a folded check would make the two runs identical. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtureRoot = join(
	repoRoot,
	'.test-builds',
	`production-runtime-mode-${process.pid}`
);

type NodeEnv = 'development' | 'production';

type Probe = {
	errorPage: { body: string; status: number };
	react: string;
	vueNone: string;
};

const PROBE_SCRIPT = `
import { createElement } from 'react';
import { defineComponent, h } from 'vue';
import { handleReactPageRequest } from ${JSON.stringify(join(repoRoot, 'dist', 'react', 'server.js'))};
import { handleVuePageRequest } from ${JSON.stringify(join(repoRoot, 'dist', 'vue', 'server.js'))};

globalThis.__absoluteConventions = {
	react: { defaults: { error: ${JSON.stringify(join(fixtureRoot, 'ErrorPage.js'))} } }
};

const Throwing = () => {
	throw new Error('probe failure');
};
const errorResponse = await handleReactPageRequest({
	index: '/react-probe-index.js',
	Page: Throwing,
	pagePath: '/react/pages/Probe.js'
});
const react = await handleReactPageRequest({
	index: '/react-probe-index.js',
	Page: () => createElement('h1', null, 'react probe'),
	pagePath: '/react/pages/Probe.js'
});
const vueNone = await handleVuePageRequest({
	client: 'none',
	indexPath: '',
	Page: defineComponent({ setup: () => () => h('h1', 'vue probe') }),
	pagePath: '/vue/pages/Probe.js'
});

console.log(JSON.stringify({
	errorPage: { body: await errorResponse.text(), status: errorResponse.status },
	react: await react.text(),
	vueNone: await vueNone.text()
}));
`;

const probe = async (nodeEnv: NodeEnv) => {
	const proc = Bun.spawn(['bun', join(fixtureRoot, 'probe.ts')], {
		cwd: repoRoot,
		env: { ...process.env, NODE_ENV: nodeEnv, TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	if (exitCode !== 0)
		throw new Error(`probe (${nodeEnv}) failed:\n${stderr}`);
	const result: Probe = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}');

	return result;
};

const results: Partial<Record<NodeEnv, Probe>> = {};
const resultFor = (nodeEnv: NodeEnv) => {
	const result = results[nodeEnv];
	if (!result) throw new Error(`no ${nodeEnv} probe result`);

	return result;
};

beforeAll(async () => {
	await ensureDistBuild();
	await mkdir(fixtureRoot, { recursive: true });
	await writeFile(
		join(fixtureRoot, 'ErrorPage.js'),
		`import { createElement } from 'react';
export default ({ message, stack }) =>
	createElement('main', null, createElement('h1', null, message), createElement('pre', null, stack ?? 'NO_STACK'));
`
	);
	await writeFile(join(fixtureRoot, 'probe.ts'), PROBE_SCRIPT);
	const [production, development] = await Promise.all([
		probe('production'),
		probe('development')
	]);
	results.production = production;
	results.development = development;
}, 600_000);

afterAll(async () => {
	await rm(fixtureRoot, { force: true, recursive: true });
});

describe('dist/ reads NODE_ENV at runtime', () => {
	test('an error convention page gets no stack in production', () => {
		const production = resultFor('production').errorPage;
		const development = resultFor('development').errorPage;

		expect(production.status).toBe(500);
		// Production gets a generic message instead of the error's own.
		expect(production.body).toContain(
			'Something went wrong while rendering this page.'
		);
		expect(production.body).not.toContain('probe failure');
		expect(production.body).toContain('NO_STACK');
		expect(production.body).not.toContain('at Throwing');
		expect(development.body).toContain('Error: probe failure');
		expect(development.body).not.toContain('NO_STACK');
	});

	test("a client: 'none' Vue page ships no script in production", () => {
		const production = resultFor('production').vueNone;

		expect(production).toContain('<h1>vue probe</h1>');
		expect(production).not.toContain('<script');
		expect(resultFor('development').vueNone).toContain('<script');
	});

	test('React pages take the production path in production', () => {
		const production = resultFor('production').react;

		expect(production).toContain('react probe');
		expect(production).not.toContain('__REFRESH_BUFFER__');
		expect(resultFor('development').react).toContain('__REFRESH_BUFFER__');
	});
});

describe('the library build keeps NODE_ENV a runtime read', () => {
	test('the shared define leaves process.env.NODE_ENV in the output', async () => {
		const entry = join(fixtureRoot, 'canary.ts');
		await writeFile(
			entry,
			"export const isDev = () => process.env.NODE_ENV === 'development';\n"
		);
		const result = await Bun.build({
			define: RUNTIME_NODE_ENV_DEFINE,
			entrypoints: [entry],
			target: 'bun'
		});
		const [output] = result.outputs;
		if (!output) throw new Error('canary build produced no output');

		expect(await output.text()).toContain(
			'process.env.NODE_ENV === "development"'
		);
	});

	test('every Bun.build in scripts/build.ts sets a NODE_ENV define', async () => {
		const source = await readFile(
			join(repoRoot, 'scripts', 'build.ts'),
			'utf8'
		);
		const calls = source.split('Bun.build({').slice(1);

		expect(calls.length).toBeGreaterThan(0);
		const undefinedCalls = calls
			.map((call, index) => ({ head: call.slice(0, 200), index }))
			.filter(
				({ head }) =>
					!/^\s*define: (?:RUNTIME_NODE_ENV_DEFINE|\{ 'process\.env\.NODE_ENV')/.test(
						head
					)
			);
		expect(undefinedCalls).toEqual([]);
	});

	test('no dist/ module folds the development check to a constant', async () => {
		const files = await Array.fromAsync(
			new Bun.Glob('**/*.js').scan({ cwd: join(repoRoot, 'dist') })
		);
		const sources = await Promise.all(
			files.map(async (file) => ({
				file,
				source: await readFile(join(repoRoot, 'dist', file), 'utf8')
			}))
		);
		// The shapes the beta.168 dist shipped for src/utils/resolveConvention.ts
		// and friends once Bun folded their NODE_ENV comparison.
		const folded = /\bisDev\s*=\s*\(\)\s*=>\s*(?:true|false)\b/;
		const offenders = sources
			.filter(({ source }) => folded.test(source))
			.map(({ file }) => file);

		expect(offenders).toEqual([]);
	});
});
