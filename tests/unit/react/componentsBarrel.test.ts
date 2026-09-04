import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as components from '../../../src/react/components';
import * as browserComponents from '../../../src/react/components/browser';
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

	test('reaches Link without pulling react-router in', () => {
		// The `react/router` barrel statically imports react-router, so a
		// project without an SPA shell must be able to get `<Link>` from
		// `react/components` instead.
		for (const path of [
			'components/index.ts',
			'components/browser/index.ts',
			'router/Link.tsx',
			'router/navigationContext.ts',
			'hooks/usePrefetch.ts'
		]) {
			expect(barrelSource(path)).not.toMatch(/['"]react-router['"]/);
		}
	});
});
