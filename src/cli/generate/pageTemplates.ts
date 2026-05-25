import type { FrameworkKey } from './frameworkKey';
import type { NavItem } from './navData';
import { renderNavBlock } from './staticNav';

// Minimal, idiomatic starter pages — Head/styles wired, nav rendered from the
// shared navData source of truth (static pages bake a snapshot), and a single
// <h1> to fill in. One template per framework, keyed in PageTemplateContext.

export type PageTemplateContext = {
	cssHref: string;
	kebab: string;
	navImportPath: string;
	navItems: NavItem[];
	pascal: string;
	title: string;
};

const reactPage = (ctx: PageTemplateContext) =>
	`import { Head } from '@absolutejs/absolute/react/components';
import { navData } from '${ctx.navImportPath}';

type ${ctx.pascal}Props = {
	cssPath?: string;
};

export const ${ctx.pascal} = ({ cssPath }: ${ctx.pascal}Props) => (
	<html lang="en">
		<Head cssPath={cssPath} title="${ctx.title}" />
		<body>
			<nav>
				{navData.map((item) => (
					<a key={item.href} href={item.href}>
						{item.label}
					</a>
				))}
			</nav>
			<main>
				<h1>${ctx.title}</h1>
			</main>
		</body>
	</html>
);
`;

const sveltePage = (ctx: PageTemplateContext) =>
	`<script lang="ts">
	import { navData } from '${ctx.navImportPath}';

	type ${ctx.pascal}Props = {
		cssPath?: string;
	};

	let { cssPath }: ${ctx.pascal}Props = $props();
</script>

<svelte:head>
	{#if cssPath}
		<link rel="stylesheet" href={cssPath} />
	{/if}
	<title>${ctx.title}</title>
</svelte:head>

<nav>
	{#each navData as item (item.href)}
		<a href={item.href}>{item.label}</a>
	{/each}
</nav>

<main>
	<h1>${ctx.title}</h1>
</main>
`;

const vuePage = (ctx: PageTemplateContext) =>
	`<script setup lang="ts">
	import { navData } from '${ctx.navImportPath}';
</script>

<template>
	<nav>
		<a v-for="item in navData" :key="item.href" :href="item.href">
			{{ item.label }}
		</a>
	</nav>
	<main>
		<h1>${ctx.title}</h1>
	</main>
</template>
`;

const angularPage = (ctx: PageTemplateContext) =>
	`import { Component } from '@angular/core';
import { navData } from '${ctx.navImportPath}';

// This page has no per-request DI context, so the SSR handler's
// \`requestContext\` is an empty object.
export type Context = Record<string, never>;

@Component({
	imports: [],
	selector: '${ctx.kebab}-page',
	standalone: true,
	template: \`
		<nav>
			@for (item of navItems; track item.href) {
				<a [href]="item.href">{{ item.label }}</a>
			}
		</nav>
		<main>
			<h1>${ctx.title}</h1>
		</main>
	\`
})
export class ${ctx.pascal}Component {
	navItems = navData;
}
`;

const htmlHead = (ctx: PageTemplateContext, extraHead: string) =>
	`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${ctx.title}</title>
		<link rel="stylesheet" href="${ctx.cssHref}" />${extraHead}
	</head>
	<body>
		${renderNavBlock(ctx.navItems, '\t\t')}
		<main>
			<h1>${ctx.title}</h1>
		</main>
	</body>
</html>
`;

const htmlPage = (ctx: PageTemplateContext) => htmlHead(ctx, '');

const htmxPage = (ctx: PageTemplateContext) =>
	htmlHead(ctx, '\n\t\t<script src="/htmx/htmx.min.js"></script>');

export const pageTemplates: Record<
	FrameworkKey,
	(ctx: PageTemplateContext) => string
> = {
	angular: angularPage,
	html: htmlPage,
	htmx: htmxPage,
	react: reactPage,
	svelte: sveltePage,
	vue: vuePage
};
