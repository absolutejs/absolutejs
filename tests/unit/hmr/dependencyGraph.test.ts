import { describe, expect, test, beforeEach } from 'bun:test';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	addFileToGraph,
	removeFileFromGraph,
	getAffectedFiles,
	extractDependencies,
	type DependencyGraph
} from '../../../src/dev/dependencyGraph';

const makeGraph = (): DependencyGraph => ({
	dependencies: new Map(),
	dependents: new Map()
});

const tmpBase = resolve(tmpdir(), `dep-graph-test-${Date.now()}`);

beforeEach(() => {
	mkdirSync(tmpBase, { recursive: true });
});

describe('addFileToGraph', () => {
	test('adds file with no imports', () => {
		const graph = makeGraph();
		const file = resolve(tmpBase, 'standalone.ts');
		writeFileSync(file, 'export const x = 1;');
		addFileToGraph(graph, file);

		expect(graph.dependencies.has(resolve(file))).toBe(true);
		expect(graph.dependencies.get(resolve(file))?.size).toBe(0);
	});

	test('adds file with relative import', () => {
		const graph = makeGraph();
		const depFile = resolve(tmpBase, 'dep.ts');
		const mainFile = resolve(tmpBase, 'main.ts');
		writeFileSync(depFile, 'export const y = 2;');
		writeFileSync(mainFile, "import { y } from './dep';");

		addFileToGraph(graph, mainFile);

		const deps = graph.dependencies.get(resolve(mainFile));
		expect(deps?.size).toBeGreaterThan(0);
		expect(
			graph.dependents.get(resolve(depFile))?.has(resolve(mainFile))
		).toBe(true);
	});

	test('skips nonexistent files without error', () => {
		const graph = makeGraph();
		expect(() =>
			addFileToGraph(graph, '/nonexistent/file.ts')
		).not.toThrow();
	});
});

describe('removeFileFromGraph', () => {
	test('removes file and its edges', () => {
		const graph = makeGraph();
		const depFile = resolve(tmpBase, 'rem-dep.ts');
		const mainFile = resolve(tmpBase, 'rem-main.ts');
		writeFileSync(depFile, 'export const z = 3;');
		writeFileSync(mainFile, "import { z } from './rem-dep';");

		addFileToGraph(graph, mainFile);
		removeFileFromGraph(graph, mainFile);

		expect(graph.dependencies.has(resolve(mainFile))).toBe(false);
		const depDependents = graph.dependents.get(resolve(depFile));
		expect(!depDependents || !depDependents.has(resolve(mainFile))).toBe(
			true
		);
	});

	test('handles removing file not in graph', () => {
		const graph = makeGraph();
		expect(() =>
			removeFileFromGraph(graph, '/nonexistent/file.ts')
		).not.toThrow();
	});
});

describe('getAffectedFiles', () => {
	test('returns the changed file itself', () => {
		const graph = makeGraph();
		const file = resolve(tmpBase, 'affected-self.ts');
		writeFileSync(file, 'export const a = 1;');
		addFileToGraph(graph, file);

		const affected = getAffectedFiles(graph, file);
		expect(affected).toContain(resolve(file));
	});

	test('returns dependent files transitively', () => {
		const graph = makeGraph();
		const base = resolve(tmpBase, 'aff-base.ts');
		const mid = resolve(tmpBase, 'aff-mid.ts');
		const top = resolve(tmpBase, 'aff-top.ts');
		writeFileSync(base, 'export const b = 1;');
		writeFileSync(mid, "import { b } from './aff-base';");
		writeFileSync(top, "import './aff-mid';");

		addFileToGraph(graph, base);
		addFileToGraph(graph, mid);
		addFileToGraph(graph, top);

		const affected = getAffectedFiles(graph, base);
		expect(affected).toContain(resolve(base));
		expect(affected).toContain(resolve(mid));
		expect(affected).toContain(resolve(top));
	});

	test('handles files with no dependents', () => {
		const graph = makeGraph();
		const file = resolve(tmpBase, 'leaf.ts');
		writeFileSync(file, 'const x = 1;');
		addFileToGraph(graph, file);

		const affected = getAffectedFiles(graph, file);
		expect(affected).toHaveLength(1);
		expect(affected[0]).toBe(resolve(file));
	});
});

describe('extractDependencies', () => {
	test('extracts imports from TypeScript files', () => {
		const dep = resolve(tmpBase, 'ext-dep.ts');
		const main = resolve(tmpBase, 'ext-main.ts');
		writeFileSync(dep, 'export const val = 1;');
		writeFileSync(main, "import { val } from './ext-dep';");

		const deps = extractDependencies(main);
		expect(deps.length).toBeGreaterThan(0);
		expect(deps[0]).toBe(resolve(dep));
	});

	test('skips external package imports', () => {
		const file = resolve(tmpBase, 'ext-only.ts');
		writeFileSync(file, "import React from 'react';");

		const deps = extractDependencies(file);
		expect(deps).toHaveLength(0);
	});

	test('returns empty for nonexistent file', () => {
		const deps = extractDependencies('/nonexistent/file.ts');
		expect(deps).toHaveLength(0);
	});

	test('extracts HTML stylesheet links', () => {
		const css = resolve(tmpBase, 'style.css');
		const html = resolve(tmpBase, 'page.html');
		writeFileSync(css, 'body { margin: 0; }');
		writeFileSync(html, '<link rel="stylesheet" href="./style.css">');

		const deps = extractDependencies(html);
		expect(deps).toContain(resolve(css));
	});
});
