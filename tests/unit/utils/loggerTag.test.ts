import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { logError, logWarn } from '../../../src/utils/logger';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
	process.env.NODE_ENV = originalNodeEnv;
});

const captured = (run: () => void, stream: 'error' | 'log') => {
	const spy = spyOn(console, stream).mockImplementation(() => {});
	try {
		run();

		return Bun.stripANSI(
			spy.mock.calls.map((call) => call.join(' ')).join('\n')
		);
	} finally {
		spy.mockRestore();
	}
};

describe('logger prefix', () => {
	test('production warnings and errors say [absolutejs], not [hmr]', () => {
		process.env.NODE_ENV = 'production';
		const warning = captured(
			() => logWarn('File route pages/a.tsx is not served'),
			'log'
		);
		const error = captured(() => logError('Build failed'), 'error');

		expect(warning).toContain('[absolutejs] warning File route');
		expect(warning).not.toContain('[hmr]');
		expect(error).toContain('[absolutejs] error Build failed');
	});

	test('the dev server keeps [hmr]', () => {
		process.env.NODE_ENV = 'development';
		const warning = captured(() => logWarn('something'), 'log');

		expect(warning).toContain('[hmr] warning something');
	});
});
