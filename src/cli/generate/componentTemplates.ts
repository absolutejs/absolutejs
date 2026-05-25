import type { FrameworkKey } from './frameworkKey';

// Minimal reusable components (no route, no nav). One template per framework.

export type ComponentTemplateContext = {
	kebab: string;
	pascal: string;
	title: string;
};

const reactComponent = (ctx: ComponentTemplateContext) =>
	`type ${ctx.pascal}Props = {
	label: string;
};

export const ${ctx.pascal} = ({ label }: ${ctx.pascal}Props) => (
	<button type="button">{label}</button>
);
`;

const svelteComponent = (ctx: ComponentTemplateContext) =>
	`<script lang="ts">
	type ${ctx.pascal}Props = {
		label: string;
	};

	let { label }: ${ctx.pascal}Props = $props();
</script>

<button type="button">{label}</button>
`;

const vueComponent = () =>
	`<script setup lang="ts">
	defineProps<{
		label: string;
	}>();
</script>

<template>
	<button type="button">{{ label }}</button>
</template>
`;

const angularComponent = (ctx: ComponentTemplateContext) =>
	`import { Component, input } from '@angular/core';

@Component({
	selector: 'app-${ctx.kebab}',
	standalone: true,
	template: \`<button type="button">{{ label() }}</button>\`
})
export class ${ctx.pascal}Component {
	label = input('');
}
`;

const htmlComponent = (ctx: ComponentTemplateContext) =>
	`<button type="button">${ctx.title}</button>
`;

const htmxComponent = (ctx: ComponentTemplateContext) =>
	`<button type="button" hx-get="/api/${ctx.kebab}" hx-swap="outerHTML">
	${ctx.title}
</button>
`;

export const componentTemplates: Record<
	FrameworkKey,
	(ctx: ComponentTemplateContext) => string
> = {
	angular: angularComponent,
	html: htmlComponent,
	htmx: htmxComponent,
	react: reactComponent,
	svelte: svelteComponent,
	vue: vueComponent
};
