import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(async () => {
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const angularCounter = resolve(
	PROJECT_ROOT,
	'example/angular/components/counter.component.ts'
);
const vueCountButton = resolve(
	PROJECT_ROOT,
	'example/vue/components/CountButton.vue'
);

const startAll = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return { client: client!, server: server! };
};

/* AbsoluteJS supports SCSS, Less, and Stylus through the
 * `stylePreprocessor.ts` layer. Sync compilation is only wired for
 * SCSS — Angular's fast-HMR `styleUrl` inliner uses the sync path
 * because the fingerprint compile must complete in one frame. Less
 * and Stylus go through the ASYNC path, which means they work via
 * Vue SFC `<style lang="less">` / `<style lang="stylus">` blocks
 * and via Bun.build's plugin chain for HTML <link> resolution, but
 * NOT as Angular `styleUrl`s.
 *
 * Tests:
 *   - SCSS works as Angular `styleUrl` (sync path).
 *   - SCSS edit re-runs the preprocessor — content polled directly
 *     because resource edits land on the `styles` framework path,
 *     not the angular tier-0 broadcast.
 *   - Less + Stylus inside a Vue SFC `<style lang>` block compile
 *     correctly. */
describe('Style preprocessor round-trip', () => {
	test('SCSS file used as Angular `styleUrl` compiles to CSS and reaches SSR', async () => {
		const { client: c, server: srv } = await startAll();

		const scssPath = resolve(
			PROJECT_ROOT,
			'example/styles/counter-test.scss'
		);
		createFile(
			scssPath,
			`$brand-color: #ab44ee;\n\n.counter-value {\n\tcolor: $brand-color;\n\tfont-weight: 700;\n}\n`
		);
		mutateFile(angularCounter, (text) =>
			text.replace(
				"styleUrl: '../../styles/counter.component.css',",
				"styleUrl: '../../styles/counter-test.scss',"
			)
		);
		await c.waitFor('angular-tier-zero-ssr-rebuild-complete', 30_000);

		const html = await (await fetch(`${srv.baseUrl}/angular`)).text();
		// SCSS variable expansion: `$brand-color` → `#ab44ee` in
		// the served output. SSR inlines component styles into a
		// `<style ng-app-id>` block.
		expect(html).toContain('#ab44ee');
		expect(html).toContain('font-weight');
	}, 60_000);

	test('Less inside Vue `<style lang="less">` compiles to CSS and reaches served output', async () => {
		const { client: c, server: srv } = await startAll();

		mutateFile(vueCountButton, (text) =>
			text.replace(
				'<style scoped>',
				'<style lang="less" scoped>\n@accent: #cb55ee;\n.less-marker { color: @accent; font-size: 99px; }\n'
			)
		);
		await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);

		const html = await (await fetch(`${srv.baseUrl}/vue`)).text();
		// The compiled CSS lands in the Vue compiled bundle.
		const cssMatch = html.match(
			/href="([^"]*vue-example-compiled\.[^"]*\.css)"/
		);
		expect(cssMatch?.[1]).toBeTruthy();
		const css = await (await fetch(`${srv.baseUrl}${cssMatch![1]}`)).text();
		// Less variable `@accent` → `#cb55ee`.
		expect(css).toContain('#cb55ee');
		expect(css).toContain('99px');
	}, 60_000);

	test('Stylus inside Vue `<style lang="stylus">` compiles to CSS and reaches served output', async () => {
		const { client: c, server: srv } = await startAll();

		mutateFile(vueCountButton, (text) =>
			text.replace(
				'<style scoped>',
				'<style lang="stylus" scoped>\nmarker = #78aacc\n.stylus-marker\n  color marker\n  font-size 77px\n'
			)
		);
		await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);

		const html = await (await fetch(`${srv.baseUrl}/vue`)).text();
		const cssMatch = html.match(
			/href="([^"]*vue-example-compiled\.[^"]*\.css)"/
		);
		expect(cssMatch?.[1]).toBeTruthy();
		const css = await (await fetch(`${srv.baseUrl}${cssMatch![1]}`)).text();
		expect(css).toContain('#78aacc');
		expect(css).toContain('77px');
	}, 60_000);
});
