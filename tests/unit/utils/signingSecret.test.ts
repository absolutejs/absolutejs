import { afterEach, describe, expect, test } from 'bun:test';
import {
	hasSigningSecret,
	signingSecret,
	signValue,
	verifyValue
} from '../../../src/utils/signingSecret';

const SECRET = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

type Captured = {
	ABSOLUTE_SECRET: string | undefined;
	NODE_ENV: string | undefined;
};

const before: Captured = {
	ABSOLUTE_SECRET: process.env.ABSOLUTE_SECRET,
	NODE_ENV: process.env.NODE_ENV
};

const restore = (key: keyof typeof before) => {
	const value = before[key];
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
};

afterEach(() => {
	restore('ABSOLUTE_SECRET');
	restore('NODE_ENV');
});

describe('signValue / verifyValue', () => {
	test('a signature this server made verifies', () => {
		const signature = signValue('csrf', 'abc', SECRET);
		expect(verifyValue('csrf', 'abc', signature, SECRET)).toBe(true);
	});

	test('the purpose is part of the signature', () => {
		const signature = signValue('csrf', 'abc', SECRET);
		expect(verifyValue('flash', 'abc', signature, SECRET)).toBe(false);
	});

	test('another value, another secret, or a truncated signature fails', () => {
		const signature = signValue('csrf', 'abc', SECRET);
		expect(verifyValue('csrf', 'abd', signature, SECRET)).toBe(false);
		expect(verifyValue('csrf', 'abc', signature, OTHER)).toBe(false);
		expect(verifyValue('csrf', 'abc', signature.slice(0, -1), SECRET)).toBe(
			false
		);
		expect(verifyValue('csrf', 'abc', '', SECRET)).toBe(false);
	});

	test('the signature is url-safe, so it survives a cookie or an attribute', () => {
		expect(signValue('csrf', 'abc', SECRET)).toMatch(/^[\w-]+$/);
	});
});

describe('signingSecret', () => {
	test('the configured secret is used when it is set', () => {
		process.env.ABSOLUTE_SECRET = SECRET;
		process.env.NODE_ENV = 'production';
		expect(hasSigningSecret()).toBe(true);
		expect(signingSecret()).toBe(SECRET);
	});

	test('production refuses to invent one', () => {
		delete process.env.ABSOLUTE_SECRET;
		process.env.NODE_ENV = 'production';
		expect(hasSigningSecret()).toBe(false);
		expect(() => signingSecret()).toThrow(/ABSOLUTE_SECRET/);
	});

	test('development generates one, and keeps it for the process', () => {
		delete process.env.ABSOLUTE_SECRET;
		process.env.NODE_ENV = 'development';
		expect(hasSigningSecret()).toBe(true);
		const first = signingSecret();
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(signingSecret()).toBe(first);
	});
});
