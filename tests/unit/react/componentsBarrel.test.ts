import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as components from '../../../src/react/components';
import * as browserComponents from '../../../src/react/components/browser';
import * as serverComponents from '../../../src/react/components/server';
import { Link } from '../../../src/react/router/Link';
import { usePrefetch } from '../../../src/react/hooks/usePrefetch';

const barrelSource = (path: string) =>
	readFileSync(resolve(import.meta.dir, '../../../src/react', path), 'utf8');

describe('react/components barrel', () => {
	test('re-exports the prefetching Link and its hook', () => {
		expect(components.Link).toBe(Link);
		expect(components.usePrefetch).toBe(usePrefetch);
		expect(browserComponents.Link).toBe(Link);
		expect(browserComponents.usePrefetch).toBe(usePrefetch);
	});

	test('the server components entry exports the same components', () => {
		expect(Object.keys(serverComponents).sort()).toEqual(
			Object.keys(components).sort()
		);
		expect(serverComponents.Link).toBe(Link);
		expect(serverComponents.SuspenseSlot).toBe(components.SuspenseSlot);
		expect(serverComponents.StreamSlot).toBe(components.StreamSlot);
	});

	test('the server components entry takes Link from a "use client" module', () => {
		// An RSC build only makes Link a client reference when the module it
		// comes from starts with the directive; scripts/build.ts keeps that
		// import external so dist/react/components/client.js carries it too.
		expect(barrelSource('components/client.ts')).toMatch(
			/^(['"])use client\1;/
		);
		expect(barrelSource('components/server/index.ts')).toContain(
			"from '../client'"
		);
	});

	test('reaches Link without pulling react-router in', () => {
		// The `react/router` barrel statically imports react-router, so a
		// project without an SPA shell must be able to get `<Link>` from
		// `react/components` instead.
		for (const path of [
			'components/index.ts',
			'components/browser/index.ts',
			'components/client.ts',
			'components/server/index.ts',
			'router/Link.tsx',
			'router/navigationContext.ts',
			'hooks/usePrefetch.ts'
		]) {
			expect(barrelSource(path)).not.toMatch(/['"]react-router['"]/);
		}
	});
});
