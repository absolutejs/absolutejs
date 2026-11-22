/* Wrapping an Angular file route in its layouts.
 *
 * The same place as Svelte and Vue — the page's own source, before AOT —
 * and for the same reason: an Angular page renders from one compiled
 * module that both the server render and the client bootstrap load, so a
 * source wrap cannot have the two sides disagree about the order. React
 * is the odd one out, composing at run time in two places that have to be
 * kept in step.
 *
 * Two things make this transform bigger than Vue's, and both come from
 * Angular rather than from the file router.
 *
 * A template refers to a component by its SELECTOR, not by a local name,
 * so an import is not enough: the wrap has to read each layout's own
 * source for the selector its `@Component` declares, and for the class to
 * put in the page's `imports`. A layout with no selector cannot be used
 * in a template at all, so that is reported rather than wrapped around
 * nothing.
 *
 * And the template lives inside a decorator's object literal, so the edit
 * is three edits in one file — the template body, the `imports` array
 * (added when the component has none) and the import statements. They are
 * applied back-to-front by offset, because an edit earlier in the file
 * moves every offset after it; computing all three against one parse and
 * applying them forwards is the bug the Svelte transform shipped with
 * once.
 *
 * An Angular layout takes its content through `<ng-content />`, the
 * framework's own projection, where Svelte takes `children` and Vue a
 * `<slot />`. */
import type TS from 'typescript';
import { ts } from '../utils/lazyTypescript';

export type AngularLayoutMeta = {
	className: string;
	selector: string;
};

export type AngularLayoutImport = AngularLayoutMeta & {
	/** What the page's generated `import` statement points at. */
	specifier: string;
};

const parse = (source: string) =>
	ts.createSourceFile(
		'page.ts',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);

const componentDecorator = (declaration: TS.ClassDeclaration) =>
	ts
		.getDecorators(declaration)
		?.map((decorator) => decorator.expression)
		.filter(ts.isCallExpression)
		.find(
			(call) =>
				ts.isIdentifier(call.expression) &&
				call.expression.text === 'Component'
		);

const decoratorObject = (declaration: TS.ClassDeclaration) => {
	const [argument] = componentDecorator(declaration)?.arguments ?? [];

	return argument && ts.isObjectLiteralExpression(argument)
		? argument
		: undefined;
};

const propertyOf = (object: TS.ObjectLiteralExpression, name: string) =>
	object.properties
		.filter(ts.isPropertyAssignment)
		.find(
			(property) =>
				ts.isIdentifier(property.name) && property.name.text === name
		);

const stringValueOf = (
	object: TS.ObjectLiteralExpression,
	name: string
): string | undefined => {
	const initializer = propertyOf(object, name)?.initializer;
	if (!initializer) return undefined;
	if (ts.isStringLiteral(initializer)) return initializer.text;

	return ts.isNoSubstitutionTemplateLiteral(initializer)
		? initializer.text
		: undefined;
};

const isExported = (declaration: TS.ClassDeclaration) =>
	declaration.modifiers?.some(
		(modifier) =>
			modifier.kind === ts.SyntaxKind.ExportKeyword ||
			modifier.kind === ts.SyntaxKind.DefaultKeyword
	) === true;

/** The exported component classes in a source, each with its decorator
 *  object, in the order they are declared. */
const componentClasses = (source: string) =>
	parse(source)
		.statements.filter(ts.isClassDeclaration)
		.filter(isExported)
		.flatMap((declaration) => {
			const object = decoratorObject(declaration);

			return object && declaration.name
				? [{ declaration, name: declaration.name.text, object }]
				: [];
		});

/** A layout's class name and the selector its template is written as.
 *  Null when the file exports no component; the `selector` is empty when
 *  it declares none, which the caller reports — a component with no
 *  selector cannot appear in a template. */
export const readAngularLayoutMeta = (
	source: string
): AngularLayoutMeta | null => {
	const [component] = componentClasses(source);
	if (!component) return null;

	return {
		className: component.name,
		selector: stringValueOf(component.object, 'selector') ?? ''
	};
};

type Edit = {
	end: number;
	start: number;
	text: string;
};

