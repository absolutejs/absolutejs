import { inject, REQUEST_CONTEXT } from '@angular/core';

/** Typed accessor for the per-request context object the backend handler
 *  passed via `requestContext`. AbsoluteJS provides it through Angular's
 *  standard `REQUEST_CONTEXT` token on both SSR and client hydration, so
 *  the value is identical across both phases.
 *
 *  `REQUEST_CONTEXT`'s value type is `unknown` upstream, which is correct
 *  for a token that can carry anything. Pages know the shape they expect,
 *  so this composable takes a generic parameter the caller fills in.
 *  Type-safety is enforced at the call site in the backend handler
 *  (`handleAngularPageRequest<Ctx>({ requestContext: Ctx })`) — the
 *  generic on both sides has to agree for the program to compile, so
 *  the cast inside this composable can't go out of sync with reality.
 *
 *  Must be called in an Angular injection context (component
 *  constructor, field initializer, or `runInInjectionContext`). */
export const usePageContext = <T>() => inject(REQUEST_CONTEXT) as T;
