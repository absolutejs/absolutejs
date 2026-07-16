window.__HMR_FRAMEWORK__ = "vue";
import "/Users/graves-homebase/Local Documents/absolute-js/absolutejs/src/dev/client/hmrClient.ts";
import Comp from "../client/pages/VueExample.js";
import { createSSRApp, createApp } from "vue";

// HMR State Preservation: Check for preserved state from HMR
let preservedState = (typeof window !== "undefined" && window.__HMR_PRESERVED_STATE__) ? window.__HMR_PRESERVED_STATE__ : {};

// Fallback: check sessionStorage if window state is empty (only during active HMR, not full page refresh)
if (typeof window !== "undefined" && Object.keys(preservedState).length === 0 && sessionStorage.getItem("__HMR_ACTIVE__")) {
  try {
    const stored = sessionStorage.getItem("__VUE_HMR_STATE__");
    if (stored) {
      preservedState = JSON.parse(stored);
      sessionStorage.removeItem("__VUE_HMR_STATE__");
    }
  } catch (e) {}
}
// Clean up stale HMR state on full page refresh
if (typeof window !== "undefined" && !sessionStorage.getItem("__HMR_ACTIVE__")) {
  sessionStorage.removeItem("__VUE_HMR_STATE__");
}

const initialProps = window.__INITIAL_PROPS__ ?? {};
// Only merge preserved state keys that match declared props (avoids passing refs/components as attributes)
const mergedProps = { ...initialProps };
Object.keys(preservedState).forEach(function(key) {
  if (key in initialProps) {
    mergedProps[key] = preservedState[key];
  }
});

// During HMR, use createApp (fresh mount) to avoid hydration mismatch with stale DOM
const isHMR = typeof window !== "undefined" && sessionStorage.getItem("__HMR_ACTIVE__");
const app = isHMR ? createApp(Comp, mergedProps) : createSSRApp(Comp, mergedProps);
app.mount("#root");

// Store app instance for HMR - used for manual component updates
if (typeof window !== "undefined") {
  window.__VUE_APP__ = app;
}

// Post-mount: Apply preserved state to reactive refs in component tree
// This restores state that lives in refs (like count) rather than props
if (typeof window !== "undefined" && Object.keys(preservedState).length > 0) {
  requestAnimationFrame(function() {
    if (window.__VUE_APP__ && window.__VUE_APP__._instance) {
      applyPreservedState(window.__VUE_APP__._instance, preservedState);
    }
  });
}

function applyPreservedState(instance, state) {
  // Apply to root component setupState
  if (instance.setupState) {
    Object.keys(state).forEach(function(key) {
      const ref = instance.setupState[key];
      if (ref && typeof ref === "object" && "value" in ref) {
        ref.value = state[key];
      }
    });
  }
  // Also apply to child components
  if (instance.subTree) {
    walkAndApply(instance.subTree, state);
  }
}

function walkAndApply(vnode, state) {
  if (!vnode) return;
  if (vnode.component && vnode.component.setupState) {
    Object.keys(state).forEach(function(key) {
      const ref = vnode.component.setupState[key];
      if (ref && typeof ref === "object" && "value" in ref) {
        ref.value = state[key];
      }
    });
  }
  if (vnode.children && Array.isArray(vnode.children)) {
    vnode.children.forEach(function(child) { walkAndApply(child, state); });
  }
  if (vnode.component && vnode.component.subTree) {
    walkAndApply(vnode.component.subTree, state);
  }
}

// Clear preserved state after applying
if (typeof window !== "undefined") {
  window.__HMR_PRESERVED_STATE__ = undefined;
}