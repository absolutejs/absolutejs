import { describe, expect, test } from 'bun:test';
import { formatServerBootDiagnostic } from '../../../src/cli/scripts/dev';

describe('dev server boot diagnostics', () => {
	test('explains Bun Node-API ESM import failures', () => {
		const diagnostic = formatServerBootDiagnostic(
			'TypeError: To load Node-API modules, use require() or process.dlopen instead of import.',
			'src/backend/server.ts'
		);

		expect(diagnostic).toContain(
			'Server boot failed while evaluating src/backend/server.ts.'
		);
		expect(diagnostic).toContain('native Node-API addon');
		expect(diagnostic).toContain('with { type: "file" }');
	});

	test('ignores unrelated stderr', () => {
		expect(
			formatServerBootDiagnostic(
				'TypeError: regular app error',
				'server.ts'
			)
		).toBeNull();
	});
});
