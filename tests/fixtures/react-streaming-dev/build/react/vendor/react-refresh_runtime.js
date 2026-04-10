import {
  __commonJS,
  __toESM
} from "./chunk-2kh60w9b.js";

// node_modules/react-refresh/cjs/react-refresh-runtime.development.js
var require_react_refresh_runtime_development = __commonJS((exports) => {
  (function() {
    function computeFullKey(signature) {
      if (signature.fullKey !== null)
        return signature.fullKey;
      var fullKey = signature.ownKey;
      try {
        var hooks = signature.getCustomHooks();
      } catch (err) {
        return signature.forceReset = true, signature.fullKey = fullKey;
      }
      for (var i = 0;i < hooks.length; i++) {
        var hook = hooks[i];
        if (typeof hook !== "function")
          return signature.forceReset = true, signature.fullKey = fullKey;
        hook = allSignaturesByType.get(hook);
        if (hook !== undefined) {
          var nestedHookKey = computeFullKey(hook);
          hook.forceReset && (signature.forceReset = true);
          fullKey += `
---
` + nestedHookKey;
        }
      }
      return signature.fullKey = fullKey;
    }
    function resolveFamily(type) {
      return updatedFamiliesByType.get(type);
    }
    function cloneMap(map) {
      var clone = new Map;
      map.forEach(function(value, key) {
        clone.set(key, value);
      });
      return clone;
    }
    function cloneSet(set) {
      var clone = new Set;
      set.forEach(function(value) {
        clone.add(value);
      });
      return clone;
    }
    function getProperty(object, property) {
      try {
        return object[property];
      } catch (err) {}
    }
    function register(type, id) {
      if (!(type === null || typeof type !== "function" && typeof type !== "object" || allFamiliesByType.has(type))) {
        var family = allFamiliesByID.get(id);
        family === undefined ? (family = { current: type }, allFamiliesByID.set(id, family)) : pendingUpdates.push([family, type]);
        allFamiliesByType.set(type, family);
        if (typeof type === "object" && type !== null)
          switch (getProperty(type, "$$typeof")) {
            case REACT_FORWARD_REF_TYPE:
              register(type.render, id + "$render");
              break;
            case REACT_MEMO_TYPE:
              register(type.type, id + "$type");
          }
      }
    }
    function setSignature(type, key) {
      var forceReset = 2 < arguments.length && arguments[2] !== undefined ? arguments[2] : false, getCustomHooks = 3 < arguments.length ? arguments[3] : undefined;
      allSignaturesByType.has(type) || allSignaturesByType.set(type, {
        forceReset,
        ownKey: key,
        fullKey: null,
        getCustomHooks: getCustomHooks || function() {
          return [];
        }
      });
      if (typeof type === "object" && type !== null)
        switch (getProperty(type, "$$typeof")) {
          case REACT_FORWARD_REF_TYPE:
            setSignature(type.render, key, forceReset, getCustomHooks);
            break;
          case REACT_MEMO_TYPE:
            setSignature(type.type, key, forceReset, getCustomHooks);
        }
    }
    function collectCustomHooksForSignature(type) {
      type = allSignaturesByType.get(type);
      type !== undefined && computeFullKey(type);
    }
    var REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"), REACT_MEMO_TYPE = Symbol.for("react.memo"), PossiblyWeakMap = typeof WeakMap === "function" ? WeakMap : Map, allFamiliesByID = new Map, allFamiliesByType = new PossiblyWeakMap, allSignaturesByType = new PossiblyWeakMap, updatedFamiliesByType = new PossiblyWeakMap, pendingUpdates = [], helpersByRendererID = new Map, helpersByRoot = new Map, mountedRoots = new Set, failedRoots = new Set, rootElements = typeof WeakMap === "function" ? new WeakMap : null, isPerformingRefresh = false;
    exports._getMountedRootCount = function() {
      return mountedRoots.size;
    };
    exports.collectCustomHooksForSignature = collectCustomHooksForSignature;
    exports.createSignatureFunctionForTransform = function() {
      var savedType, hasCustomHooks, didCollectHooks = false;
      return function(type, key, forceReset, getCustomHooks) {
        if (typeof key === "string")
          return savedType || (savedType = type, hasCustomHooks = typeof getCustomHooks === "function"), type == null || typeof type !== "function" && typeof type !== "object" || setSignature(type, key, forceReset, getCustomHooks), type;
        !didCollectHooks && hasCustomHooks && (didCollectHooks = true, collectCustomHooksForSignature(savedType));
      };
    };
    exports.getFamilyByID = function(id) {
      return allFamiliesByID.get(id);
    };
    exports.getFamilyByType = function(type) {
      return allFamiliesByType.get(type);
    };
    exports.hasUnrecoverableErrors = function() {
      return false;
    };
    exports.injectIntoGlobalHook = function(globalObject) {
      var hook = globalObject.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook === undefined) {
        var nextID = 0;
        globalObject.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook = {
          renderers: new Map,
          supportsFiber: true,
          inject: function() {
            return nextID++;
          },
          onScheduleFiberRoot: function() {},
          onCommitFiberRoot: function() {},
          onCommitFiberUnmount: function() {}
        };
      }
      if (hook.isDisabled)
        console.warn("Something has shimmed the React DevTools global hook (__REACT_DEVTOOLS_GLOBAL_HOOK__). Fast Refresh is not compatible with this shim and will be disabled.");
      else {
        var oldInject = hook.inject;
        hook.inject = function(injected) {
          var id = oldInject.apply(this, arguments);
          typeof injected.scheduleRefresh === "function" && typeof injected.setRefreshHandler === "function" && helpersByRendererID.set(id, injected);
          return id;
        };
        hook.renderers.forEach(function(injected, id) {
          typeof injected.scheduleRefresh === "function" && typeof injected.setRefreshHandler === "function" && helpersByRendererID.set(id, injected);
        });
        var oldOnCommitFiberRoot = hook.onCommitFiberRoot, oldOnScheduleFiberRoot = hook.onScheduleFiberRoot || function() {};
        hook.onScheduleFiberRoot = function(id, root, children) {
          isPerformingRefresh || (failedRoots.delete(root), rootElements !== null && rootElements.set(root, children));
          return oldOnScheduleFiberRoot.apply(this, arguments);
        };
        hook.onCommitFiberRoot = function(id, root, maybePriorityLevel, didError) {
          var helpers = helpersByRendererID.get(id);
          if (helpers !== undefined) {
            helpersByRoot.set(root, helpers);
            helpers = root.current;
            var alternate = helpers.alternate;
            alternate !== null ? (alternate = alternate.memoizedState != null && alternate.memoizedState.element != null && mountedRoots.has(root), helpers = helpers.memoizedState != null && helpers.memoizedState.element != null, !alternate && helpers ? (mountedRoots.add(root), failedRoots.delete(root)) : alternate && helpers || (alternate && !helpers ? (mountedRoots.delete(root), didError ? failedRoots.add(root) : helpersByRoot.delete(root)) : alternate || helpers || didError && failedRoots.add(root))) : mountedRoots.add(root);
          }
          return oldOnCommitFiberRoot.apply(this, arguments);
        };
      }
    };
    exports.isLikelyComponentType = function(type) {
      switch (typeof type) {
        case "function":
          if (type.prototype != null) {
            if (type.prototype.isReactComponent)
              return true;
            var ownNames = Object.getOwnPropertyNames(type.prototype);
            if (1 < ownNames.length || ownNames[0] !== "constructor" || type.prototype.__proto__ !== Object.prototype)
              return false;
          }
          type = type.name || type.displayName;
          return typeof type === "string" && /^[A-Z]/.test(type);
        case "object":
          if (type != null)
            switch (getProperty(type, "$$typeof")) {
              case REACT_FORWARD_REF_TYPE:
              case REACT_MEMO_TYPE:
                return true;
            }
          return false;
        default:
          return false;
      }
    };
    exports.performReactRefresh = function() {
      if (pendingUpdates.length === 0 || isPerformingRefresh)
        return null;
      isPerformingRefresh = true;
      try {
        var staleFamilies = new Set, updatedFamilies = new Set, updates = pendingUpdates;
        pendingUpdates = [];
        updates.forEach(function(_ref) {
          var family = _ref[0];
          _ref = _ref[1];
          var prevType = family.current;
          updatedFamiliesByType.set(prevType, family);
          updatedFamiliesByType.set(_ref, family);
          family.current = _ref;
          prevType.prototype && prevType.prototype.isReactComponent || _ref.prototype && _ref.prototype.isReactComponent ? _ref = false : (prevType = allSignaturesByType.get(prevType), _ref = allSignaturesByType.get(_ref), _ref = prevType === undefined && _ref === undefined || prevType !== undefined && _ref !== undefined && computeFullKey(prevType) === computeFullKey(_ref) && !_ref.forceReset ? true : false);
          _ref ? updatedFamilies.add(family) : staleFamilies.add(family);
        });
        var update = {
          updatedFamilies,
          staleFamilies
        };
        helpersByRendererID.forEach(function(helpers) {
          helpers.setRefreshHandler(resolveFamily);
        });
        var didError = false, firstError = null, failedRootsSnapshot = cloneSet(failedRoots), mountedRootsSnapshot = cloneSet(mountedRoots), helpersByRootSnapshot = cloneMap(helpersByRoot);
        failedRootsSnapshot.forEach(function(root) {
          var helpers = helpersByRootSnapshot.get(root);
          if (helpers === undefined)
            throw Error("Could not find helpers for a root. This is a bug in React Refresh.");
          failedRoots.has(root);
          if (rootElements !== null && rootElements.has(root)) {
            var element = rootElements.get(root);
            try {
              helpers.scheduleRoot(root, element);
            } catch (err) {
              didError || (didError = true, firstError = err);
            }
          }
        });
        mountedRootsSnapshot.forEach(function(root) {
          var helpers = helpersByRootSnapshot.get(root);
          if (helpers === undefined)
            throw Error("Could not find helpers for a root. This is a bug in React Refresh.");
          mountedRoots.has(root);
          try {
            helpers.scheduleRefresh(root, update);
          } catch (err) {
            didError || (didError = true, firstError = err);
          }
        });
        if (didError)
          throw firstError;
        return update;
      } finally {
        isPerformingRefresh = false;
      }
    };
    exports.register = register;
    exports.setSignature = setSignature;
  })();
});

