import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const REACT_PAGE = resolve(PROJECT_ROOT, 'example/react/components/App.tsx');
const originalReactPage = readFileSync(REACT_PAGE, 'utf-8');

afterAll(() => {
	restoreAllFiles();
});

describe('HMR error recovery', () => {
	test('can introduce an invalid react markup change for recovery scenarios', () => {
		mutateFile(REACT_PAGE, (content) =>
			content.replace('</main>', '</div></main>')
		);

		const mutated = readFileSync(REACT_PAGE, 'utf-8');
		expect(mutated).toContain('</div></main>');
		expect(mutated).not.toBe(originalReactPage);
	});

	test('restoreAllFiles returns the react page to its original content', () => {
		restoreAllFiles();

		const restored = readFileSync(REACT_PAGE, 'utf-8');
		expect(restored).toBe(originalReactPage);
	});
});
