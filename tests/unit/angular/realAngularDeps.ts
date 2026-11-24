import '@angular/compiler';
import { APP_BASE_HREF, NgComponentOutlet } from '@angular/common';
import * as core from '@angular/core';
import * as platformBrowser from '@angular/platform-browser';
import * as platformServer from '@angular/platform-server';
import type { AngularDeps } from '../../../types/angular';

/* The real Angular, wired the way `getAngularDeps` wires it, for tests
 * that render in-process. Built from direct imports rather than through
 * `getAngularDeps` because that calls `enableProdMode`, which throws
 * once any other test in the shared run has created a platform. */
export const realAngularDeps: AngularDeps = {
	APP_BASE_HREF,
	BEFORE_APP_SERIALIZED: platformServer.BEFORE_APP_SERIALIZED,
	bootstrapApplication: platformBrowser.bootstrapApplication,
	Component: core.Component,
	CSP_NONCE: core.CSP_NONCE,
	DomSanitizer: platformBrowser.DomSanitizer,
	ENVIRONMENT_INITIALIZER: core.ENVIRONMENT_INITIALIZER,
	inject: core.inject,
	InjectionToken: core.InjectionToken,
	NgComponentOutlet,
	PlatformState: platformServer.PlatformState,
	provideClientHydration: platformBrowser.provideClientHydration,
	provideServerRendering: platformServer.provideServerRendering,
	provideZoneChangeDetection: core.provideZoneChangeDetection,
	provideZonelessChangeDetection: core.provideZonelessChangeDetection,
	reflectComponentType: core.reflectComponentType,
	renderApplication: platformServer.renderApplication,
	REQUEST: core.REQUEST,
	REQUEST_CONTEXT: core.REQUEST_CONTEXT,
	RESPONSE_INIT: core.RESPONSE_INIT,
	Sanitizer: core.Sanitizer,
	SecurityContext: core.SecurityContext,
	withEventReplay: platformBrowser.withEventReplay,
	withHttpTransferCacheOptions: platformBrowser.withHttpTransferCacheOptions
};
