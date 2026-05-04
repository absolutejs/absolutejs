/* Bun loader plugin that bakes a Vite-style `_HmrLoad` listener into
 * each JIT-compiled component file as it's being bundled.
 *
 * Mirrors the shape `compileHmrInitializer` in `@angular/compiler`
 * emits when AOT runs with `enableHmr: true` — same id encoding,
 * same `/@ng/component?c=<id>&t=<ts>` URL contract, same
 * `${ClassName}_UpdateMetadata(class, namespaces)` callback shape.
 * The only adaptation: instead of `import.meta.hot.on(...)` (which
 * Bun's bundler statically replaces with `undefined` for browser
 * targets), we register against `globalThis.__angularHmr`, a tiny
 * runtime shim defined on the client (see `src/dev/client/handlers/
 * angularHmrShim.ts`). The shim routes WS `angular:component-update`
 * messages to the listeners.
 *
 * Why a Bun plugin and not the existing JIT pipeline:
 *   - The plugin runs at bundle-time, so it sees each generated
 *     `*.component.js` exactly once and appends in-place. No source
 *     files on disk are mutated.
 *   - Class names are preserved through bundling (Bun keeps them
 *     unless they collide), so the appended block can reference the
 *     class directly without needing a separate registration step. */

import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { BunPlugin } from 'bun';

/* Match `<ClassName> = __legacyDecorateClassTS<maybe-suffix>([... <Decorator>(`
 * for any of the four Angular entity decorators
 * (`@Component`, `@Directive`, `@Pipe`, `@Injectable`).
 *
 * The JIT pipeline emits class decorators via TypeScript's legacy
 * decorator helper. Bun's transpiler uniquifies the helper name in
 * pre-bundled output as `__legacyDecorateClassTS_<hash>` to avoid
 * collisions when multiple modules import it from `bun:wrap`.
 * Decorator names may also be aliased (`Component2`, `Pipe3`, ...)
 * when multiple imports collide. The pattern is robust to whitespace
 * + multi-line decorator objects because we use `[\s\S]*?` (lazy
 * any-char) inside the decorator array. */
const ENTITY_DECORATOR_RE =
	/([A-Z][A-Za-z0-9_$]*)\s*=\s*__legacyDecorateClassTS[A-Za-z0-9_$]*\s*\(\s*\[[\s\S]*?\b(?:Component|Directive|Pipe|Injectable)[A-Za-z0-9_$]*\s*\(/g;

const buildHmrTail = (
	className: string,
	encodedIdLiteral: string
): string => `

// absolutejs HMR — auto-generated; mirrors compileHmrInitializer from
// @angular/compiler with import.meta.hot adapted to globalThis.__angularHmr.
//
// We invoke \`ɵɵreplaceMetadata\` rather than calling the surgical
// update directly. Both end up applying the new \`ɵcmp\` to the class,
// but \`ɵɵreplaceMetadata\` ALSO walks the LView tree and runs
// \`recreateLView\` on each affected instance — that's what triggers
// the actual template re-render, style swap, and lifecycle hook
// re-fire. Calling the update fn directly mutates the def but
// Angular's runtime never observes it, so views don't update.
//
// Pipes / directives / services don't have a \`ɵcmp\` and aren't
// tracked in the LView tree the same way; for those we still fall
// back to a direct call (the surgical module's job is just to
// patch the prototype, no view recreation needed).
{
  const __ng_hmr_id = ${encodedIdLiteral};
  const __ng_hmr_load = async (t) => {
    const [u, core] = await Promise.all([
      import('/@ng/component?c=' + encodeURIComponent(__ng_hmr_id) + '&t=' + t),
      import('@angular/core')
    ]);
    if (!u || typeof u.default !== 'function') return;
    if (${className}.ɵcmp && typeof core.ɵɵreplaceMetadata === 'function') {
      core.ɵɵreplaceMetadata(
        ${className},
        u.default,
        [core],
        [],
        import.meta,
        __ng_hmr_id
      );
    } else {
      // Non-component entity (pipe / directive / service) — no
      // LView tree to walk, just apply the prototype patch.
      u.default(${className}, [core]);
    }
  };
  if (typeof globalThis !== 'undefined' &&
      globalThis.__angularHmr &&
      typeof globalThis.__angularHmr.on === 'function') {
    globalThis.__angularHmr.on('angular:component-update', (d) => {
      if (d && d.id === __ng_hmr_id) __ng_hmr_load(d.timestamp);
    });
  }
}
`;

export type AngularHmrInjectionParams = {
	/* Where ngc-cli's JIT output lands —
	 * `<projectRoot>/.absolutejs/generated/angular` in dev. The plugin
	 * only injects into files under this root so we don't touch
	 * @angular/* vendor or sibling framework outputs. */
	generatedAngularRoot: string;

	/* The user's Angular source dir from absolute.config.ts — e.g.
	 * `<projectRoot>/example/angular`. Used to map a generated .js
	 * file back to its original .ts so the HMR id matches what
	 * `encodeHmrComponentId` produces server-side. */
	userAngularRoot: string;

	projectRoot: string;
};

export const createAngularHmrInjectionPlugin = (
	params: AngularHmrInjectionParams
): BunPlugin => {
	const { generatedAngularRoot, userAngularRoot, projectRoot } = params;
	const normalizedGenRoot = resolve(generatedAngularRoot).replace(/\\/g, '/');

	return {
		name: 'absolute-angular-hmr-injection',
		setup(build) {
			build.onLoad({ filter: /\.component\.js$/ }, async (args) => {
				const normalizedPath = args.path.replace(/\\/g, '/');
				if (!normalizedPath.startsWith(normalizedGenRoot + '/'))
					return undefined;

				const text = await readFile(args.path, 'utf8');

				const seen = new Set<string>();
				const classNames: string[] = [];
				let match: RegExpExecArray | null;
				const re = new RegExp(
					ENTITY_DECORATOR_RE.source,
					ENTITY_DECORATOR_RE.flags
				);
				while ((match = re.exec(text)) !== null) {
					const className = match[1];
					if (className && !seen.has(className)) {
						seen.add(className);
						classNames.push(className);
					}
				}
				if (classNames.length === 0) return undefined;

				const relFromGenRoot = relative(
					generatedAngularRoot,
					args.path
				).replace(/\\/g, '/');
				const userTsPath = resolve(
					userAngularRoot,
					relFromGenRoot.replace(/\.js$/, '.ts')
				);
				const projectRel = relative(projectRoot, userTsPath).replace(
					/\\/g,
					'/'
				);

				const tail = classNames
					.map((className) => {
						const id = `${projectRel}@${className}`;
						return buildHmrTail(className, JSON.stringify(id));
					})
					.join('');

				return { contents: text + tail, loader: 'js' };
			});
		}
	};
};
