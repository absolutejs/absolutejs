import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import {
	compileAngular,
	compileAngularFile,
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
const LESS_STYLE_FIXTURE = join(
	process.cwd(),
	'tests',
	'fixtures',
	'angular',
	'less-style-page.ts'
);
const STYLUS_STYLE_FIXTURE = join(
	process.cwd(),
	'tests',
	'fixtures',
	'angular',
	'stylus-style-page.ts'
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

	test('compiles absolute local component imports and inlines their resources', async () => {
		const dir = await makeTemp();
		const outDir = join(dir, 'out');
		await mkdir(outDir, { recursive: true });

		const childTemplatePath = join(dir, 'child.html');
		await writeFile(childTemplatePath, `<p>Child template</p>`, 'utf-8');
		const childPath = await writeComponentFile(
			dir,
			'child',
			`import { Component } from '@angular/core';
@Component({
	selector: 'app-child',
	standalone: true,
	templateUrl: './child.html'
})
export class ChildComponent {}
`
		);
		const inputPath = await writeComponentFile(
			dir,
			'absolute-import-page',
			`import { Component } from '@angular/core';
import { ChildComponent } from '${childPath.replace(/\\/g, '/')}';
@Component({
	selector: 'app-absolute-import',
	standalone: true,
	imports: [ChildComponent],
	template: '<app-child></app-child>'
})
export class AbsoluteImportPageComponent {}
`
		);

		const outputs = await compileAngularFileJIT(inputPath, outDir, dir);
		const pageOutputPath = outputs.find(path => path.endsWith('absolute-import-page.js'));
		const childOutputPath = outputs.find(path => path.endsWith('child.js'));
		expect(pageOutputPath).toBeDefined();
		expect(childOutputPath).toBeDefined();
		const pageOutput = await readFile(pageOutputPath as string, 'utf-8');
		const childOutput = await readFile(childOutputPath as string, 'utf-8');

		expect(pageOutput).toContain(`from "./child.js"`);
		expect(childOutput).toContain('template: `<p>Child template</p>`');
		expect(childOutput).not.toContain('templateUrl');

		await rm(dir, { force: true, recursive: true });
	});

	test('compiles tsconfig path alias component imports and inlines their resources', async () => {
		const dir = await makeTemp();
		const originalCwd = process.cwd();
		try {
			process.chdir(dir);
			const outDir = join(dir, 'out');
			const componentsDir = join(dir, 'components');
			await mkdir(componentsDir, { recursive: true });
			await writeFile(
				join(dir, 'tsconfig.json'),
				JSON.stringify({
					compilerOptions: {
						baseUrl: '.',
						paths: {
							'@cmp/*': ['components/*']
						}
					}
				}),
				'utf-8'
			);
			await writeFile(
				join(componentsDir, 'alias-child.html'),
				`<p>Alias child template</p>`,
				'utf-8'
			);
			await writeFile(
				join(componentsDir, 'alias-child.ts'),
				`import { Component } from '@angular/core';
@Component({
	selector: 'app-alias-child',
	standalone: true,
	templateUrl: './alias-child.html'
})
export class AliasChildComponent {}
`,
				'utf-8'
			);
			const inputPath = await writeComponentFile(
				dir,
				'alias-import-page',
				`import { Component } from '@angular/core';
import { AliasChildComponent } from '@cmp/alias-child';
@Component({
	selector: 'app-alias-import',
	standalone: true,
	imports: [AliasChildComponent],
	template: '<app-alias-child></app-alias-child>'
})
export class AliasImportPageComponent {}
`
			);

			const outputs = await compileAngularFileJIT(inputPath, outDir, dir);
			const pageOutputPath = outputs.find(path => path.endsWith('alias-import-page.js'));
			const childOutputPath = outputs.find(path => path.endsWith('alias-child.js'));
			expect(pageOutputPath).toBeDefined();
			expect(childOutputPath).toBeDefined();
			const pageOutput = await readFile(pageOutputPath as string, 'utf-8');
			const childOutput = await readFile(childOutputPath as string, 'utf-8');

			expect(pageOutput).toContain(`from "./components/alias-child.js"`);
			expect(childOutput).toContain('template: `<p>Alias child template</p>`');
			expect(childOutput).not.toContain('templateUrl');
		} finally {
			process.chdir(originalCwd);
			await rm(dir, { force: true, recursive: true });
		}
	});

	test('reports missing styleUrl resources before Angular SSR fetches them', async () => {
		const dir = await makeTemp();
		const outDir = join(dir, 'out');
		await mkdir(outDir, { recursive: true });
		const inputPath = await writeComponentFile(
			dir,
			'missing-style-page',
			`import { Component } from '@angular/core';
@Component({
	selector: 'app-missing-style',
	standalone: true,
	styleUrl: './missing.css',
	template: '<p>Missing style</p>'
})
export class MissingStylePageComponent {}
`
		);

		await expect(
			compileAngularFileJIT(inputPath, outDir, dir)
		).rejects.toThrow('Unable to inline Angular style resource');

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
		'compiles Less styleUrl resources in AOT builds',
		async () => {
			const outDir = await mkdtemp(join(tmpdir(), 'absolutejs-angular-less-'));
			await mkdir(outDir, { recursive: true });

			const outputs = await compileAngularFile(LESS_STYLE_FIXTURE, outDir);
			const outputPath = outputs.find(path => path.endsWith('less-style-page.js'));
			expect(outputPath).toBeDefined();
			const output = await readFile(outputPath as string, 'utf-8');

			expect(output).toContain('border: 2px solid rgba(15, 118, 110, 0.3)');
			expect(output).toContain('color: #0f766e');
			expect(output).not.toContain('@accent');

			await rm(outDir, { force: true, recursive: true });
		},
		15_000
	);

	test(
		'compiles Stylus styleUrl resources in AOT builds',
		async () => {
			const outDir = await mkdtemp(join(tmpdir(), 'absolutejs-angular-stylus-'));
			await mkdir(outDir, { recursive: true });

			const outputs = await compileAngularFile(STYLUS_STYLE_FIXTURE, outDir);
			const outputPath = outputs.find(path => path.endsWith('stylus-style-page.js'));
			expect(outputPath).toBeDefined();
			const output = await readFile(outputPath as string, 'utf-8');

			expect(output).toContain('border: 2px solid rgba(126,34,206,0.3)');
			expect(output).toContain('color: #7e22ce');
			expect(output).not.toContain('accent =');

			await rm(outDir, { force: true, recursive: true });
		},
		15_000
	);

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
