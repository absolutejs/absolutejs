/* Angular HMR — Re-Bootstrap with View Transitions API (Zero Flicker)
   DEV MODE ONLY — never active in production.

   Strategy:
   1. Capture component/service state via `preserveAcrossHmr` opt-ins
   2. Use document.startViewTransition() — browser captures a screenshot
   3. Destroy old app, recreate root element, import new module
   4. bootstrapApplication() renders new content (behind the screenshot)
   5. New instances restore from cache via `preserveAcrossHmr` in their
      constructors / ngOnInit (gated on rebootInProgress flag)
   6. Wait for `applicationRef.whenStable()` so lazy-route components
      have a chance to construct, then close the restoration window
   7. View transition resolves — browser smoothly crossfades to new
      content

   document.startViewTransition() is the native browser API for page
   transitions. It captures a screenshot before the callback, runs
   the callback (which can be async), and crossfades when the callback
   finishes. The user never sees empty/default state — only the
   before and after. */

import {
	captureTrackedInstanceStates,
	endHmrReboot
} from '../../../angular/hmrPreserveCore';
import { ANGULAR_INIT_TIMEOUT_MS } from '../constants';
import {
	saveFormState,
	restoreFormState,
	saveScrollState,
	restoreScrollState
} from '../domState';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';
import { showHmrToast } from '../hmrToast';

type AngularUpdateType =
	| 'template'
	| 'style-component'
	| 'class-component'
	| 'service-method-only'
	| 'service-with-side-effects'
	| 'route'
	| 'reboot'
	// Legacy types kept for back-compat with global CSS edits and pre-2.1
	// builds. Treated as fast-path triggers (style → swap stylesheet,
	// logic → fast-patch + reboot fallback).
	| 'style'
	| 'css-only'
	| 'logic'
	| 'full';

type HMRMessage = {
	data: {
		cssBaseName?: string;
		cssUrl?: string;
		editSourceFile?: string;
		html?: string;
		manifest?: Record<string, string>;
		pageModuleUrl?: string;
		reason?: string;
		serverDuration?: number;
		sourceFile?: string;
		updateType?: AngularUpdateType;
	};
};

type AngularHmrApi = {
	applyUpdate: (id: string, newCtor: unknown) => boolean;
	applyStyleUpdate?: (id: string, newCtor: unknown) => boolean;
	applyTemplateUpdate?: (id: string, newCtor: unknown) => boolean;
	applyServiceUpdate?: (id: string, newCtor: unknown) => boolean;
	beginStyleUpdateBatch?: () => void;
	endStyleUpdateBatch?: () => Array<{ id: string; ok: boolean }>;
	beginTemplateUpdateBatch?: () => void;
	endTemplateUpdateBatch?: () => Array<{ id: string; ok: boolean }>;
	beginServiceUpdateBatch?: () => void;
	endServiceUpdateBatch?: () => Array<{ id: string; ok: boolean }>;
	getRegistry?: () => Map<string, unknown>;
	refresh: () => void;
	hasPageExportsChanged?: (sourceId: string) => boolean;
};

type ViewTransitionDocument = Document & {
	startViewTransition?: (updateCallback: () => Promise<void>) => {
		finished: Promise<void>;
	};
};

type AngularComponentExport = ((...args: unknown[]) => unknown) & {
	ɵcmp?: unknown;
};

const isAngularComponentExport = (
	value: unknown
): value is AngularComponentExport => {
	if (typeof value !== 'function') {
		return false;
	}

	return 'ɵcmp' in value && Boolean(value.ɵcmp);
};

const swapStylesheet = (
	cssUrl: string,
	cssBaseName: string,
	framework: string
) => {
	let existingLink: HTMLLinkElement | null = null;
	document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
		const linkEl = link instanceof HTMLLinkElement ? link : null;
		const href = linkEl?.getAttribute('href') ?? '';
		if (href.includes(cssBaseName) || href.includes(framework)) {
			existingLink = linkEl;
		}
	});
	if (!existingLink) return;

	const capturedExisting: HTMLLinkElement = existingLink;
	const newLink = document.createElement('link');
	newLink.rel = 'stylesheet';
	newLink.href = `${cssUrl}?t=${Date.now()}`;
	newLink.onload = function () {
		if (capturedExisting && capturedExisting.parentNode)
			capturedExisting.remove();
	};
	document.head.appendChild(newLink);
};

