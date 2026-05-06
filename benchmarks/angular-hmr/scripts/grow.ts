/* Grow the fixture to a target size by generating N filler
 * standalone components plus the page wiring that imports and
 * renders them. The base components (counter, header) and the
 * page's structural roles are preserved; only the filler list
 * and the page's `imports: [...]` array change.
 *
 * Usage: bun run scripts/grow.ts <count>
 *
 * Files written:
 *   - angular/components/generated/comp-<i>.component.ts (per i)
 *   - angular/components/generated/index.ts             (barrel)
 *   - angular/pages/bench.ts                            (rewritten)
 *   - angular/templates/bench.html                      (rewritten)
 *
 * Idempotent: run again with a different count to resize. */

import { promises as fs, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');
const COMPONENTS_DIR = resolve(PROJECT, 'angular/components');
const GENERATED_DIR = resolve(COMPONENTS_DIR, 'generated');
const PAGES_DIR = resolve(PROJECT, 'angular/pages');
const TEMPLATES_DIR = resolve(PROJECT, 'angular/templates');

const N = Number(process.argv[2] ?? '');
if (!Number.isFinite(N) || N < 0) {
	console.error(`usage: bun run scripts/grow.ts <count>`);
	process.exit(2);
}

const componentSrc = (i: number) =>
	`import { Component, Input } from '@angular/core';

@Component({
\tselector: 'app-comp-${i}',
\tstandalone: true,
\ttemplate: \`<span class="comp-${i}">{{ label }} #${i}</span>\`
})
export class Comp${i} {
\t@Input() label: string = 'comp';
}
`;

const pageSrc = (count: number) => {
	const importLines: string[] = [];
	const componentNames: string[] = [];
	for (let i = 1; i <= count; i++) {
		importLines.push(
			`import { Comp${i} } from '../components/generated/comp-${i}.component';`
		);
		componentNames.push(`Comp${i}`);
	}

	const fillerImports =
		componentNames.length > 0
			? `,\n\t\t${componentNames.join(',\n\t\t')}`
			: '';

	return `import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { defineAngularPage } from '@absolutejs/absolute/angular';
import { CounterComponent } from '../components/counter.component';
import { HeaderComponent } from '../components/header.component';
${importLines.join('\n')}

type BenchProps = {
\tinitialCount: number;
};

@Component({
\timports: [
\t\tCommonModule,
\t\tHeaderComponent,
\t\tCounterComponent${fillerImports}
\t],
\tselector: 'bench-page',
\tstandalone: true,
\ttemplateUrl: '../templates/bench.html'
})
export class BenchPage {
\tinitialCount: number = 0;
}

export const page = defineAngularPage<BenchProps>({
\tcomponent: BenchPage
});
`;
};

const templateSrc = (count: number) => {
	const fillerLines: string[] = [];
	for (let i = 1; i <= count; i++) {
		fillerLines.push(`\t<app-comp-${i}></app-comp-${i}>`);
	}

	return `<app-header></app-header>
<main style="padding: 2rem;">
\t<h1>HMR Bench</h1>
\t<app-counter [initialCount]="initialCount"></app-counter>
${fillerLines.join('\n')}
</main>
`;
};

await fs.rm(GENERATED_DIR, { recursive: true, force: true });
if (N > 0) {
	await fs.mkdir(GENERATED_DIR, { recursive: true });
	for (let i = 1; i <= N; i++) {
		await fs.writeFile(
			resolve(GENERATED_DIR, `comp-${i}.component.ts`),
			componentSrc(i)
		);
	}
}

await fs.writeFile(resolve(PAGES_DIR, 'bench.ts'), pageSrc(N));
await fs.writeFile(resolve(TEMPLATES_DIR, 'bench.html'), templateSrc(N));

if (existsSync(resolve(PROJECT, 'build'))) {
	await fs.rm(resolve(PROJECT, 'build'), { recursive: true, force: true });
}
if (existsSync(resolve(PROJECT, '.absolutejs'))) {
	await fs.rm(resolve(PROJECT, '.absolutejs'), {
		recursive: true,
		force: true
	});
}

console.log(`Grown fixture to ${N} filler components.`);
