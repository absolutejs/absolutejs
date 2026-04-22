// src/dev/client/reactRefreshSetup.ts
import RefreshRuntime from "/react/vendor/react-refresh_runtime.js";
if (!window.$RefreshRuntime$) {
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshRuntime$ = RefreshRuntime;
  window.$RefreshReg$ = (type, id) => RefreshRuntime.register(type, id);
  window.$RefreshSig$ = () => RefreshRuntime.createSignatureFunctionForTransform();
  const buffer = window.__REFRESH_BUFFER__;
  if (buffer) {
    for (const [type, id] of buffer) {
      RefreshRuntime.register(type, id);
    }
    window.__REFRESH_BUFFER__ = undefined;
  }
}
