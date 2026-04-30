import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { generateManifest } from '../../../src/build/generateManifest';
import {
	mergeBunBuildConfig,
	resolveBunBuildOverride
} from '../../../src/core/build';
import { isWorkspaceConfig } from '../../../src/utils/loadConfig';
import type {
	BuildArtifact,
	BuildConfig as BunBuildConfig,
	BunPlugin
} from 'bun';

const plugin = (name: string) =>
	({
		name,
		setup() {}
	}) as BunPlugin;

const artifact = (path: string, hash: string | null = 'abc123') =>
	({
		hash,
		path
	}) as BuildArtifact;

describe('bunBuild config overrides', () => {
	test('resolves shorthand config as the pass default', () => {
		const override = resolveBunBuildOverride(
			{
				minify: false,
				sourcemap: 'linked'
			},
			'reactClient'
		);

		expect(override).toEqual({
			minify: false,
			sourcemap: 'linked'
		});
	});

	test('merges default and pass-specific config with pass-specific values winning', () => {
		const override = resolveBunBuildOverride(
			{
				default: {
					minify: true,
					sourcemap: 'linked'
				},
				reactClient: {
					minify: false
				}
			},
			'reactClient'
		);

		expect(override).toEqual({
			minify: false,
			sourcemap: 'linked'
		});
	});

	test('strips reserved fields at runtime before merging', () => {
		const override = resolveBunBuildOverride(
			{
				default: {
					sourcemap: 'linked'
				},
				reactClient: {
					outdir: 'unsafe',
					target: 'bun',
					throw: true
				} as unknown as BunBuildConfig
			},
			'reactClient'
		) as Record<string, unknown>;

		expect(override.sourcemap).toBe('linked');
		expect(override.outdir).toBeUndefined();
		expect(override.target).toBeUndefined();
		expect(override.throw).toBeUndefined();
	});

	test('merges plugins, external, and define without dropping Absolute-owned values', () => {
		const internalPlugin = plugin('absolute-internal');
		const userPlugin = plugin('user-plugin');
		const merged = mergeBunBuildConfig(
			{
				define: {
					__USER_FLAG__: '"internal"',
					__VUE_OPTIONS_API__: 'true'
				},
				entrypoints: ['src/index.ts'],
				external: ['react', 'vue'],
				format: 'esm',
				outdir: 'build',
				plugins: [internalPlugin],
				target: 'browser'
			},
			{
				define: {
					__USER_FLAG__: '"user"',
					__VUE_OPTIONS_API__: 'false'
				},
				external: ['react', 'svelte'],
				plugins: [userPlugin]
			}
		);

		expect(merged.external).toEqual(['react', 'vue', 'svelte']);
		expect(merged.plugins).toEqual([internalPlugin, userPlugin]);
		expect(merged.define).toEqual({
			__USER_FLAG__: '"internal"',
			__VUE_OPTIONS_API__: 'true'
		});
	});

	test('passes special-care scalar options through to Bun config', () => {
		const merged = mergeBunBuildConfig(
			{
				entrypoints: ['src/index.ts'],
				format: 'esm',
				naming: '[dir]/[name].[hash].[ext]',
				outdir: 'build',
				splitting: true,
				target: 'browser',
				tsconfig: './tsconfig.json'
			},
			{
				naming: {
					asset: 'assets/[name]-asset.[ext]',
					chunk: 'chunks/[name]-chunk.[ext]',
					entry: 'entries/[name]-entry.[ext]'
				},
				splitting: false,
				tsconfig: './tsconfig.custom.json'
			}
		);

		expect(merged.naming).toEqual({
			asset: 'assets/[name]-asset.[ext]',
			chunk: 'chunks/[name]-chunk.[ext]',
			entry: 'entries/[name]-entry.[ext]'
		});
		expect(merged.splitting).toBe(false);
		expect(merged.tsconfig).toBe('./tsconfig.custom.json');
	});

	test('root bunBuild config is not mistaken for a workspace config', () => {
		expect(
			isWorkspaceConfig({
				bunBuild: {
					sourcemap: 'linked'
				}
			} as never)
		).toBe(false);
	});
});

describe('generateManifest with custom Bun naming output', () => {
	test('handles emitted files that omit Bun hash from the filename', () => {
		const buildPath = join(process.cwd(), 'build');
		const manifest = generateManifest(
			[
				artifact(
					join(buildPath, 'react', 'generated', 'indexes', 'Home.js'),
					'abc123'
				)
			],
			buildPath
		);

		expect(manifest.HomeIndex).toBe('/react/generated/indexes/Home.js');
	});

	test('handles emitted files with object naming subdirectories', () => {
		const buildPath = join(process.cwd(), 'build');
		const manifest = generateManifest(
			[
				artifact(
					join(
						buildPath,
						'entries',
						'react',
						'generated',
						'indexes',
						'Home.abc123.js'
					),
					'abc123'
				)
			],
			buildPath
		);

		expect(manifest.HomeIndex).toBe(
			'/entries/react/generated/indexes/Home.abc123.js'
		);
	});
});