// ─── Wait for Angular bootstrap (event-based, no polling) ───
// Installs a property setter trap on window.__ANGULAR_APP__ that
// resolves the promise the instant the bootstrap code writes to it.
// Falls back to a short timeout in case the setter is bypassed.

const waitForAngularApp = () => {
	if (window.__ANGULAR_APP__) return Promise.resolve();

	const { promise, resolve } = Promise.withResolvers<void>();
	const timeout = setTimeout(resolve, ANGULAR_INIT_TIMEOUT_MS);

	let stored = window.__ANGULAR_APP__;

	Object.defineProperty(window, '__ANGULAR_APP__', {
		configurable: true,
		enumerable: true,
		get() {
			return stored;
		},
		set(val) {
			stored = val;
			Object.defineProperty(window, '__ANGULAR_APP__', {
				configurable: true,
				enumerable: true,
				value: val,
				writable: true
			});
			clearTimeout(timeout);
			resolve();
		}
	});

	return promise;
};

// ============================================================
// FAST UPDATE — Runtime patching without destroy/re-bootstrap
// ============================================================

const suppressNg0912 = () => {
	const origWarn = console.warn;
	console.warn = function (...args: unknown[]) {
		if (typeof args[0] === 'string' && args[0].includes('NG0912')) return;
		origWarn.apply(console, args);
	};

	return origWarn;
};

const tryPatchExport = (
	exportName: string,
	newModule: Record<string, unknown>,
	registry: Map<string, unknown>,
	hmr: AngularHmrApi,
	sourceFile: string
) => {
	const exported = newModule[exportName];
	if (!isAngularComponentExport(exported)) return 'skip';

	const registryId = `${sourceFile}#${exportName}`;
	if (!registry.has(registryId)) return 'skip';

	const success = hmr.applyUpdate(registryId, exported);
	if (!success) return 'fail';

	return 'patched';
};

const patchRegisteredComponents = (
	newModule: Record<string, unknown>,
	registry: Map<string, unknown>,
	hmr: AngularHmrApi,
	sourceFile: string
) => {
	let patchedAny = false;
	const allPatched = Object.keys(newModule).every((exportName) => {
		const result = tryPatchExport(
			exportName,
			newModule,
			registry,
			hmr,
			sourceFile
		);
		if (result === 'skip') {
			return true;
		}
		if (result === 'fail') {
			return false;
		}
		patchedAny = true;

		return true;
	});

	return { allPatched, patchedAny };
};

type FastPatchWindow = Window & {
	__ANGULAR_HMR_FAST_PATCH__?: boolean;
};

const attemptFastPatch = async (
	indexPath: string,
	registry: Map<string, unknown>,
	hmr: AngularHmrApi,
	sourceFile: string,
	origWarn: typeof console.warn
) => {
	// The bundled page chunk's top-level code re-bootstraps the Angular app
	// (destroy + bootstrapApplication). For fast-patch we just need to read
	// the freshly-built component classes — not re-bootstrap. Setting this
	// flag tells the chunk to skip its bootstrap section and only run the
	// `export * from '<page-module>'` line. Paired with the guard added in
	// `src/build/compileAngular.ts` HMR template.
	const w = window as FastPatchWindow;
	w.__ANGULAR_HMR_FAST_PATCH__ = true;
	try {
		const newModule = await import(`${indexPath}?t=${Date.now()}`);

		// Page-level `routes` / `providers` changed? Those values are read
		// once during `bootstrapApplication`; an in-place component patch
		// won't re-wire the running router or root injector. The chunk
		// records its current fingerprint each time it evaluates (initial
		// bootstrap + every fast-patch import), so a change between the
		// previous and current evaluation means we need to fall back to a
		// full re-bootstrap.
		if (hmr.hasPageExportsChanged?.(sourceFile)) {
			console.warn = origWarn;

			return false;
		}

		// NG0912 warnings fire during `applyUpdate` (Angular re-registers
		// the new component class while the old one is still live). Keep
		// the suppression active through the patch, restore right before
		// `refresh()` so any non-NG0912 warnings during `tick()` surface.
		const { allPatched, patchedAny } = patchRegisteredComponents(
			newModule,
			registry,
			hmr,
			sourceFile
		);

		console.warn = origWarn;

		if (!patchedAny) return false;
		if (!allPatched) return false;

		hmr.refresh();

		return true;
	} catch (err) {
		console.warn = origWarn;
		console.warn('[HMR] Angular fast update failed, falling back:', err);

		return false;
	} finally {
		delete w.__ANGULAR_HMR_FAST_PATCH__;
	}
};

