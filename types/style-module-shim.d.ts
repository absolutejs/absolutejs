/* TypeScript 7, and so bun check, reports a side-effect import of a file it
 * has no declaration for (TS2882), and every AbsoluteJS app imports its
 * stylesheets that way. The CSS-module declarations below are more specific
 * and still win for `*.module.*` files. */
declare module '*.css';
declare module '*.scss';
declare module '*.sass';
declare module '*.less';
declare module '*.styl';
declare module '*.stylus';

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
