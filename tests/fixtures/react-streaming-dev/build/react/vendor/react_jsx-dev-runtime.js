import {
  require_jsx_runtime
} from "./chunk-9g12fvrw.js";
import"./chunk-rejbymp5.js";
import {
  __toESM
} from "./chunk-2kh60w9b.js";

// dist/react/jsxDevRuntimeCompat.js
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var jsxDEV = (type, props, key, _isStaticChildren, _source, _self) => Array.isArray(props?.children) ? import_jsx_runtime.jsxs(type, props, key) : import_jsx_runtime.jsx(type, props, key);
var export_Fragment = import_jsx_runtime.Fragment;

export {
  jsxDEV,
  export_Fragment as Fragment
};
