import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	devtoolsJson,
	normalizeDevtoolsWorkspaceRoot,
	resolveDevtoolsUuidCachePath
} from '../../../src/plugins/devtoolsJson';

const originalWslDistroName = process.env.WSL_DISTRO_NAME;
const originalDockerDesktop = process.env.DOCKER_DESKTOP;
const tempDirs: string[] = [];

afterEach(() => {
	if (originalWslDistroName === undefined) {
		delete process.env.WSL_DISTRO_NAME;
	} else {
		process.env.WSL_DISTRO_NAME = originalWslDistroName;
	}

	if (originalDockerDesktop === undefined) {
		delete process.env.DOCKER_DESKTOP;
	} else {
		process.env.DOCKER_DESKTOP = originalDockerDesktop;
	}

	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('normalizeDevtoolsWorkspaceRoot', () => {
	test('returns the original path by default', () => {
		delete process.env.WSL_DISTRO_NAME;
		delete process.env.DOCKER_DESKTOP;

		expect(normalizeDevtoolsWorkspaceRoot('/home/alex/project')).toBe(
			'/home/alex/project'
		);
	});

	test('rewrites WSL paths to UNC form for Chrome on Windows', () => {
		process.env.WSL_DISTRO_NAME = 'Ubuntu-24.04';
		delete process.env.DOCKER_DESKTOP;

		expect(normalizeDevtoolsWorkspaceRoot('/home/alex/project')).toBe(
			'\\\\wsl.localhost\\Ubuntu-24.04\\home\\alex\\project'
		);
	});

	test('rewrites Docker Desktop paths to UNC form', () => {
		delete process.env.WSL_DISTRO_NAME;
		process.env.DOCKER_DESKTOP = '1';

		expect(normalizeDevtoolsWorkspaceRoot('/workspace/app')).toBe(
			'\\\\wsl.localhost\\docker-desktop-data\\workspace\\app'
		);
	});

	test('does not rewrite an existing UNC path for Docker Desktop', () => {
		delete process.env.WSL_DISTRO_NAME;
		process.env.DOCKER_DESKTOP = '1';

		expect(
			normalizeDevtoolsWorkspaceRoot(
				'\\\\wsl.localhost\\docker-desktop-data\\workspace\\app'
			)
		).toBe('\\\\wsl.localhost\\docker-desktop-data\\workspace\\app');
	});
});

describe('resolveDevtoolsUuidCachePath', () => {
	test('uses the default cache path under the build directory', () => {
		expect(resolveDevtoolsUuidCachePath('/tmp/build')).toBe(
			'/tmp/build/.absolute/chrome-devtools-workspace-uuid'
		);
	});

	test('uses a custom cache path when provided', () => {
		expect(
			resolveDevtoolsUuidCachePath(
				'/tmp/build',
				'/tmp/custom/devtools-workspace-uuid'
			)
		).toBe('/tmp/custom/devtools-workspace-uuid');
	});
});

describe('devtoolsJson', () => {
	test('persists a generated UUID to a custom cache path', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'absolute-devtools-json-'));
		tempDirs.push(tempDir);
		const buildDir = join(tempDir, 'build');
		const uuidCachePath = join(tempDir, 'cache', 'workspace-uuid');

		const app = new (await import('elysia')).Elysia().use(
			devtoolsJson(buildDir, {
				normalizeForWindowsContainer: false,
				projectRoot: '/tmp/project-root',
				uuidCachePath
			})
		);
		const res = await app.handle(
			new Request(
				'http://localhost/.well-known/appspecific/com.chrome.devtools.json'
			)
		);
		const body = (await res.json()) as {
			workspace: { root: string; uuid: string };
		};

		expect(existsSync(uuidCachePath)).toBe(true);
		expect(readFileSync(uuidCachePath, 'utf-8').trim()).toBe(
			body.workspace.uuid
		);
		expect(body.workspace.root).toBe('/tmp/project-root');
	});
});
