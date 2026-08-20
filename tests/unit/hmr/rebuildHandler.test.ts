import { afterAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { handleRebuildComplete } from '../../../src/dev/client/handlers/rebuild';

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
