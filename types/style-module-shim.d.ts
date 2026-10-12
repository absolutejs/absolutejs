declare module '*.module.scss' {
	const classes: Readonly<Record<string, string>>;

	export default classes;
}

declare module '*.module.sass' {
	const classes: Readonly<Record<string, string>>;

	export default classes;
}

declare module '*.module.less' {
	const classes: Readonly<Record<string, string>>;

	export default classes;
}

declare module '*.module.styl' {
	const classes: Readonly<Record<string, string>>;

	export default classes;
}

declare module '*.module.stylus' {
	const classes: Readonly<Record<string, string>>;

	export default classes;
}

/* Plain stylesheets, imported for their side effect (`import './app.css'`).
 * TypeScript 7 checks those imports (noUncheckedSideEffectImports is on by
 * default), so bun check reports TS2882 without a declaration. The bodies are
 * empty, as in Next.js and Vite: a stylesheet has no named exports to type.
 *
 * They must stay below the `*.module.*` declarations. When two wildcards
 * match, TypeScript takes the first declared, not the most specific, and a
 * `*.css` above `*.module.css` turns every CSS-module class into `any`. */
declare module '*.css' {}
declare module '*.scss' {}
declare module '*.sass' {}
declare module '*.less' {}
declare module '*.styl' {}
declare module '*.stylus' {}
