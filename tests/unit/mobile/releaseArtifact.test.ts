import { describe, expect, test } from 'bun:test';
import {
	ABSOLUTE_MOBILE_RETAINED_GENERATIONS,
	createAbsoluteMobileCompatibilityArtifact,
	hashAbsoluteMobilePropsSchema,
	parseAbsoluteMobileCompatibilityArtifact,
	resolveAbsoluteMobileCompatibilityRelease,
	retainAbsoluteMobileCompatibilityArtifacts,
	type AbsoluteMobileCompatibilityArtifact,
	type AbsoluteMobileCompatibilityArtifactInput
} from '../../../src/mobile/releaseArtifact';
import type { AbsoluteMobilePageClient } from '../../../src/mobile/pageProtocol';

const artifactInput = (
	generation: number
): AbsoluteMobileCompatibilityArtifactInput => ({
	appBuild: `build-${generation}`,
	appId: 'com.example.absolute',
	generation,
	pages: [
		{
			bundleHash: `account-bundle-${generation}`,
			bundlePath: `/pages/account-${generation}.js`,
			contract: `account@${generation}`,
			framework: 'react',
			pageId: 'Account',
			propsSchemaHash: `schema-${generation}`
		}
	],
	producer: {
		bundleHash: `producer-${generation}`,
		bytes: generation,
		exportName: 'mobileProducer',
		module: `producers/${generation}.js`
	},
	routes: [{ method: 'GET', pageId: 'Account', pattern: '/account/:id' }],
	runtime: `runtime-${generation}`
});

const clientFor = (generation: number): AbsoluteMobilePageClient => ({
	appBuild: `build-${generation}`,
	pageBundle: `account-bundle-${generation}`,
	pageContracts: [`account@${generation}`],
	pageId: 'Account',
	protocol: 1,
	runtime: `runtime-${generation}`
});

describe('mobile compatibility release artifacts', () => {
	test('is deterministic regardless of metadata ordering', () => {
		const firstInput = artifactInput(3);
		const secondInput: AbsoluteMobileCompatibilityArtifactInput = {
			...firstInput,
			pages: [
				{
					bundleHash: 'settings-bundle-3',
					bundlePath: '/pages/settings-3.js',
					contract: 'settings@3',
					framework: 'vue',
					pageId: 'Settings',
					propsSchemaHash: 'settings-schema-3'
				},
				...firstInput.pages
			],
			routes: [
				{ method: 'GET', pageId: 'Settings', pattern: '/settings' },
				...firstInput.routes
			]
		};
		const reorderedInput: AbsoluteMobileCompatibilityArtifactInput = {
			...secondInput,
			pages: [...secondInput.pages].reverse(),
			routes: [...secondInput.routes].reverse()
		};

		expect(createAbsoluteMobileCompatibilityArtifact(secondInput)).toEqual(
			createAbsoluteMobileCompatibilityArtifact(reorderedInput)
		);
	});

	test('hashes equivalent generated prop schemas identically', () => {
		const firstSchema: Record<string, unknown> = {
			properties: {
				displayName: { type: 'string' },
				id: { type: 'number' }
			},
			type: 'object'
		};
		const reorderedProperties: Record<string, unknown> = Object.fromEntries(
			[
				['id', { type: 'number' }],
				['displayName', { type: 'string' }]
			]
		);
		const reorderedSchema: Record<string, unknown> = Object.fromEntries([
			['type', 'object'],
			['properties', reorderedProperties]
		]);

		expect(hashAbsoluteMobilePropsSchema(firstSchema)).toBe(
			hashAbsoluteMobilePropsSchema(reorderedSchema)
		);
	});

	test('retains exactly the current release plus two previous generations', () => {
		const artifacts: AbsoluteMobileCompatibilityArtifact[] = [
			1, 4, 2, 3
		].map((generation) =>
			createAbsoluteMobileCompatibilityArtifact(artifactInput(generation))
		);
		const retained = retainAbsoluteMobileCompatibilityArtifacts(artifacts);

		expect(retained).toHaveLength(ABSOLUTE_MOBILE_RETAINED_GENERATIONS);
		expect(retained.map(({ generation }) => generation)).toEqual([4, 3, 2]);
	});

	test('resolves an installed app to its retained producer and page', () => {
		const artifact = createAbsoluteMobileCompatibilityArtifact(
			artifactInput(2)
		);

		expect(
			resolveAbsoluteMobileCompatibilityRelease(clientFor(2), [artifact])
		).toMatchObject({
			artifact: { releaseId: artifact.releaseId },
			kind: 'retained',
			page: { pageId: 'Account' }
		});
	});

	test('requires an app update only after its release leaves retention', () => {
		const artifacts = [3, 2, 1].map((generation) =>
			createAbsoluteMobileCompatibilityArtifact(artifactInput(generation))
		);

		expect(
			resolveAbsoluteMobileCompatibilityRelease(clientFor(0), artifacts)
		).toEqual({
			kind: 'upgrade-required',
			result: {
				kind: 'upgrade-required',
				pageId: 'Account',
				reason: 'app-release'
			}
		});
	});

	test('rejects a page bundle that was not signed into the retained release', () => {
		const artifact = createAbsoluteMobileCompatibilityArtifact(
			artifactInput(2)
		);
		const client: AbsoluteMobilePageClient = {
			...clientFor(2),
			pageBundle: 'unknown-bundle'
		};

		expect(
			resolveAbsoluteMobileCompatibilityRelease(client, [artifact])
		).toMatchObject({
			kind: 'upgrade-required',
			result: { pageId: 'Account', reason: 'page-contract' }
		});
	});

	test('round-trips optional page styles and rejects incomplete style metadata', () => {
		const input = artifactInput(2);
		const artifact = createAbsoluteMobileCompatibilityArtifact({
			...input,
			pages: input.pages.map((page) => ({
				...page,
				styleBundleHash: 'account-style-2',
				styleBundlePath: '/assets/account-2.css'
			}))
		});

		expect(parseAbsoluteMobileCompatibilityArtifact(artifact)).toEqual(
			artifact
		);
		expect(() =>
			parseAbsoluteMobileCompatibilityArtifact({
				...artifact,
				pages: artifact.pages.map(
					({ styleBundlePath: _style, ...page }) => page
				)
			})
		).toThrow('style hash and path must be provided together');
	});
});