/* Fast update — patch live component prototypes without destroying the app.
   Returns true when at least one registered component was successfully
   patched (and no patch failed); false means we couldn't fast-patch and
   the caller should fall back to a full re-bootstrap.
   Failures we explicitly fall back on:
     - file's source isn't tracked in the component registry yet
     - changed file has no Angular components (e.g. a service or routes file)
     - any component's `applyUpdate` returned false (provider change, etc.)
     - dynamic import failed */
const handleFastUpdate = async (message: HMRMessage) => {
	const hmr = window.__ANGULAR_HMR__;
	if (!hmr || !hmr.getRegistry) return false;

	const registry = hmr.getRegistry();
	if (registry.size === 0) return false;

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'angular'
	);
	if (!indexPath) return false;

	const origWarn = suppressNg0912();

	const patched = await attemptFastPatch(
		indexPath,
		registry,
		hmr,
		message.data.sourceFile || '',
		origWarn
	);

	if (patched && message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'angular'
		);
	}

	return patched;
};

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/* HMR updates are serialized through a single in-flight slot. While one
   update is running (fast or full), additional incoming updates collapse
   into one pending slot — only the latest matters because each rebuild
   produces a chunk that supersedes prior ones for the same source file.
   Without this, two rapid edits could:
     - run two `startViewTransition`s and have the browser abort the first
       mid-callback (the original "Transition was skipped" symptom), or
     - run two `attemptFastPatch`s that both call `applyUpdate` on the same
       registry entries, racing on prototype swaps. */
let activeMessage: Promise<void> | null = null;
let pendingMessage: HMRMessage | null = null;

/* Stub handlers for fast paths that aren't implemented yet. Each one
 * returns false to signal "couldn't handle, fall through to reboot",
 * letting Phase 2 ship piecewise — we land §2.1 (this dispatch table)
 * first, then §2.4 / §2.3 / §2.2 fill in the stubs one at a time
 * without further plumbing changes. */
/* Template HMR — re-imports the rebuilt page chunk under FAST_PATCH +
 * TEMPLATE_UPDATE_MODE, then asks the runtime to swap the template
 * subgraph of `ɵcmp` (template factory, slot counts, queries,
 * dependencies, host bindings) on every re-registered component.
 *
 * Live instances keep their state, services, queries, and DI tokens —
 * only the rendered output changes. After all components are patched,
 * a single `refresh()` call walks the subtree, marks each patched
 * component dirty, and ticks the app to repaint.
 *
 * Returns false on any partial failure so the orchestrator falls
 * through to a coherent reboot. */
type TemplateUpdateWindow = FastPatchWindow & {
	__ANGULAR_HMR_TEMPLATE_UPDATE_MODE__?: boolean;
};

