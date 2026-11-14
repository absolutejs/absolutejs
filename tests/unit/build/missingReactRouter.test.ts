import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMissingReactRouterPlugin } from '../../../src/build/missingReactRouter';

const roots: string[] = [];
const always = () => true;

afterAll(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const bundle = async (source: string) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-missing-rr-'));
	roots.push(root);
	await writeFile(join(root, 'package.json'), '{ "name": "user-app" }');
	await writeFile(join(root, 'entry.ts'), source);
	const plugin = createMissingReactRouterPlugin(root, always);
	if (!plugin) throw new Error('expected a plugin');

	return Bun.build({
		entrypoints: [join(root, 'entry.ts')],
		plugins: [plugin],
		target: 'browser',
		throw: false
	});
};

const messagesOf = (result: Awaited<ReturnType<typeof bundle>>) =>
	result.logs.map((log) => log.message).join('\n');

describe('createMissingReactRouterPlugin', () => {
	test('is null when react-router is installed', () => {
		expect(createMissingReactRouterPlugin('/app', () => false)).toBeNull();
	});

	test('fails a project import of react-router with install advice', async () => {
		const result = await bundle(
			"import { useNavigate } from 'react-router';\nconsole.log(useNavigate);\n"
		);
		const messages = messagesOf(result);

		expect(result.success).toBe(false);
		expect(messages).toContain('Could not resolve "react-router"');
		expect(messages).toContain('bun add react-router');
		expect(messages).toContain(
			"import { Link } from '@absolutejs/absolute/react/components'"
		);
	});

	test('leaves a dynamic import of react-router to the runtime', async () => {
		const result = await bundle(
			"export const load = () => import('react-router').catch(() => null);\n"
		);

		expect(messagesOf(result)).toBe('');
		expect(result.success).toBe(true);
	});
});
