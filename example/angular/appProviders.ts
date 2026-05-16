import type { EnvironmentProviders, Provider } from '@angular/core';

/** Global Angular DI provider array threaded through the build to
 *  every page's compiled server output as `[...appProviders, ...]`.
 *  Intentionally empty in the example baseline so the existing test
 *  fixtures keep their current providers shape — the HMR coverage
 *  tests in `tests/integration/hmr/lifecycle/angular-config-providers.test.ts`
 *  mutate this file to add a provider and assert it flows into SSR. */
export const appProviders: ReadonlyArray<Provider | EnvironmentProviders> = [];
