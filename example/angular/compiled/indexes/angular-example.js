window.__HMR_FRAMEWORK__ = "angular";
import "/Users/graves-homebase/Local Documents/absolute-js/absolutejs/src/dev/client/handlers/angularRuntime.ts";
import "/Users/graves-homebase/Local Documents/absolute-js/absolutejs/src/dev/client/hmrClient.ts";

import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideClientHydration } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import AngularExampleComponent from '../pages/angular-example.js';

// Re-Bootstrap HMR with View Transitions API
if (window.__ANGULAR_APP__) {
    try { window.__ANGULAR_APP__.destroy(); } catch (_err) { /* ignore */ }
    window.__ANGULAR_APP__ = null;
}

var providers = [provideZonelessChangeDetection()];
if (!window.__HMR_SKIP_HYDRATION__) {
    providers.push(provideClientHydration());
}
delete window.__HMR_SKIP_HYDRATION__;

bootstrapApplication(AngularExampleComponent, {
    providers: providers
}).then(function (appRef) {
    window.__ANGULAR_APP__ = appRef;
});