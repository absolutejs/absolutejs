import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { handleAngularPageRequest } from '../../../src/angular';

const FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'streaming-page.ts'
);
const DEFER_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'defer-streaming-page.ts'
);
let angularSsrOutDir = '';

beforeAll(async () => {
	angularSsrOutDir = await mkdtemp(
		join(tmpdir(), 'absolutejs-angular-streaming-')
	);
	await symlink(
		resolve(import.meta.dir, '..', '..', '..', 'node_modules'),
		join(angularSsrOutDir, 'node_modules'),
		'dir'
	);
	process.env.ABSOLUTE_ANGULAR_SSR_OUTDIR = angularSsrOutDir;
});

afterAll(async () => {
	delete process.env.ABSOLUTE_ANGULAR_SSR_OUTDIR;
	if (angularSsrOutDir) {
		await rm(angularSsrOutDir, { force: true, recursive: true });
	}
});

describe('handleAngularPageRequest streaming', () => {
	const importAngularStreamingFixture = () =>
		import(FIXTURE).then((module) => module.AngularStreamingTestPage);
	const importAngularDeferFixture = () =>
		import(DEFER_FIXTURE).then(
			(module) => module.AngularDeferStreamingTestPage
		);

	test('injects runtime and appends patches for registered StreamSlot components', async () => {
		const response = await handleAngularPageRequest(
			importAngularStreamingFixture as never,
			FIXTURE,
			'/angular-test-index.js',
			'<head><title>Angular Streaming Test</title></head>',
			undefined,
			{ collectStreamingSlots: true }
		);
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"angular-fast"');
		const slowPatchIndex = html.indexOf('"angular-slow"');

		expect(response.headers.get('Content-Type')).toBe('text/html');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="angular-fast"');
		expect(html).toContain('id="angular-slow"');
		expect(html).toContain(
			'<script>import("/angular-test-index.js");</script>'
		);
		expect(html).toContain('angular fast resolved');
		expect(html).toContain('angular slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});

	test('injects runtime and appends patches for lowered @defer blocks', async () => {
		const response = await handleAngularPageRequest(
			importAngularDeferFixture as never,
			DEFER_FIXTURE,
			'/angular-defer-test-index.js',
			'<head><title>Angular Defer Streaming Test</title></head>',
			undefined,
			{ collectStreamingSlots: true }
		);
		const html = await response.text();
		const fastPatchIndex = html.indexOf('angular defer fast resolved');
		const slowPatchIndex = html.indexOf('angular defer slow resolved');

		expect(response.headers.get('Content-Type')).toBe('text/html');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="absolute-angular-defer-0"');
		expect(html).toContain('id="absolute-angular-defer-1"');
		expect(html).toContain(
			'<script>import("/angular-defer-test-index.js");</script>'
		);
		expect(html).toContain('angular defer fast resolved');
		expect(html).toContain('angular defer slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});
});