const applyEdits = (source: string, edits: readonly Edit[]) =>
	[...edits]
		.sort((left, right) => right.start - left.start)
		.reduce(
			(text, edit) =>
				text.slice(0, edit.start) + edit.text + text.slice(edit.end),
			source
		);

/** The page's single exported component, or a message saying why there is
 *  no single one to wrap. A file route holding several components is a
 *  router host with co-located children (angular/splitRoutePages.ts), and
 *  guessing which of them the layouts belong around would wrap the wrong
 *  template as readily as the right one. */
const pageComponentOf = (source: string) => {
	const components = componentClasses(source);
	const [first] = components;
	if (!first)
		return { reason: 'it exports no Angular component class' } as const;
	if (components.length > 1)
		return {
			reason: `it exports ${components.length} Angular components (${components.map((component) => component.name).join(', ')}), so which one the layouts wrap is ambiguous`
		} as const;

	return { component: first } as const;
};

const templateEdit = (
	object: TS.ObjectLiteralExpression,
	layouts: readonly AngularLayoutImport[]
) => {
	const template = propertyOf(object, 'template')?.initializer;
	if (
		!template ||
		!(
			ts.isStringLiteral(template) ||
			ts.isNoSubstitutionTemplateLiteral(template) ||
			ts.isTemplateExpression(template)
		)
	)
		return undefined;

	/* Written inside the existing literal rather than replacing it, so an
	 * interpolating template (`${…}` in a template expression, which
	 * Angular users do use for shared markup) keeps its substitutions. */
	const open = layouts.map((layout) => `<${layout.selector}>`).join('');
	const close = [...layouts]
		.reverse()
		.map((layout) => `</${layout.selector}>`)
		.join('');
	const bodyStart = template.getStart() + 1;
	const bodyEnd = template.getEnd() - 1;

	return [
		{ end: bodyStart, start: bodyStart, text: open },
		{ end: bodyEnd, start: bodyEnd, text: close }
	];
};

const importsEdit = (
	object: TS.ObjectLiteralExpression,
	layouts: readonly AngularLayoutImport[]
) => {
	const names = layouts.map((layout) => layout.className).join(', ');
	const existing = propertyOf(object, 'imports')?.initializer;
	if (existing && ts.isArrayLiteralExpression(existing)) {
		const insertAt = existing.getEnd() - 1;
		const separator = existing.elements.length > 0 ? ', ' : '';

		return {
			end: insertAt,
			start: insertAt,
			text: `${separator}${names}`
		};
	}
	if (existing) return undefined;
	/* No `imports` at all: a standalone component with no template
	 * dependencies yet. Added as the first property so the decorator stays
	 * readable, and because appending after the last one would have to
	 * know whether it has a trailing comma. */
	const insertAt = object.getStart() + 1;

	return { end: insertAt, start: insertAt, text: `\n\timports: [${names}],` };
};

export type AngularLayoutWrap = {
	/** The layouts, outermost first. */
	layouts: readonly AngularLayoutImport[];
};

export type AngularLayoutWrapResult =
	| { kind: 'problem'; message: string }
	| { kind: 'skipped' }
	| { kind: 'wrapped'; source: string };

/** The page's source with its template wrapped in the layouts and the
 *  layout components imported, or a problem to report. `skipped` when
 *  there is nothing to wrap. */
export const wrapAngularRouteLayouts = (
	source: string,
	{ layouts }: AngularLayoutWrap
): AngularLayoutWrapResult => {
	if (layouts.length === 0) return { kind: 'skipped' };
	const found = pageComponentOf(source);
	if ('reason' in found)
		return {
			kind: 'problem',
			message: `has a layout, but ${found.reason}`
		};

	const { object } = found.component;
	const template = templateEdit(object, layouts);
	if (!template)
		return {
			kind: 'problem',
			message: `has a layout, but its \`@Component\` declares no inline \`template\` to wrap`
		};

	const imports = importsEdit(object, layouts);
	if (!imports)
		return {
			kind: 'problem',
			message:
				'has a layout, but its `@Component` `imports` is not an array literal, so the layout components cannot be added to it'
		};

	const statements = layouts
		.map(
			(layout) =>
				`import { ${layout.className} } from '${layout.specifier}';`
		)
		.join('\n');

	return {
		kind: 'wrapped',
		source: `${statements}\n${applyEdits(source, [...template, imports])}`
	};
};
