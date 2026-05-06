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

/* Extract local binding names from `import` statements in the post-
 * transpile JS source. Only handles ESM `import { a, b as c } from 'x'`
 * and `import d from 'x'` and `import * as ns from 'x'`. Misses dynamic
 * imports and `require(...)` — that's fine, we only need symbols
 * referenced from class bodies, which always come from static imports
 * in modern Angular code.
 *
 * We deliberately ignore the *source* of each import — we just want
 * the local names that will be in module scope after the bundle
 * loads. Rebinding them onto `Class.__abs_deps` makes them reachable
 * to the surgical-update module loaded later from `/@ng/component`,
 * which doesn't share the bundle's lexical scope and otherwise can't
 * resolve identifiers like `AccountService` referenced by Tier 1a's
 * `_Fresh` class constructor. */
const IMPORT_RE =
	/^\s*import\s+(?:(?:(\*)\s+as\s+([A-Za-z_$][\w$]*)\s+from)|(?:([A-Za-z_$][\w$]*)(?:\s*,\s*\{([^}]*)\})?\s+from)|(?:\{([^}]*)\}\s+from))\s*['"][^'"]+['"]/gm;

/* Match top-level `const X`, `let X`, `var X`, `function X`, and
 * `class X` declarations. Anchored to start-of-line — declarations
 * inside functions/blocks are indented and won't match. Catches the
 * common pattern of module-level helpers (`const square = (id) =>
 * ...`) that Tier 1a's `_Fresh` body might reference and that
 * aren't in any import statement. */
const TOP_LEVEL_DECL_RE =
	/^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

const extractAllTopLevelNames = (jsSource: string): string[] => {
	const names = new Set<string>();

	IMPORT_RE.lastIndex = 0;
	let importMatch: RegExpExecArray | null;
	while ((importMatch = IMPORT_RE.exec(jsSource)) !== null) {
		const [, , nsName, defaultName, namedAfterDefault, named] = importMatch;
		if (nsName) names.add(nsName);
		if (defaultName) names.add(defaultName);
		const namedClause = namedAfterDefault ?? named;
		if (namedClause) {
			for (const part of namedClause.split(',')) {
				const trimmed = part.trim();
				if (!trimmed) continue;
				const asIdx = trimmed.search(/\s+as\s+/);
				const local =
					asIdx >= 0
						? trimmed
								.slice(asIdx)
								.replace(/^\s+as\s+/, '')
								.trim()
						: trimmed;
				if (/^[A-Za-z_$][\w$]*$/.test(local)) names.add(local);
			}
		}
	}

	TOP_LEVEL_DECL_RE.lastIndex = 0;
	let declMatch: RegExpExecArray | null;
	while ((declMatch = TOP_LEVEL_DECL_RE.exec(jsSource)) !== null) {
		const name = declMatch[1];
		if (name) names.add(name);
	}

	return [...names];
};

