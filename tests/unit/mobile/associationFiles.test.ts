import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepare } from '../../../src/core/prepare';
import {
	type AbsoluteAssociationRequest,
	ANDROID_ASSOCIATION_PATH,
	APPLE_ASSOCIATION_PATH,
	createAbsoluteMobileAssociationDocuments,
	createAbsoluteMobileAssociationPlugin,
	materializeAbsoluteMobileAssociationFiles,
	verifyAbsoluteMobileAssociationFiles
} from '../../../src/mobile/associationFiles';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

const FINGERPRINT =
	'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA';
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const mobile = {
	appId: 'com.example.product',
	appName: 'Product',
	deepLinks: {
		android: { sha256CertificateFingerprints: [FINGERPRINT] },
		apple: { appIdPrefix: 'ABCDE12345' },
		hosts: ['links.example.com']
	},
	server: { productionOrigin: 'https://api.example.com' }
} as const;

describe('mobile association files', () => {
	test('builds Apple and Android documents from normalized signing identity', () => {
		const documents = createAbsoluteMobileAssociationDocuments(
			normalizeAbsoluteMobileConfig(mobile, '/workspace'),
			{ requireAll: true }
		);

		expect(documents.apple?.applinks.details[0]).toEqual({
			appIDs: ['ABCDE12345.com.example.product'],
			components: [{ '/': '/*' }]
		});
		expect(documents.android?.[0].target).toEqual({
			namespace: 'android_app',
			package_name: 'com.example.product',
			sha256_cert_fingerprints: [FINGERPRINT]
		});
	});

	test('serves extensionless AASA and assetlinks JSON without redirects', async () => {
		const app = createAbsoluteMobileAssociationPlugin(
			mobile,
			'/workspace',
			{ requireAll: true }
		);
		const apple = await app.handle(
			new Request(`https://api.example.com${APPLE_ASSOCIATION_PATH}`)
		);
		const android = await app.handle(
			new Request(`https://api.example.com${ANDROID_ASSOCIATION_PATH}`)
		);

		expect(apple.status).toBe(200);
		expect(apple.headers.get('content-type')).toBe(
			'application/json; charset=utf-8'
		);
		expect((await apple.json()).applinks).toBeDefined();
		expect(android.status).toBe(200);
		expect((await android.json())[0].target.package_name).toBe(
			'com.example.product'
		);
	});

	test('mounts association documents in the production prepare runtime', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-associations-'));
		temporaryDirectories.push(root);
		const build = join(root, 'build');
		const configPath = join(root, 'absolute.config.ts');
		await mkdir(build);
		await writeFile(join(build, 'manifest.json'), '{}');
		await writeFile(
			configPath,
			`export default ${JSON.stringify({ buildDirectory: build, mobile })};\n`
		);
		const previousNodeEnv = process.env.NODE_ENV;
		const previousBuildDirectory = process.env.ABSOLUTE_BUILD_DIR;
		process.env.NODE_ENV = 'production';
		process.env.ABSOLUTE_BUILD_DIR = build;
		try {
			const { absolutejs } = await prepare(configPath);
			const response = await absolutejs.handle(
				new Request(`https://api.example.com${APPLE_ASSOCIATION_PATH}`)
			);

			expect(response.status).toBe(200);
			expect((await response.json()).applinks).toBeDefined();
		} finally {
			if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
			else process.env.NODE_ENV = previousNodeEnv;
			if (previousBuildDirectory === undefined) {
				delete process.env.ABSOLUTE_BUILD_DIR;
			} else {
				process.env.ABSOLUTE_BUILD_DIR = previousBuildDirectory;
			}
		}
	});

	test('writes a deployment-ready well-known tree for every host', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-associations-'));
		temporaryDirectories.push(root);
		const config = normalizeAbsoluteMobileConfig(mobile, root);
		const result = await materializeAbsoluteMobileAssociationFiles(
			config,
			join(root, 'output')
		);
		const repeated = await materializeAbsoluteMobileAssociationFiles(
			config,
			join(root, 'output')
		);

		expect(result.written).toHaveLength(4);
		expect(repeated.written).toHaveLength(4);
		const apple = JSON.parse(
			await readFile(
				join(
					root,
					'output/links.example.com/.well-known/apple-app-site-association'
				),
				'utf8'
			)
		);
		expect(apple.applinks.details[0].appIDs).toEqual([
			'ABCDE12345.com.example.product'
		]);
	});

	test('replaces only an owned output tree so removed platforms cannot leave stale trust', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-associations-'));
		temporaryDirectories.push(root);
		const output = join(root, 'output');
		await materializeAbsoluteMobileAssociationFiles(
			normalizeAbsoluteMobileConfig(mobile, root),
			output
		);
		const iosOnly = normalizeAbsoluteMobileConfig(
			{ ...mobile, platforms: ['ios'] },
			root
		);
		await materializeAbsoluteMobileAssociationFiles(iosOnly, output);

		expect(
			await Bun.file(
				join(output, 'api.example.com/.well-known/assetlinks.json')
			).exists()
		).toBe(false);
		expect(
			await Bun.file(
				join(
					output,
					'api.example.com/.well-known/apple-app-site-association'
				)
			).exists()
		).toBe(true);
	});

	test('requires platform signing identities for release publication', () => {
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				platforms: ['ios'],
				server: { productionOrigin: 'https://api.example.com' }
			},
			'/workspace'
		);

		expect(() =>
			createAbsoluteMobileAssociationDocuments(config, {
				requireAll: true
			})
		).toThrow('apple.appIdPrefix');
	});

	test('refuses to replace an output directory it does not own', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-associations-'));
		temporaryDirectories.push(root);
		const output = join(root, 'output');
		await mkdir(output);
		await writeFile(join(output, 'user-file.txt'), 'keep');

		await expect(
			materializeAbsoluteMobileAssociationFiles(
				normalizeAbsoluteMobileConfig(mobile, root),
				output
			)
		).rejects.toThrow('not owned by AbsoluteJS');
		expect(await readFile(join(output, 'user-file.txt'), 'utf8')).toBe(
			'keep'
		);
	});

	test('externally verifies every host without following redirects', async () => {
		const config = normalizeAbsoluteMobileConfig(mobile, '/workspace');
		const documents = createAbsoluteMobileAssociationDocuments(config, {
			requireAll: true
		});
		const requested: string[] = [];
		const request: AbsoluteAssociationRequest = async (
			input: string | URL | Request,
			init?: RequestInit
		) => {
			const url = new URL(String(input));
			requested.push(url.href);
			expect(init?.redirect).toBe('manual');
			const document = url.pathname.endsWith('assetlinks.json')
				? documents.android
				: documents.apple;

			return new Response(JSON.stringify(document), {
				headers: { 'content-type': 'application/json' }
			});
		};

		const result = await verifyAbsoluteMobileAssociationFiles(
			config,
			request
		);

		expect(result.results).toHaveLength(4);
		expect(requested).toContain(
			'https://links.example.com/.well-known/apple-app-site-association'
		);
	});

	test('rejects redirected hosted association files', async () => {
		const config = normalizeAbsoluteMobileConfig(mobile, '/workspace');
		const redirected: AbsoluteAssociationRequest = async () =>
			new Response(null, {
				headers: { location: 'https://cdn.example.com/associations' },
				status: 302
			});

		await expect(
			verifyAbsoluteMobileAssociationFiles(config, redirected)
		).rejects.toThrow('redirects are not allowed');
	});
});
