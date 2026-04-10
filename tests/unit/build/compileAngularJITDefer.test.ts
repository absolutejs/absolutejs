import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import {
	compileAngular,
	compileAngularFileJIT
} from '../../../src/build/compileAngular';

const makeTemp = () => mkdtemp(join(tmpdir(), 'angular-jit-defer-'));
const STREAMING_FIXTURE = join(
	process.cwd(),
	'tests',
	'fixtures',
	'angular',
	'streaming-page.ts'
);

const writeComponentFile = async (
	dir: string,
	name: string,
	componentSource: string
) => {
	const filePath = join(dir, `${name}.ts`);
	await writeFile(filePath, componentSource, 'utf-8');

	return filePath;
};

describe('compileAngularFileJIT defer lowering', () => {
	test('lowers inline template @defer blocks', async () => {
		const dir = await makeTemp();
		const outDir = join(dir, 'out');
		await mkdir(outDir, { recursive: true });

		const inputPath = await writeComponentFile(
			dir,
			'inline-page',
			`import { Component } from '@angular/core';
@Component({
	selector: 'app-inline',
	standalone: true,
	imports: [],
	template: \`<section>
		@defer (on timer(20ms)) {
			<p>Loaded later</p>
		} @placeholder {
			<p>Loading</p>
		} @error {
			<p>Failed</p>
		}
	</section>\`
})
export class InlinePageComponent {}
`
		);

		const outputs = await compileAngularFileJIT(inputPath, outDir, dir);
		expect(outputs.length).toBeGreaterThan(0);

		const outputPath = outputs.find(path => path.endsWith('inline-page.js'));
		expect(outputPath).toBeDefined();
		const output = await readFile(outputPath as string, 'utf-8');

		expect(output).toContain('abs-defer-slot');
		expect(output).toContain('DeferSlotComponent');
		expect(output).toContain('DeferResolvedTemplateDirective');
		expect(output).toContain('DeferFallbackTemplateDirective');
		expect(output).toContain('DeferErrorTemplateDirective');
		expect(output).toContain('__absoluteDeferResolvePayload0');

		await rm(dir, { force: true, recursive: true });
	});

	test('preserves and augments existing imports array with DeferSlotComponent', async () => {
		const dir = await makeTemp();
		const outDir = join(dir, 'out');
		await mkdir(outDir, { recursive: true });

		const inputPath = await writeComponentFile(
			dir,
			'inline-page-with-imports',
			`import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
@Component({
	selector: 'app-inline-with-imports',
	standalone: true,
	imports: [CommonModule],
	template: \`<section>
		@defer (on timer(20ms)) {
			<p>Loaded later</p>
		} @placeholder {
			<p>Loading</p>
		}
	</section>\`
})
export class InlinePageWithImportsComponent {}
`
		);

		const outputs = await compileAngularFileJIT(inputPath, outDir, dir);
		expect(outputs.length).toBeGreaterThan(0);

		const outputPath = outputs.find(path => path.endsWith('inline-page-with-imports.js'));
		expect(outputPath).toBeDefined();
		const output = await readFile(outputPath as string, 'utf-8');

		expect(output).toContain('imports: [CommonModule, DeferSlotComponent, DeferResolvedTemplateDirective, DeferFallbackTemplateDirective, DeferErrorTemplateDirective]');
		expect(output).toContain('DeferSlotComponent');
		expect(output).toContain('__absoluteDeferResolvePayload0');

		await rm(dir, { force: true, recursive: true });
	});

	test('lowers templateUrl @defer blocks', async () => {
		const dir = await makeTemp();
		const outDir = join(dir, 'out');
		await mkdir(outDir, { recursive: true });

		const templatePath = join(dir, 'url-page.html');
		await writeFile(
			templatePath,
			`<main>
	@defer (on timer(10ms)) {
		<div>Resolved</div>
	} @placeholder {
		<div>Wait</div>
	}
</main>`,
			'utf-8'
		);

		const inputPath = await writeComponentFile(
			dir,
			'url-page',
			`import { Component } from '@angular/core';
@Component({
	selector: 'app-url',
	standalone: true,
	imports: [],
	templateUrl: './${basename(templatePath)}'
})
export class UrlPageComponent {}
`
		);

		const outputs = await compileAngularFileJIT(inputPath, outDir, dir);
		expect(outputs.length).toBeGreaterThan(0);

		const outputPath = outputs.find(path => path.endsWith('url-page.js'));
		expect(outputPath).toBeDefined();
		const output = await readFile(outputPath as string, 'utf-8');

		expect(output).toContain('abs-defer-slot');
		expect(output).toContain('DeferSlotComponent');
		expect(output).toContain('__absoluteDeferResolvePayload0');

		await rm(dir, { force: true, recursive: true });
	});

	test('evaluates @defer interpolation expressions in resolved HTML', async () => {
		const dir = await makeTemp();
		const outDir = join(dir, 'out');
		await mkdir(outDir, { recursive: true });

		const inputPath = await writeComponentFile(
			dir,
			'interpolate-page',
			`import { Component } from '@angular/core';
@Component({
	selector: 'app-interpolate',
	standalone: true,
	imports: [],
	template: \`<section>
		@defer (on timer(20ms)) {
			<p>{{ timestamp() }}</p>
		} @placeholder {
			<p>Loading</p>
		}
	</section>\`
})
export class InterpolatePageComponent {
	timestamp() {
		return 'resolved';
	}
}
`
		);

		const outputs = await compileAngularFileJIT(inputPath, outDir, dir);
		expect(outputs.length).toBeGreaterThan(0);

		const outputPath = outputs.find(path => path.endsWith('interpolate-page.js'));
		expect(outputPath).toBeDefined();
		const output = await readFile(outputPath as string, 'utf-8');

		expect(output).toContain('__absoluteDeferResolveTemplateExpression');
		expect(output).toContain('__absoluteDeferHtml0 = () => `');
		expect(output).toContain('__absoluteDeferData0 = () => ({');
		expect(output).toContain('__absoluteDeferResolvePayload0 = () => new Promise');
		expect(output).toContain('resolve({ kind: "angular-defer", state: "resolved", html: this.__absoluteDeferHtml0(), data: this.__absoluteDeferData0() })');
		expect(output).toContain('this.__absoluteDeferResolveTemplateExpression("timestamp()")');
		expect(output).not.toContain('{{ timestamp() }}');

		await rm(dir, { force: true, recursive: true });
	});

	test(
		'generated client bootstrap defers streaming slot flush until after hydration',
		async () => {
		const outDir = await mkdtemp(join(tmpdir(), 'absolutejs-angular-build-'));
		await mkdir(outDir, { recursive: true });

		const { clientPaths } = await compileAngular(
			[STREAMING_FIXTURE],
			outDir,
			false
		);
		const indexPath = clientPaths.find(path => path.endsWith('streaming-page.js'));
		expect(indexPath).toBeDefined();
		const indexContent = await readFile(indexPath as string, 'utf-8');

		expect(indexContent).toContain("var pageHasStreamingSlots = Boolean(document.querySelector('[data-absolute-slot=\"true\"]'));");
		expect(indexContent).toContain("var pageHasRawStreamingSlots = Boolean(document.querySelector('[data-absolute-raw-slot=\"true\"]'));");
		expect(indexContent).toContain('window.__ABS_SLOT_HYDRATION_PENDING__ = pageHasRawStreamingSlots;');
		expect(indexContent).toContain('window.__ABS_SLOT_HYDRATION_PENDING__ = false;');
		expect(indexContent).toContain("if (typeof window.__ABS_SLOT_FLUSH__ === 'function')");

		await rm(outDir, { force: true, recursive: true });
	},
		15_000
	);
});
