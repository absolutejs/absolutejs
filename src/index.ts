// Side-effect-only import. Patches Angular's `getCompilerFacade` to
// self-bootstrap `@angular/compiler` on first miss — needed for code
// paths that load `@angular/*` from node_modules at runtime (e.g. unit
// tests importing `dist/angular/*` directly). The vendor pipeline
// short-circuits this in normal dev/prod, but the patch is cheap and
// idempotent, and a no-op when `@angular/core` isn't installed.
import './angular/injectorPatch';
import { markBoot } from './utils/bootTimeline';

// Runs after the whole framework module graph has been evaluated (import
// declarations are hoisted), so it measures the cost of `dist/index.js`.
markBoot('framework runtime imported');

export * from '../types';
export * from './build/index';
export * from './constants';
export * from './core';
export * from './plugins/index';
export * from './utils/index';