const handleTemplateUpdate = async (message: HMRMessage): Promise<boolean> => {
	const hmr = window.__ANGULAR_HMR__;
	if (
		!hmr ||
		!hmr.applyTemplateUpdate ||
		!hmr.beginTemplateUpdateBatch ||
		!hmr.endTemplateUpdateBatch
	) {
		return false;
	}

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'angular'
	);
	if (!indexPath) return false;

	const w = window as TemplateUpdateWindow;
	w.__ANGULAR_HMR_FAST_PATCH__ = true;
	w.__ANGULAR_HMR_TEMPLATE_UPDATE_MODE__ = true;
	hmr.beginTemplateUpdateBatch();

	const origWarn = suppressNg0912();
	try {
		await import(`${indexPath}?t=${Date.now()}`);

		// Page-level routes/providers cannot ride a template update.
		if (hmr.hasPageExportsChanged?.(message.data.sourceFile || '')) {
			return false;
		}

		const results = hmr.endTemplateUpdateBatch();
		// Empty batch = the chunk's components weren't already in the
		// registry (off-page broadcast). No-op success — see the
		// matching comment in `handleComponentStyleUpdate`.
		if (results.length === 0) {
			console.warn = origWarn;
			return true;
		}
		if (!results.every((r) => r.ok)) return false;

		console.warn = origWarn;
		hmr.refresh();

		return true;
	} catch (err) {
		console.warn = origWarn;
		console.warn(
			'[HMR] Angular template update failed, falling back:',
			err
		);
		return false;
	} finally {
		delete w.__ANGULAR_HMR_FAST_PATCH__;
		delete w.__ANGULAR_HMR_TEMPLATE_UPDATE_MODE__;
		console.warn = origWarn;
	}
};

/* Component-style HMR — re-imports the rebuilt page chunk under the
 * combined `FAST_PATCH` and `STYLE_UPDATE_MODE` flags so:
 *   - the chunk's bootstrap section is skipped (FAST_PATCH)
 *   - every per-file auto-registration block routes its new ctor
 *     through `applyStyleUpdate` instead of a no-op (STYLE_UPDATE_MODE)
 *
 * The registration-block path is the only way to reach CHILD
 * components — the page chunk's `export *` only re-exports the page's
 * own module, so a top-level export walk would miss imported
 * components like `LayoutComponent`. Each compiled .ts file emits a
 * registration block for its own component classes, so the chunk
 * covers the whole tree on re-evaluation.
 *
 * Returns true iff every component the chunk re-registered swapped
 * its styles cleanly. Any failure (Shadow DOM, length change, missing
 * live <style> tag) → reboot. The transactional check inside
 * `applyStyleUpdate` means we never apply a partial update — either
 * the page restyles coherently or we reboot. */
type StyleUpdateWindow = FastPatchWindow & {
	__ANGULAR_HMR_STYLE_UPDATE_MODE__?: boolean;
};

const handleComponentStyleUpdate = async (
	message: HMRMessage
): Promise<boolean> => {
	const hmr = window.__ANGULAR_HMR__;
	if (
		!hmr ||
		!hmr.applyStyleUpdate ||
		!hmr.beginStyleUpdateBatch ||
		!hmr.endStyleUpdateBatch
	) {
		return false;
	}

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'angular'
	);
	if (!indexPath) return false;

	const w = window as StyleUpdateWindow;
	w.__ANGULAR_HMR_FAST_PATCH__ = true;
	w.__ANGULAR_HMR_STYLE_UPDATE_MODE__ = true;
	hmr.beginStyleUpdateBatch();

	try {
		await import(`${indexPath}?t=${Date.now()}`);

		// Page-level routes/providers cannot ride a style update — they
		// are read once during bootstrap. If they changed in this
		// rebuild, reboot rather than risk a stale router/injector.
		if (hmr.hasPageExportsChanged?.(message.data.sourceFile || '')) {
			return false;
		}

		const results = hmr.endStyleUpdateBatch();
		// Empty batch is a no-op success: the chunk re-evaluated but
		// none of its components were already in the registry, so they
		// couldn't be live on the page right now. Common when a CSS
		// edit affects multiple page bundles (the server broadcasts
		// once per page) and the user is only looking at one of them —
		// the off-page broadcasts add fresh entries to the registry but
		// produce no batch updates. Treating that as a failure forced
		// fallthrough to reboot for every off-page broadcast, which
		// fired `startViewTransition` repeatedly and produced the
		// "Transition was skipped" abort when the second reboot
		// superseded the first mid-flight.
		if (results.length === 0) return true;
		return results.every((r) => r.ok);
	} catch (err) {
		console.warn('[HMR] Angular style update failed, falling back:', err);
		return false;
	} finally {
		delete w.__ANGULAR_HMR_FAST_PATCH__;
		delete w.__ANGULAR_HMR_STYLE_UPDATE_MODE__;
	}
};

