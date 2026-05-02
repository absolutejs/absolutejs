import type { AngularDeps } from '../../types/angular';

/* `REQUEST`, `REQUEST_CONTEXT`, and `RESPONSE_INIT` are public Angular DI
   tokens — import them directly from `@angular/core`. Re-exporting them
   here would force a static `import { ... } from "@angular/core"` into
   every absolutejs bundle that transitively reaches this file, breaking
   non-Angular consumers (no `@angular/core` installed) at module-load
   time. Bun's bundler treats `await import("./angular/...")` as a
   static dep when `splitting: false`, so even guarded dynamic loaders
   on the consumer side pull this file in. The cleanest fix is to not
   own these symbols here at all. */

export const buildRequestProviders = (
	deps: AngularDeps,
	request: Request | undefined,
	requestContext: unknown,
	responseInit: ResponseInit | undefined
) => [
	{ provide: deps.REQUEST, useValue: request ?? null },
	{ provide: deps.REQUEST_CONTEXT, useValue: requestContext ?? null },
	{ provide: deps.RESPONSE_INIT, useValue: responseInit ?? null }
];
