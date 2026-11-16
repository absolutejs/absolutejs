import { describe, expect, test } from 'bun:test';
import { forgetBuildErrorsFor } from '../../../src/dev/buildErrorMemory';
import type { BuildPassError } from '../../../types/build';

type Stored = { lastBuildErrors?: BuildPassError[] };

const error = (
	file: string | undefined,
	message = 'broken'
): BuildPassError => ({
	file,
	label: 'React client',
	message,
	pass: 'react-client'
});

describe('forgetBuildErrorsFor', () => {
	test('a file that now compiles drops its stored error, and none left clears them', () => {
		const state: Stored = {
			lastBuildErrors: [error('/app/src/Entry.tsx')]
		};
		forgetBuildErrorsFor(state, ['/app/src/Entry.tsx']);

		expect(state.lastBuildErrors).toBeUndefined();
	});

	test('errors for other files, and errors with no file, stay', () => {
		const other = error('/app/src/Other.tsx');
		const unplaced = error(undefined, 'a missing manifest key');
		const state: Stored = {
			lastBuildErrors: [error('/app/src/Entry.tsx'), other, unplaced]
		};
		forgetBuildErrorsFor(state, ['/app/src/Entry.tsx']);

		expect(state.lastBuildErrors).toEqual([other, unplaced]);
	});

	test('paths match however they are written', () => {
		const state: Stored = {
			lastBuildErrors: [error('/app/src/./Entry.tsx')]
		};
		forgetBuildErrorsFor(state, ['/app/src/components/../Entry.tsx']);

		expect(state.lastBuildErrors).toBeUndefined();
	});

	test('nothing stored is left alone', () => {
		const state: Stored = {};
		forgetBuildErrorsFor(state, ['/app/src/Entry.tsx']);

		expect(state.lastBuildErrors).toBeUndefined();
	});
});