/* Service HMR — re-imports the rebuilt page chunk under FAST_PATCH +
 * SERVICE_UPDATE_MODE so the page's auto-registration block routes
 * each new service ctor through `applyServiceUpdate`. The runtime
 * does prototype method-swap (always) and best-effort field merge on
 * the live singleton (when reachable via the root injector and
 * donor-instantiable). Live components keep their references — they
 * just call into the new method bodies on next invocation.
 *
 * This path only runs when the server-side classifier returned
 * `service-method-only` — services with side-effecting constructors
 * never get here, so the live singleton's existing subscriptions /
 * timers / listeners stay intact and we don't double-register them. */
type ServiceUpdateWindow = FastPatchWindow & {
	__ANGULAR_HMR_SERVICE_UPDATE_MODE__?: boolean;
};

const handleServiceMethodSwap = async (
	message: HMRMessage
): Promise<boolean> => {
	const hmr = window.__ANGULAR_HMR__;
	if (
		!hmr ||
		!hmr.applyServiceUpdate ||
		!hmr.beginServiceUpdateBatch ||
		!hmr.endServiceUpdateBatch
	) {
		return false;
	}

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'angular'
	);
	if (!indexPath) return false;

	const w = window as ServiceUpdateWindow;
	w.__ANGULAR_HMR_FAST_PATCH__ = true;
	w.__ANGULAR_HMR_SERVICE_UPDATE_MODE__ = true;
	hmr.beginServiceUpdateBatch();

	try {
		await import(`${indexPath}?t=${Date.now()}`);

		// Page-level routes/providers cannot ride a service update.
		if (hmr.hasPageExportsChanged?.(message.data.sourceFile || '')) {
			return false;
		}

		const results = hmr.endServiceUpdateBatch();
		// Empty batch = off-page broadcast, see comment in
		// `handleComponentStyleUpdate`.
		if (results.length === 0) return true;
		if (!results.every((r) => r.ok)) return false;

		// New method bodies might compute new values for observable-fed
		// fields, so the existing component subtree should re-render.
		// `refresh()` ticks the app + marks any pending fast-patch
		// components dirty.
		hmr.refresh();

		return true;
	} catch (err) {
		console.warn('[HMR] Angular service update failed, falling back:', err);
		return false;
	} finally {
		delete w.__ANGULAR_HMR_FAST_PATCH__;
		delete w.__ANGULAR_HMR_SERVICE_UPDATE_MODE__;
	}
};

const logRebootReason = (message: HMRMessage) => {
	const reason = message.data.reason;
	const updateType = message.data.updateType;
	if (!reason && !updateType) return;
	console.info(
		`[HMR] Angular reboot — ${updateType ?? 'unknown'}: ${reason ?? '(no reason given)'}`
	);
	// Surface the same info as a brief on-page toast so the developer
	// sees it without opening devtools. Toasts auto-dismiss after a
	// few seconds.
	showHmrToast({
		editSourceFile: message.data.editSourceFile,
		reason,
		updateType
	});
};

