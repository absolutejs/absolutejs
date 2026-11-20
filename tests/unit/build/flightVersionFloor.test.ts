import { describe, expect, test } from 'bun:test';
import {
	FLIGHT_MINIMUM_VERSION,
	flightVersionProblem
} from '../../../src/build/buildReactServerComponents';

/* A React Server Components build produces the Flight payload a browser
 * runs, so the Flight runtime's version is part of what ships. The plan
 * sets a floor; this is the build-time gate for it, because a peer range
 * warns once at install and is then forgotten. */

describe('the Flight version floor', () => {
	test('blocks a version below the floor', () => {
		expect(flightVersionProblem('19.2.1')).toContain(
			FLIGHT_MINIMUM_VERSION
		);
		expect(flightVersionProblem('19.2.2')).toBeDefined();
		expect(flightVersionProblem('19.1.9')).toBeDefined();
	});

	test('allows the floor and anything above it', () => {
		expect(flightVersionProblem(FLIGHT_MINIMUM_VERSION)).toBeUndefined();
		expect(flightVersionProblem('19.2.9')).toBeUndefined();
		expect(flightVersionProblem('19.3.1')).toBeUndefined();
		expect(flightVersionProblem('20.0.0')).toBeUndefined();
	});

	test('blocks a prerelease of the floor', () => {
		// Semver puts a prerelease below its release, and a canary of the
		// fix is not the fix.
		expect(flightVersionProblem('19.2.3-canary.1')).toBeDefined();
	});

	test('does not block a version it could not read', () => {
		// A workspace link or an odd package should not fail a build the
		// installed code is fine for; the caller warns instead.
		expect(flightVersionProblem(undefined)).toBeUndefined();
	});

	test('the message says what to run', () => {
		const message = flightVersionProblem('19.2.1') ?? '';

		expect(message).toContain('19.2.1');
		expect(message).toContain('bun add');
		// react and react-dom move with it, or the renderer and the Flight
		// runtime disagree.
		expect(message).toContain('react-dom');
	});
});

/* The plan's other half of the check: the Flight runtime and the renderer
 * are released together, so a mismatch is its own failure. */
describe('the react and Flight versions must match', () => {
	test('a mismatch is reported, above the floor', () => {
		const message = flightVersionProblem('19.2.9', '19.3.1') ?? '';

		expect(message).toContain('does not match react 19.3.1');
	});

	test('a matching pair passes', () => {
		expect(flightVersionProblem('19.2.9', '19.2.9')).toBeUndefined();
	});

	test("an unreadable react version does not block", () => {
		expect(flightVersionProblem('19.2.9', undefined)).toBeUndefined();
	});

	test('the floor is reported before the mismatch', () => {
		// Both are wrong here; the vulnerability is the one to say first.
		const message = flightVersionProblem('19.2.1', '19.3.1') ?? '';

		expect(message).toContain('CVE-2025-55182');
	});
});
