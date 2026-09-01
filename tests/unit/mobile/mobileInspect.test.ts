import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import {
	inspectAbsoluteMobileProject,
	renderAbsoluteMobileProjectInspection
} from '../../../src/mobile/mobileInspect';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const writeJson = async (path: string, value: unknown) => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, '\t')}\n`);
};

const fixture = async () => {
	const projectRoot = await mkdtemp(
		join(tmpdir(), 'absolute-mobile-inspect-')
	);
	roots.push(projectRoot);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.inspect',
			appName: 'Inspect',
			platforms: ['android'],
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);
	await writeJson(join(projectRoot, 'package.json'), {
		dependencies: {
			'@absolutejs/devices': '0.7.0',
			'@absolutejs/devices-capacitor': '0.8.0',
			'@capacitor/core': '8.5.0'
		},
		name: 'inspection-fixture'
	});
	for (const [name, version] of [
		['@absolutejs/devices', '0.7.0'],
		['@capacitor/core', '8.5.0']
	] as const)
		await writeJson(
			join(projectRoot, 'node_modules', name, 'package.json'),
			{
				name,
				version
			}
		);
	const providerManifest = join(
		projectRoot,
		'node_modules/@absolutejs/devices-capacitor/package.json'
	);
	await mkdir(dirname(providerManifest), { recursive: true });
	await cp(
		join(
			import.meta.dir,
			'../../../node_modules/@absolutejs/devices-capacitor/package.json'
		),
		providerManifest,
		{ recursive: true }
	);
	await writeFile(
		join(projectRoot, 'page.ts'),
		`import { clipboard } from '@absolutejs/devices'; void clipboard.readText();`
	);
	await mkdir(join(config.nativeProjectDirectory, 'android'), {
		recursive: true
	});
	await mkdir(join(config.bundleDirectory, 'pages'), { recursive: true });
	await writeFile(
		join(config.bundleDirectory, 'index.html'),
		'<main></main>'
	);
	await writeFile(
		join(config.bundleDirectory, 'absolute-mobile-bootstrap.js'),
		'export {};'
	);
	await writeFile(
		join(config.bundleDirectory, 'pages/react.js'),
		'export default {};'
	);
	const bundleHash = createHash('sha256')
		.update('export default {};')
		.digest('hex');
	await writeJson(
		join(config.bundleDirectory, 'absolute-mobile-manifest.json'),
		{
			appBuild: 'ambuild_inspection',
			appId: config.appId,
			appName: config.appName,
			deepLinkHosts: config.deepLinkHosts,
			deepLinkScheme: config.deepLinkScheme,
			deviceCapabilities: ['clipboard', 'keyboard', 'systemBars'],
			entry: '/',
			format: 1,
			pages: [
				{
					bundleHash,
					bundlePath: '/indexes/react.js',
					contract: 'react:index:1',
					framework: 'react',
					localBundlePath: 'pages/react.js',
					pageId: 'react:index',
					propsSchemaHash: 'props-hash'
				}
			],
			productionOrigin: config.productionOrigin,
			routes: [{ method: 'GET', pageId: 'react:index', pattern: '/' }],
			runtime: '1'
		}
	);

	return { config, projectRoot };
};

const releaseInspection = async () => ({
	checks: [
		{
			detail: 'safe',
			id: 'android.capacitor-config',
			status: 'pass' as const
		}
	],
	ready: true
});

describe('mobile project inspection', () => {
	test('reports a validated redacted mobile project inventory', async () => {
		const { config, projectRoot } = await fixture();
		const report = await inspectAbsoluteMobileProject(config, projectRoot, {
			absolutejsVersion: '0.20.0-beta.test',
			inspectRelease: releaseInspection
		});

		expect(report).toMatchObject({
			bundle: {
				appBuild: 'ambuild_inspection',
				frameworks: ['react'],
				pageCount: 1,
				routeCount: 1,
				status: 'valid'
			},
			capabilities: {
				current: ['clipboard', 'keyboard', 'systemBars'],
				embeddedMatchesCurrent: true,
				plugins: [
					'@capacitor/clipboard@8.0.1',
					'@capacitor/keyboard@8.0.5'
				]
			},
			nativeProjects: [
				{
					initialized: true,
					path: 'mobile/android',
					platform: 'android'
				}
			],
			release: { ready: true },
			runtime: { absolutejs: '0.20.0-beta.test' }
		});
		expect(
			report.packages.find(({ name }) => name === '@capacitor/clipboard')
		).toEqual({
			declared: 'transitive',
			name: '@capacitor/clipboard'
		});
		const serialized = JSON.stringify(report);
		expect(serialized).not.toContain(projectRoot);
		expect(serialized).not.toContain('safe');
		expect(renderAbsoluteMobileProjectInspection(report)).toContain(
			'Bundle: valid'
		);
	});

	test('reports missing and invalid bundles without throwing', async () => {
		const { config, projectRoot } = await fixture();
		await rm(join(config.bundleDirectory, 'absolute-mobile-manifest.json'));
		const missing = await inspectAbsoluteMobileProject(
			config,
			projectRoot,
			{
				inspectRelease: releaseInspection
			}
		);
		expect(missing.bundle).toEqual({
			manifest: '.absolutejs/mobile/web/absolute-mobile-manifest.json',
			status: 'missing'
		});

		await writeJson(
			join(config.bundleDirectory, 'absolute-mobile-manifest.json'),
			{ format: 1 }
		);
		const invalid = await inspectAbsoluteMobileProject(
			config,
			projectRoot,
			{
				inspectRelease: releaseInspection
			}
		);
		expect(invalid.bundle.status).toBe('invalid');
		expect(invalid.bundle.issue).toBe('appId must be a non-empty string.');
	});

	test('rejects an embedded page modified after the manifest was signed', async () => {
		const { config, projectRoot } = await fixture();
		await writeFile(
			join(config.bundleDirectory, 'pages/react.js'),
			'export default { tampered: true };'
		);
		const report = await inspectAbsoluteMobileProject(config, projectRoot, {
			inspectRelease: releaseInspection
		});

		expect(report.bundle.status).toBe('invalid');
		expect(report.bundle.issue).toContain('SHA-256 integrity check');
	});
});
