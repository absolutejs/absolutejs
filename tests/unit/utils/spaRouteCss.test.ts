import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { resolveSpaChildCss } from '../../../src/utils/spaRouteCss';

describe('resolveSpaChildCss', () => {
	test('resolves all child CSS paths from the SPA manifest directory', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-spa-route-css-'));
		const pagePath = join(root, 'Portal.js');
		const dashboardCssPath = join(root, 'Dashboard.css');
		const intakeCssPath = join(root, 'Intake.css');
		const manifestPath = join(root, 'Portal.spa.json');

		try {
			await writeFile(
				dashboardCssPath,
				'.dashboard-page { color: red; }'
			);
			await writeFile(intakeCssPath, '.intake-page { color: blue; }');
			await writeFile(
				manifestPath,
				JSON.stringify([
					{ cssPath: 'Dashboard.css', path: '/portal/dashboard' },
					{ cssPath: 'Intake.css', path: '/portal/intake' }
				])
			);

			await expect(
				resolveSpaChildCss(
					pagePath,
					'https://example.com/portal/dashboard'
				)
			).resolves.toBe(
				'.dashboard-page { color: red; }\n.intake-page { color: blue; }'
			);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