const buildHmrTail = (className: string, encodedIdLiteral: string): string => `

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
  // Per-class sequence counter. Each \`__ng_hmr_load\` /
  // \`__ng_hmr_remount\` invocation captures \`seq\` at start, then
  // checks after the async fetch + before the apply. If a NEWER
  // event has bumped the counter while we were awaiting (rapid
  // edits), this older invocation aborts so the latest payload
  // is the one that lands. Without this guard, racing
  // \`ɵɵreplaceMetadata\` calls can complete out of order and an
  // older edit's def stomps a newer one's.
  let __ng_hmr_seq = 0;
  // Send a server-side ack so the dev terminal can log the
  // full HMR latency (server compile + WS hop + client apply +
  // CD pulse) rather than just the server-side compile time.
  const __ng_hmr_ack = (tier, applyMs, error) => {
    try {
      const ws = globalThis.__HMR_WS__;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'angular:hmr-ack',
          id: __ng_hmr_id,
          className: ${JSON.stringify(className)},
          tier,
          applyMs,
          error
        }));
      }
    } catch {}
  };
  const __ng_hmr_load = async (t) => {
    const mySeq = ++__ng_hmr_seq;
    const t0 = performance.now();
    const [u, core] = await Promise.all([
      import('/@ng/component?c=' + encodeURIComponent(__ng_hmr_id) + '&t=' + t),
      import('@angular/core')
    ]);
    if (mySeq !== __ng_hmr_seq) return; // superseded by a newer event
    if (!u || typeof u.default !== 'function') return;
    if (${className}.ɵcmp && typeof core.ɵɵreplaceMetadata === 'function') {
      try {
        core.ɵɵreplaceMetadata(
          ${className},
          u.default,
          [core],
          [],
          import.meta,
          __ng_hmr_id
        );
        __ng_hmr_ack('tier-0', performance.now() - t0);
      } catch (err) {
        console.error('[abs-hmr] ɵɵreplaceMetadata threw for ${className}:', err);
        __ng_hmr_ack('tier-0', performance.now() - t0, String(err && err.message || err));
      }
    } else {
      // Non-component entity (pipe / directive / service) — no
      // LView tree to walk, just apply the prototype patch.
      u.default(${className}, [core]);
      __ng_hmr_ack('tier-0', performance.now() - t0);
    }
  };
  // Tier 1 remount: structural changes (new ctor params / new field
  // initializers / new providers) make a CONTEXT-preserving replace
  // unsafe — the existing instance lacks the new fields. The remount
  // path tears down the live LView and re-creates it via public
  // \`createComponent\` against the same host, so the new constructor
  // runs with fresh DI, new lifecycle hooks fire, and the splice
  // logic puts the result back in the parent's view tree. The
  // shared implementation is on \`globalThis.__absAngularRemount\` —
  // installed by hmrClient.ts's import-time wiring.
  const __ng_hmr_remount = async (t) => {
    const mySeq = ++__ng_hmr_seq;
    const t0 = performance.now();
    const [u, core] = await Promise.all([
      import('/@ng/component?c=' + encodeURIComponent(__ng_hmr_id) + '&t=' + t),
      import('@angular/core')
    ]);
    if (mySeq !== __ng_hmr_seq) return; // superseded by a newer event
    if (!u || typeof u.default !== 'function') return;
    if (typeof globalThis.__absAngularRemount === 'function' && ${className}.ɵcmp) {
      try {
        await globalThis.__absAngularRemount(
          ${className},
          u.default,
          [core],
          [],
          core,
          ${JSON.stringify(className)}
        );
        if (mySeq !== __ng_hmr_seq) return; // newer event arrived during remount
        __ng_hmr_ack('tier-1a', performance.now() - t0);
      } catch (err) {
        console.error('[abs-hmr] remount threw for ${className}:', err);
        __ng_hmr_ack('tier-1a', performance.now() - t0, String(err && err.message || err));
      }
    } else {
      // No remount helper installed (older absolutejs runtime, or
      // non-component entity). Fall back to surgical replace.
      u.default(${className}, [core]);
    }
  };

  if (typeof globalThis !== 'undefined' &&
      globalThis.__angularHmr &&
      typeof globalThis.__angularHmr.on === 'function') {
    globalThis.__angularHmr.on('angular:component-update', (d) => {
      if (d && d.id === __ng_hmr_id) __ng_hmr_load(d.timestamp);
    });
    globalThis.__angularHmr.on('angular:component-remount', (d) => {
      if (d && d.id === __ng_hmr_id) __ng_hmr_remount(d.timestamp);
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

/* Pure function that takes the JIT-compiled JS source of a `*.component.js`
 * file (under `generatedAngularRoot`) and appends the per-class HMR
 * listener block + Tier 1a `__abs_deps` registry.
 *
 * Used by both:
 *   1. The Bun plugin (production / island bundles) via
 *      `createAngularHmrInjectionPlugin`.
 *   2. The dev moduleServer (per-file dev serving — replaces the dev
 *      bundle that was previously rebuilt on every edit).
 *
 * Returns the SAME source if no Angular-decorated classes are detected
 * (e.g. helper modules, non-component .js files). Caller should handle
 * `undefined` as "no transformation needed".  */
export const applyAngularHmrInjection = (
	jsSource: string,
	componentJsAbsPath: string,
	params: AngularHmrInjectionParams
): string | undefined => {
	const { generatedAngularRoot, userAngularRoot, projectRoot } = params;
	const normalizedGenRoot = resolve(generatedAngularRoot).replace(/\\/g, '/');
	const normalizedPath = componentJsAbsPath.replace(/\\/g, '/');
	if (!normalizedPath.startsWith(normalizedGenRoot + '/')) return undefined;

	const seen = new Set<string>();
	const classNames: string[] = [];
	let match: RegExpExecArray | null;
	const re = new RegExp(
		ENTITY_DECORATOR_RE.source,
		ENTITY_DECORATOR_RE.flags
	);
	while ((match = re.exec(jsSource)) !== null) {
		const className = match[1];
		if (className && !seen.has(className)) {
			seen.add(className);
			classNames.push(className);
		}
	}
	if (classNames.length === 0) return undefined;

	const relFromGenRoot = relative(
		generatedAngularRoot,
		componentJsAbsPath
	).replace(/\\/g, '/');
	const userTsPath = resolve(
		userAngularRoot,
		relFromGenRoot.replace(/\.js$/, '.ts')
	);
	const projectRel = relative(projectRoot, userTsPath).replace(/\\/g, '/');

	const tail = classNames
		.map((className) => {
			const id = `${projectRel}@${className}`;
			return buildHmrTail(className, JSON.stringify(id));
		})
		.join('');

	/* Tier 1a remount needs to instantiate a "fresh" class
	 * with the new constructor body (re-running field
	 * initializers like `private foo = inject(Foo)`).
	 * Those references resolve via the bundle's lexical
	 * scope at compile time — but the surgical-update
	 * module loaded from `/@ng/component` doesn't share
	 * that scope. Stash every local import binding onto
	 * `Class.__abs_deps` so the surgical module can
	 * destructure from there: `const { Foo, ... } =
	 * HeroComponent.__abs_deps`.
	 *
	 * Identity sharing is the key win: the bundle's
	 * `Foo` reference IS the same class Angular's
	 * injector tree was wired against, so calling
	 * `inject(Foo)` from the FreshClass returns the SAME
	 * instance Angular already has. Re-fetching `Foo`
	 * from `/@src/...` would create a duplicate class
	 * with a different identity, and DI would fail. */
	const topLevelNames = extractAllTopLevelNames(jsSource);
	const depsKeys = topLevelNames
		.filter((n) => !classNames.includes(n))
		.join(', ');
	const depsBlock =
		classNames.length > 0 && depsKeys
			? `\n\n// absolutejs HMR — Tier 1a class-deps registry\n` +
				classNames
					.map(
						(c) =>
							`try { ${c}.__abs_deps = { ${depsKeys} }; } catch {}`
					)
					.join('\n') +
				'\n'
			: '';

	return jsSource + tail + depsBlock;
};

export const createAngularHmrInjectionPlugin = (
	params: AngularHmrInjectionParams
): BunPlugin => ({
	name: 'absolute-angular-hmr-injection',
	setup(build) {
		// Match every `.js` file — `applyAngularHmrInjection` already
		// gates on the `.absolutejs/generated/angular/` prefix and
		// returns the source unchanged when no Angular-decorated
		// class is detected, so vendor and non-Angular files pass
		// through. Including all `.js` (not just `.component.js`)
		// covers `.service.js`, `.directive.js`, and `.pipe.js` so
		// edits to those entities also broadcast HMR updates.
		build.onLoad({ filter: /\.js$/ }, async (args) => {
			const text = await readFile(args.path, 'utf8');
			const transformed = applyAngularHmrInjection(
				text,
				args.path,
				params
			);
			if (transformed === undefined) return undefined;
			return { contents: transformed, loader: 'js' };
		});
	}
});
