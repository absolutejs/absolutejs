import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	computeFileHash,
	hasFileChanged
} from '../../../src/dev/fileHashTracker';

describe('computeFileHash', () => {
	test('returns a number for an existing file', () => {
		const tmpFile = resolve(tmpdir(), `hash-test-${Date.now()}.txt`);
		writeFileSync(tmpFile, 'hello world');
		const hash = computeFileHash(tmpFile);
		expect(typeof hash).toBe('number');
		expect(hash).not.toBe(-1);
		unlinkSync(tmpFile);
	});

	test('returns -1 for nonexistent file', () => {
		const hash = computeFileHash('/nonexistent/file/path.ts');
		expect(hash).toBe(-1);
	});

	test('returns same hash for same content', () => {
		const tmpFile = resolve(tmpdir(), `hash-test-${Date.now()}.txt`);
		writeFileSync(tmpFile, 'consistent content');
		const hash1 = computeFileHash(tmpFile);
		const hash2 = computeFileHash(tmpFile);
		expect(hash1).toBe(hash2);
		unlinkSync(tmpFile);
	});

	test('returns different hash for different content', () => {
		const tmpFile = resolve(tmpdir(), `hash-test-${Date.now()}.txt`);
		writeFileSync(tmpFile, 'content a');
		const hash1 = computeFileHash(tmpFile);
		writeFileSync(tmpFile, 'content b');
		const hash2 = computeFileHash(tmpFile);
		expect(hash1).not.toBe(hash2);
		unlinkSync(tmpFile);
	});
});

describe('hasFileChanged', () => {
	test('returns true for first-time file (no previous hash)', () => {
		const hashes = new Map<string, number>();
		expect(hasFileChanged('/some/file.ts', 12345, hashes)).toBe(true);
	});

	test('returns false when hash matches previous', () => {
		const hashes = new Map<string, number>([['/some/file.ts', 12345]]);
		expect(hasFileChanged('/some/file.ts', 12345, hashes)).toBe(false);
	});

	test('returns true when hash differs from previous', () => {
		const hashes = new Map<string, number>([['/some/file.ts', 12345]]);
		expect(hasFileChanged('/some/file.ts', 99999, hashes)).toBe(true);
	});

	test('normalizes paths with backslashes', () => {
		const hashes = new Map<string, number>([['/some/file.ts', 12345]]);
		expect(hasFileChanged('\\some\\file.ts', 12345, hashes)).toBe(false);
	});
});
