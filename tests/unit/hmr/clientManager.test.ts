import { describe, expect, test } from 'bun:test';
import {
	createHMRState,
	incrementSourceFileVersion,
	incrementSourceFileVersions
} from '../../../src/dev/clientManager';
import type { BuildConfig } from '../../../types/build';

const makeConfig = (overrides?: Partial<BuildConfig>): BuildConfig => ({
	buildDirectory: '/tmp/test-build',
	...overrides
});

describe('createHMRState', () => {
	test('creates state with all required fields', () => {
		const state = createHMRState(makeConfig());
		expect(state.connectedClients).toBeInstanceOf(Set);
		expect(state.connectedClients.size).toBe(0);
		expect(state.dependencyGraph.dependents).toBeInstanceOf(Map);
		expect(state.dependencyGraph.dependencies).toBeInstanceOf(Map);
		expect(state.isRebuilding).toBe(false);
		expect(state.rebuildQueue).toBeInstanceOf(Set);
		expect(state.rebuildQueue.size).toBe(0);
		expect(state.fileHashes).toBeInstanceOf(Map);
		expect(state.moduleVersions).toBeInstanceOf(Map);
		expect(state.sourceFileVersions).toBeInstanceOf(Map);
		expect(state.assetStore).toBeInstanceOf(Map);
		expect(state.manifest).toEqual({});
		expect(state.vueChangeTypes).toBeInstanceOf(Map);
		expect(state.watchers).toEqual([]);
	});

	test('stores config reference', () => {
		const config = makeConfig({ reactDirectory: 'example/react' });
		const state = createHMRState(config);
		expect(state.config).toBe(config);
	});

	test('resolves build paths from config', () => {
		const state = createHMRState(
			makeConfig({ reactDirectory: 'example/react' })
		);
		expect(state.resolvedPaths).toBeDefined();
		expect(state.resolvedPaths.buildDir).toBeDefined();
	});
});

describe('incrementSourceFileVersion', () => {
	test('starts at 1 for new file', () => {
		const state = createHMRState(makeConfig());
		const version = incrementSourceFileVersion(state, '/some/file.ts');
		expect(version).toBe(1);
	});

	test('increments on subsequent calls', () => {
		const state = createHMRState(makeConfig());
		incrementSourceFileVersion(state, '/some/file.ts');
		const v2 = incrementSourceFileVersion(state, '/some/file.ts');
		expect(v2).toBe(2);
	});

	test('tracks versions independently per file', () => {
		const state = createHMRState(makeConfig());
		incrementSourceFileVersion(state, '/a.ts');
		incrementSourceFileVersion(state, '/a.ts');
		incrementSourceFileVersion(state, '/b.ts');
		expect(state.sourceFileVersions.get('/a.ts')).toBe(2);
		expect(state.sourceFileVersions.get('/b.ts')).toBe(1);
	});
});

describe('incrementSourceFileVersions', () => {
	test('increments multiple files at once', () => {
		const state = createHMRState(makeConfig());
		incrementSourceFileVersions(state, ['/a.ts', '/b.ts', '/c.ts']);
		expect(state.sourceFileVersions.get('/a.ts')).toBe(1);
		expect(state.sourceFileVersions.get('/b.ts')).toBe(1);
		expect(state.sourceFileVersions.get('/c.ts')).toBe(1);
	});
});
