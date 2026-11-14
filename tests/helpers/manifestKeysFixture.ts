import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BuildConfig } from '../../types/build';

/* A project using every page framework, global CSS, islands (with a
 * configured bootstrap) and static HTML/HTMX pages, for the test that the
 * manifest keys derived without a build (build/manifestKeys.ts) are the
 * keys a real build writes. Paths are relative to the fixture root. */

/** The fixture's build config, relative to its root. */
export const MANIFEST_KEYS_FIXTURE_CONFIG: BuildConfig = {
	angularDirectory: 'src/frontend/angular',
	buildDirectory: 'build',
	htmlDirectory: 'src/frontend/html',
	htmxDirectory: 'src/frontend/htmx',
	islands: {
		bootstrap: 'src/islands/bootstrap.ts',
		registry: 'src/islands/registry.ts'
	},
	reactDirectory: 'src/frontend/react',
	stylesConfig: 'src/frontend/styles/indexes',
	svelteDirectory: 'src/frontend/svelte',
	vueDirectory: 'src/frontend/vue'
};

export const MANIFEST_KEYS_FIXTURE_FILES: Record<string, string> = {
	'src/frontend/angular/components/badge.component.ts': `import { Component, Input } from '@angular/core';

@Component({ selector: 'app-badge', standalone: true, template: '<span>{{ label }}</span>' })
export class BadgeComponent {
	@Input() label = '';
}
`,
	'src/frontend/angular/pages/angular-dashboard.ts': `import { Component } from '@angular/core';
import { BadgeComponent } from '../components/badge.component';

@Component({
	imports: [BadgeComponent],
	selector: 'angular-page',
	standalone: true,
	template: '<app-badge label="dashboard" />'
})
export class AngularDashboardComponent {}
`,
	'src/frontend/html/pages/HtmlHome.html': `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>HTML_HOME</title>
		<script type="module" src="../scripts/html-counter.ts"></script>
	</head>
	<body>
		<h1>HTML_HOME</h1>
		<absolute-island framework="react" component="ReactCounter" props='{"start":1}'></absolute-island>
	</body>
</html>
`,
	'src/frontend/html/scripts/html-counter.ts': `export const counter = () => 1;
`,
	'src/frontend/htmx/pages/HtmxHome.html': `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>HTMX_HOME</title>
	</head>
	<body>
		<h1>HTMX_HOME</h1>
	</body>
</html>
`,
	'src/frontend/react/components/Card.tsx': `export const Card = ({ title }: { title: string }) => <h2>{title}</h2>;
`,
	'src/frontend/react/pages/about-us.tsx': `export const AboutUs = () => (
	<html lang="en">
		<body>
			<p>about</p>
		</body>
	</html>
);
`,
	'src/frontend/react/pages/react-home.css': `h2 { color: rebeccapurple; }
`,
	'src/frontend/react/pages/ReactHome.tsx': `import { Card } from '../components/Card';
import './react-home.css';

export const ReactHome = () => (
	<html lang="en">
		<body>
			<Card title="home" />
		</body>
	</html>
);
`,
	'src/frontend/styles/indexes/global-theme.css': `body { margin: 0; }
`,
	'src/frontend/styles/indexes/print.css': `body { color: black; }
`,
	'src/frontend/svelte/components/Counter.svelte': `<script lang="ts">
	let { start }: { start: number } = $props();
</script>

<span>{start}</span>
`,
	'src/frontend/svelte/pages/SveltePricing.svelte': `<script lang="ts">
	import Counter from '../components/Counter.svelte';

	let { cssPath }: { cssPath?: string } = $props();
</script>

<h1>{cssPath}</h1>
<Counter start={3} />

<style>
	h1 { color: teal; }
</style>
`,
	'src/frontend/vue/components/Pill.vue': `<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
	<span class="pill">{{ label }}</span>
</template>

<style scoped>
.pill { color: red; }
</style>
`,
	'src/frontend/vue/pages/VueProfile.vue': `<script setup lang="ts">
import Pill from '../components/Pill.vue';
</script>

<template>
	<main>
		<Pill label="profile" />
	</main>
</template>

<style scoped>
main { padding: 1rem; }
</style>
`,
	'src/islands/bootstrap.ts': `export const bootstrapped = true;
`,
	'src/islands/ReactCounter.tsx': `export const ReactCounter = ({ start }: { start: number }) => <button type="button">{start}</button>;
`,
	'src/islands/registry.ts': `import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { ReactCounter } from './ReactCounter';
import SvelteCounter from './SvelteCounter.svelte';
import VueCounter from './VueCounter.vue';

export const islandRegistry = defineIslandRegistry({
	react: { ReactCounter },
	svelte: { SvelteCounter },
	vue: { VueCounter }
});
`,
	'src/islands/SvelteCounter.svelte': `<script lang="ts">
	let { start }: { start: number } = $props();
</script>

<button type="button">{start}</button>

<style>
	button { color: green; }
</style>
`,
	'src/islands/VueCounter.vue': `<script setup lang="ts">
defineProps<{ start: number }>();
</script>

<template>
	<button type="button">{{ start }}</button>
</template>
`,
	'tsconfig.json': `{
	"compilerOptions": {
		"experimentalDecorators": true,
		"jsx": "react-jsx",
		"lib": ["DOM", "DOM.Iterable", "ESNext"],
		"module": "ESNext",
		"moduleResolution": "bundler",
		"skipLibCheck": true,
		"strict": true,
		"target": "ESNext",
		"useDefineForClassFields": false
	},
	"include": ["src"]
}
`
};

export const writeManifestKeysFixture = async (root: string) => {
	await Promise.all(
		Object.entries(MANIFEST_KEYS_FIXTURE_FILES).map(
			async ([path, contents]) => {
				await mkdir(dirname(join(root, path)), { recursive: true });
				await writeFile(join(root, path), contents);
			}
		)
	);
};