const processMessage = async (message: HMRMessage) => {
	const updateType = message.data.updateType ?? 'logic';

	switch (updateType) {
		case 'template': {
			const ok = await handleTemplateUpdate(message);
			if (ok) return;
			break;
		}
		case 'style-component': {
			const ok = await handleComponentStyleUpdate(message);
			if (ok) return;
			break;
		}
		case 'service-method-only': {
			const ok = await handleServiceMethodSwap(message);
			if (ok) return;
			break;
		}
		case 'class-component':
		case 'logic': {
			// Existing prototype-swap fast-patch. Falls through to reboot
			// on any failure (provider change, page-export change, etc.).
			try {
				const patched = await handleFastUpdate(message);
				if (patched) return;
			} catch (err) {
				console.warn(
					'[HMR] Angular fast update threw, falling back to reboot:',
					err
				);
			}
			break;
		}
		case 'service-with-side-effects':
		case 'route':
		case 'reboot':
		case 'full':
			// Explicit reboot signals — skip the fast path entirely and
			// log why so the developer can see the classification.
			break;
		default:
			// Unknown update type — be conservative and reboot.
			break;
	}

	// Falling through: full re-bootstrap. Components and services that
	// opted into `preserveAcrossHmr(this)` keep their state; anything
	// that didn't opt in is reset to its class-field defaults. The
	// summary log emitted by `endHmrReboot` lists what was preserved.
	logRebootReason(message);
	await handleFullUpdate(message);
};

export const handleAngularUpdate = (message: HMRMessage) => {
	if (detectCurrentFramework() !== 'angular') return;

	const updateType = message.data.updateType ?? 'logic';

	if (
		(updateType === 'style' || updateType === 'css-only') &&
		message.data.cssUrl
	) {
		// Global CSS-only updates: swap the stylesheet in place. These
		// run outside the activeMessage queue because they can't conflict
		// with an in-flight component update.
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'angular'
		);

		return;
	}

	if (activeMessage) {
		// Coalesce: an update is in flight, queue this one (replacing any
		// earlier queued update, which is now stale).
		pendingMessage = message;

		return;
	}

	activeMessage = processMessage(message).finally(() => {
		activeMessage = null;
		if (pendingMessage) {
			const next = pendingMessage;
			pendingMessage = null;
			handleAngularUpdate(next);
		}
	});
};

// ============================================================
// RE-BOOTSTRAP WITH VIEW TRANSITIONS API
// ============================================================

const findRootSelector = (container: Element) => {
	const candidates = container.querySelectorAll('*');
	for (let idx = 0; idx < candidates.length; idx++) {
		const candidate = candidates[idx];
		if (!candidate) continue;
		const tag = candidate.tagName.toLowerCase();
		if (tag.includes('-')) return tag;
	}

	return null;
};

const destroyAngularApp = () => {
	if (!window.__ANGULAR_APP__) return;

	try {
		window.__ANGULAR_APP__.destroy();
	} catch {
		/* ignored */
	}
	window.__ANGULAR_APP__ = null;
};

const bootstrapAngularModule = async (
	indexPath: string,
	rootSelector: string | null,
	rootContainer: Element
) => {
	if (rootSelector && !rootContainer.querySelector(rootSelector)) {
		rootContainer.appendChild(document.createElement(rootSelector));
	}

	window.__HMR_SKIP_HYDRATION__ = true;

	const origWarn = suppressNg0912();

	await import(`${indexPath}?t=${Date.now()}`);
	await waitForAngularApp();

	console.warn = origWarn;
};

const tickAngularApp = () => {
	if (!window.__ANGULAR_APP__) return;

	try {
		window.__ANGULAR_APP__.tick();
	} catch {
		/* ignored */
	}
};

/* Resolve when Angular reports the application is stable: no pending
   microtasks, scheduled CD, or in-flight lazy chunk loads. Used to gate
   the close of the HMR restoration window so lazy-route components get
   a chance to construct (and call `preserveAcrossHmr`) before
   `rebootInProgress` flips back to false. Falls back after a generous
   ceiling in the unlikely case `whenStable` never resolves (e.g. an
   infinite retry on a service the new app never finishes initializing) —
   we'd rather close the window than leave HMR wedged forever. */
const APP_STABLE_FALLBACK_MS = 10_000;

const waitForAppStable = async () => {
	const app = window.__ANGULAR_APP__;
	if (!app || typeof app.whenStable !== 'function') return;

	let timer: ReturnType<typeof setTimeout> | undefined;
	const fallback = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, APP_STABLE_FALLBACK_MS);
	});

	try {
		await Promise.race([app.whenStable(), fallback]);
	} catch {
		/* ignored — fallback timer still resolves */
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
};

