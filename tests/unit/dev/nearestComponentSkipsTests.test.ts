import { describe, expect, test } from 'bun:test';
import {
	findNearestComponent,
	invalidateAll,
	setTransformed
} from '../../../src/dev/transformCache';
import { isTestFile } from '../../../src/dev/testFiles';

describe('findNearestComponent', () => {
	test('climbs past a test file that imports the module to the component the browser loads', () => {
		invalidateAll();
		// The test imports the helper first, so it is the first importer seen.
		setTransformed('/app/src/Health.test.tsx', '', 0, ['/app/src/format.ts']);
		setTransformed('/app/src/Health.tsx', '', 0, ['/app/src/format.ts']);

		expect(findNearestComponent('/app/src/format.ts')).toBe(
			'/app/src/Health.tsx'
		);
	});

	test('a module only a test imports has no component to update', () => {
		invalidateAll();
		setTransformed('/app/src/__tests__/Probe.tsx', '', 0, ['/app/src/only.ts']);

		expect(findNearestComponent('/app/src/only.ts')).toBeUndefined();
	});
});

describe('isTestFile', () => {
	test('names test files however they are spelled', () => {
		expect(isTestFile('/app/src/Health.test.tsx')).toBe(true);
		expect(isTestFile('/app/src/Health.spec.ts')).toBe(true);
		expect(isTestFile('/app/src/Health.TEST.mjs')).toBe(true);
		expect(isTestFile('/app/src/__tests__/Probe.tsx')).toBe(true);
		expect(isTestFile('/app/src/Health.tsx')).toBe(false);
		expect(isTestFile('/app/src/latest.ts')).toBe(false);
	});
});
