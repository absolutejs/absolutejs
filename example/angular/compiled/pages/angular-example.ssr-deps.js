// HMR SSR: re-export Angular deps for identity-safe SSR rendering.
// Separate file to avoid bundling require() calls into client code.
export const __angularCore = require("@angular/core");
export const __angularPlatformServer = require("@angular/platform-server");
export const __angularPlatformBrowser = require("@angular/platform-browser");
export const __angularCommon = require("@angular/common");
