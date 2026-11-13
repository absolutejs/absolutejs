import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	renderConventionError,
	setConventions
} from '../../../src/utils/resolveConvention';
import { ssrErrorPage } from '../../../src/utils/ssrErrorPage';

/* Error messages carry server details: a failed read names the absolute
 * path it tried. Outside development, error pages (the built-in one and
 * every framework's error convention) get a generic message instead. */

const originalNodeEnv = process.env.NODE_ENV;
const SECRET_PATH = '/srv/secret/build/html/pages/Nope.html';
const leakyError = () =>
	new Error(`ENOENT: no such file or directory, open '${SECRET_PATH}'`);
const tempDirs: string[] = [];

afterEach(async () => {
	process.env.NODE_ENV = originalNodeEnv;
	setConventions({});
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { force: true, recursive: true });
	}
});

const writeErrorConvention = async () => {
	const dir = await mkdtemp(join(tmpdir(), 'absolute-error-page-'));
	tempDirs.push(dir);
	await mkdir(dir, { recursive: true });
	const htmlPath = join(dir, 'error.html');
	await writeFile(
		htmlPath,
		'<!doctype html><html><body><p id="m">{{ message }}</p><pre>{{ stack }}</pre></body></html>'
	);
	const angularPath = join(dir, 'error.js');
	await writeFile(
		angularPath,
		'export default (error) => `<!DOCTYPE html><p>${error.message}</p><pre>${error.stack ?? ""}</pre>`;\n'
	);
	setConventions({
		angular: { defaults: { error: angularPath } },
		html: { defaults: { error: htmlPath } }
	});
};

describe('error page messages', () => {
	test('the built-in error page hides the message in production', () => {
		process.env.NODE_ENV = 'production';
		const html = ssrErrorPage('react', leakyError());

		expect(html).not.toContain(SECRET_PATH);
		expect(html).toContain('Something went wrong');
	});

	test('the built-in error page shows the message in development', () => {
		process.env.NODE_ENV = 'development';

		expect(ssrErrorPage('react', leakyError())).toContain(SECRET_PATH);
	});

	test('error conventions get a generic message and no stack in production', async () => {
		process.env.NODE_ENV = 'production';
		await writeErrorConvention();
		for (const framework of ['html', 'htmx', 'angular', 'react'] as const) {
			const response = await renderConventionError(
				framework,
				'Nope',
				leakyError()
			);
			const html = (await response?.text()) ?? '';

			expect(response?.status).toBe(500);
			expect(html).toContain('Something went wrong');
			expect(html).not.toContain(SECRET_PATH);
			expect(html).not.toContain('ENOENT');
			expect(html).not.toContain('errorPageMessages.test');
		}
	});

	test('error conventions keep the message and stack in development', async () => {
		process.env.NODE_ENV = 'development';
		await writeErrorConvention();
		const response = await renderConventionError(
			'html',
			'Nope',
			leakyError()
		);
		const html = (await response?.text()) ?? '';

		expect(html).toContain(SECRET_PATH);
		expect(html).toContain('errorPageMessages.test');
	});
});
