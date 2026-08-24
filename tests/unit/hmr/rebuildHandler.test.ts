import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
	handleFullReload,
	handleRebuildComplete
} from '../../../src/dev/client/handlers/rebuild';

GlobalRegistrator.register({ url: 'http://localhost/react' });

afterAll(() => GlobalRegistrator.unregister());

describe('rebuild-complete client routing', () => {
	test.each(['assets', 'styles', 'tailwind'])(
		'keeps %s changes on the stylesheet HMR path',
		(framework) => {
			const before = window.location.href;
			handleRebuildComplete({
				data: { affectedFrameworks: [framework], manifest: {} }
			});
			expect(window.location.href).toBe(before);
		}
	);
});

describe('island full-reload client routing', () => {
	test('does not reload a framework outside the affected page set', () => {
		window.__HMR_FRAMEWORK__ = 'react';
		const timeout = spyOn(globalThis, 'setTimeout');
		handleFullReload({
			data: { affectedFrameworks: ['html', 'htmx'] }
		});
		expect(timeout).not.toHaveBeenCalled();
		timeout.mockRestore();
		window.__HMR_FRAMEWORK__ = undefined;
	});
});