/* `runWithViewTransition` wraps a callback in `document.startViewTransition`
   for a smooth crossfade across full re-bootstraps. Queueing is NOT needed
   here because `handleAngularUpdate` already serializes incoming messages
   through the outer `activeMessage`/`pendingMessage` slots — only one
   update runs at a time, so a new `startViewTransition` never aborts an
   in-flight one mid-callback. */
const runWithViewTransition = async (updateFn: () => Promise<void>) => {
	const doc: ViewTransitionDocument = document;

	if (typeof doc.startViewTransition !== 'function') {
		try {
			await updateFn();
		} catch (err) {
			console.warn('[HMR] Angular update failed (non-fatal):', err);
		}

		return;
	}

	let styleEl: HTMLStyleElement | null = null;
	try {
		styleEl = document.createElement('style');
		styleEl.textContent =
			'::view-transition-old(root),::view-transition-new(root){animation:none!important}';
		document.head.appendChild(styleEl);
	} catch {
		/* ignored */
	}

	let updatePromise: Promise<void> = Promise.resolve();
	try {
		const transition = doc.startViewTransition(() => {
			updatePromise = updateFn();

			return updatePromise;
		});
		// Wait for both the visual transition and the update callback.
		// `transition.finished` rejects with AbortError when a new transition
		// supersedes this one — swallow that since we serialize updates so
		// it shouldn't happen, and even if it does we still want to wait
		// for `updateFn` to complete before releasing the next update.
		await Promise.all([
			transition.finished.catch(() => {
				/* skipped */
			}),
			updatePromise.catch((err) => {
				console.warn('[HMR] Angular update failed (non-fatal):', err);
			})
		]);
	} catch (err) {
		console.warn('[HMR] Angular update failed (non-fatal):', err);
		// If startViewTransition itself threw, run the update directly so
		// HMR still applies (loses the crossfade but preserves correctness).
		try {
			await updateFn();
		} catch (innerErr) {
			console.warn('[HMR] Angular update failed (non-fatal):', innerErr);
		}
	} finally {
		if (styleEl && styleEl.parentNode) styleEl.remove();
	}
};

const handleFullUpdate = async (message: HMRMessage) => {
	// DOM-level state — preserved separately from instance state because
	// it lives in the document, not in component fields. Form values and
	// scroll position survive a full re-bootstrap regardless of whether
	// any component opted into `preserveAcrossHmr`.
	const scrollState = saveScrollState();
	const formState = saveFormState();

	if (message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'angular'
		);
	}

	const rootContainer = document.getElementById('root') || document.body;
	const rootSelector = findRootSelector(rootContainer);

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'angular'
	);
	if (!indexPath) return;

	const doUpdate = async () => {
		// Snapshot every instance that opted into `preserveAcrossHmr(this)`
		// before destroying the app, and flip the reboot-in-progress flag
		// on. The new instances created during bootstrap will read cached
		// state back via the same helper while the flag is on. Both this
		// capture call and the user-facing `preserveAcrossHmr` helper
		// share the same `globalThis`-anchored cache via `hmrPreserveCore`.
		captureTrackedInstanceStates();
		try {
			destroyAngularApp();
			await bootstrapAngularModule(
				indexPath,
				rootSelector,
				rootContainer
			);
			tickAngularApp();
			restoreFormState(formState);
			restoreScrollState(scrollState);
		} finally {
			// Lazy-loaded child route components construct AFTER
			// `bootstrapAngularModule` returns — the route activation
			// chain (loadComponent → dynamic import → instantiate) runs
			// asynchronously after the root app reports bootstrapped.
			// Wait for the application to become stable so those lazy
			// components have constructed and called `preserveAcrossHmr`
			// before we close the restoration window. `whenStable`
			// resolves when there are no pending tasks (lazy chunk
			// loads, microtasks, scheduled CD) — strictly event-based,
			// no fixed timer needed.
			await waitForAppStable();
			endHmrReboot();
		}
	};

	await runWithViewTransition(doUpdate);
};
