import { describe, expect, test } from 'bun:test';
import { decodeSrcPath, encodeSrcPath } from '../../../src/dev/srcPath';

describe('/@src/ paths for files outside the app folder', () => {
	test('a file inside the app keeps its path', () => {
		expect(encodeSrcPath('src/frontend/pages/Home.tsx')).toBe(
			'src/frontend/pages/Home.tsx'
		);
		expect(decodeSrcPath('src/frontend/pages/Home.tsx')).toBe(
			'src/frontend/pages/Home.tsx'
		);
	});

	test('steps out of the app survive a browser, and come back', () => {
		/* A browser collapses /@src/../core/x.ts to /core/x.ts. */
		expect(encodeSrcPath('../core/greeting.ts')).toBe(
			'@up/core/greeting.ts'
		);
		expect(
			encodeSrcPath('../../node_modules/@absolutejs/absolute/dist/x.js')
		).toBe('@up/@up/node_modules/@absolutejs/absolute/dist/x.js');
		expect(decodeSrcPath('@up/@up/node_modules/a.js')).toBe(
			'../../node_modules/a.js'
		);
		expect(decodeSrcPath(encodeSrcPath('../core/a/b.ts'))).toBe(
			'../core/a/b.ts'
		);
	});

	test('percent-encoding a browser adds is decoded', () => {
		/* A space in a folder name arrives as %20. */
		expect(decodeSrcPath('@up/@up/Local%20Documents/app/src/x.ts')).toBe(
			'../../Local Documents/app/src/x.ts'
		);
		expect(decodeSrcPath('src/My%20Page.tsx')).toBe('src/My Page.tsx');
		expect(decodeSrcPath(encodeSrcPath('../a b/c.ts'))).toBe('../a b/c.ts');
	});

	test('a path that is not valid percent-encoding is used as written', () => {
		expect(decodeSrcPath('src/100%.ts')).toBe('src/100%.ts');
	});

	test('only leading steps are steps; Windows separators are normalised', () => {
		expect(encodeSrcPath('src/../x.ts')).toBe('src/../x.ts');
		expect(encodeSrcPath('..\\core\\x.ts')).toBe('@up/core/x.ts');
	});
});
