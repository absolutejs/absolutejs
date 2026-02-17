/* React Refresh runtime setup — must be imported before any component modules.
   Bun's reactFastRefresh flag injects $RefreshSig$/$RefreshReg$ calls into
   component code. This module ensures those globals exist before components
   initialize.

   IMPORTANT: This module is idempotent. On HMR re-import the existing runtime
   is preserved so new component registrations feed into the SAME RefreshRuntime
   instance that owns the current React tree. */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — react-refresh has no type declarations
import RefreshRuntime from 'react-refresh/runtime';

if (!window.$RefreshRuntime$) {
	RefreshRuntime.injectIntoGlobalHook(window);
	window.$RefreshRuntime$ = RefreshRuntime;
	window.$RefreshReg$ = (type: unknown, id: string) =>
		RefreshRuntime.register(type, id);
	window.$RefreshSig$ = () =>
		RefreshRuntime.createSignatureFunctionForTransform();
}