// node_modules/react-refresh/runtime.js
var require_runtime = __commonJS((exports, module) => {
  var react_refresh_runtime_development = __toESM(require_react_refresh_runtime_development());
  if (false) {} else {
    module.exports = react_refresh_runtime_development;
  }
});

// tests/fixtures/react-streaming-dev/build/_vendor_tmp/react-refresh_runtime.ts
var import_runtime = __toESM(require_runtime(), 1);
var import_runtime2 = __toESM(require_runtime(), 1);
var export_setSignature = import_runtime.setSignature;
var export_register = import_runtime.register;
var export_performReactRefresh = import_runtime.performReactRefresh;
var export_isLikelyComponentType = import_runtime.isLikelyComponentType;
var export_injectIntoGlobalHook = import_runtime.injectIntoGlobalHook;
var export_hasUnrecoverableErrors = import_runtime.hasUnrecoverableErrors;
var export_getFamilyByType = import_runtime.getFamilyByType;
var export_getFamilyByID = import_runtime.getFamilyByID;
var export_default = import_runtime2.default;
var export_createSignatureFunctionForTransform = import_runtime.createSignatureFunctionForTransform;
var export_collectCustomHooksForSignature = import_runtime.collectCustomHooksForSignature;
var export__getMountedRootCount = import_runtime._getMountedRootCount;

export {
  export_setSignature as setSignature,
  export_register as register,
  export_performReactRefresh as performReactRefresh,
  export_isLikelyComponentType as isLikelyComponentType,
  export_injectIntoGlobalHook as injectIntoGlobalHook,
  export_hasUnrecoverableErrors as hasUnrecoverableErrors,
  export_getFamilyByType as getFamilyByType,
  export_getFamilyByID as getFamilyByID,
  export_default as default,
  export_createSignatureFunctionForTransform as createSignatureFunctionForTransform,
  export_collectCustomHooksForSignature as collectCustomHooksForSignature,
  export__getMountedRootCount as _getMountedRootCount
};
