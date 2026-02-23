import Elysia from 'elysia';
import type { HMRState } from '../clientManager';
import { broadcastToClients } from '../webSocket';
import { getStudioAppHtml } from './bundler';
import { setActiveRuntime, getActiveRuntime } from '../runtime/devRuntimeState';

export const createDevIntrospectionServer = (app: Elysia, hmrState: HMRState, manifest: Record<string, string>) => {
    // Dev-only tracking variables
    const runtimeSampleShapes = new Map<string, any>();

    app.onAfterHandle({ as: 'global' }, ({ request, response }) => {
        const url = new URL(request.url);

        // Track active application route runtime
        if (
            !url.pathname.startsWith('/__absolute_dev') &&
            !url.pathname.startsWith('/__absolute_studio')
        ) {
            let fw = 'unknown';
            let type: 'api' | 'page' = url.pathname.startsWith('/api') || url.pathname.startsWith('/trpc') ? 'api' : 'page';
            let ssr = false;

            // console.log(`[DevTracker] ${url.pathname} response type:`, response?.constructor?.name, 'instanceof Response:', response instanceof Response);

            if (response instanceof Response) {
                if (response.headers.has('X-Absolute-Framework')) {
                    fw = response.headers.get('X-Absolute-Framework')!;
                    ssr = response.headers.get('X-Absolute-SSR') === 'true';
                    type = (response.headers.get('X-Absolute-Type') as 'page' | 'api') || 'page';
                }
            }

            // Only set if we actually identified it as an absolute handled request, or if it's an API route
            if (fw !== 'unknown' || type === 'api') {
                setActiveRuntime({
                    route: url.pathname,
                    framework: fw,
                    type,
                    ssrEnabled: ssr,
                    hmrStrategy: 'websocket', // Currently static globally
                    lastAccessed: Date.now(),
                    accessCount: 1 // Re-calculated by setActiveRuntime logic internally
                });
            }
        }

        // Response sampling logic
        if (
            !url.pathname.startsWith('/__absolute') &&
            (url.pathname.startsWith('/api') || url.pathname.startsWith('/trpc'))
        ) {
            if (!runtimeSampleShapes.has(url.pathname) && response) {
                try {
                    // Extremely shallow serialize logic for sample
                    let sample: any = response;
                    if (typeof response === 'object' && response !== null) {
                        if (response instanceof Response) {
                            // skip, difficult to safely clone/read without breaking consumer
                        } else {
                            sample = JSON.parse(JSON.stringify(response));
                        }
                    }
                    runtimeSampleShapes.set(url.pathname, sample);
                } catch {
                    // ignore sampling errors silently
                }
            }
        }
    });

    // Redirect the studio route to have a trailing slash so relative module imports resolve correctly
    app.get('/__absolute_studio', ({ redirect }) => {
        return redirect('/__absolute_studio/');
    });

    // Serve the Studio Web UI frontend HTML
    app.get('/__absolute_studio/', async () => {
        const html = await getStudioAppHtml();
        return new Response(html, {
            headers: { 'Content-Type': 'text/html' }
        });
    });

    // Serve the compiled Svelte App.js and its panel chunks
    app.get('/__absolute_studio/*', async ({ request }) => {
        const { readFileSync } = await import('node:fs');
        const { resolve, join } = await import('node:path');
        const { compileSvelte } = await import('../../build/compileSvelte');

        const url = new URL(request.url);
        // path is like /__absolute_studio/panels/OverviewPanel.js
        const relativePath = url.pathname.replace('/__absolute_studio/', '').replace(/\.js$/, '.svelte');

        const uiDir = resolve(import.meta.dir, 'ui');
        const requestedSveltePath = join(uiDir, relativePath);

        const { svelteClientPaths } = await compileSvelte(
            [requestedSveltePath],
            join(process.cwd(), '.absolutejs', 'studio-build'),
            new Map(),
            false
        );

        const found = svelteClientPaths.find(p => p.endsWith(relativePath.replace('.svelte', '.js')));
        if (found) {
            let js = readFileSync(found, 'utf-8');
            // Rewrite imports for nested svelte files broadly
            js = js
                .replace(/from\s+['"]svelte['"]/g, 'from "https://esm.sh/svelte@5.35.2"')
                .replace(/(import|from)\s+['"]svelte\/([^'"]+)['"]/g, '$1 "https://esm.sh/svelte@5.35.2/$2"');
            return new Response(js, {
                headers: { 'Content-Type': 'application/javascript' }
            });
        }

        return new Response('console.error("Studio UI JS missing");', {
            headers: { 'Content-Type': 'application/javascript' },
            status: 404
        });
    });

    return app.group('/__absolute_dev', (devApp) => {
        return devApp
            .get('/routes', () => {
                const routes = app.routes.map((route) => {
                    // Guess type based on path or response. 
                    // Elysia routes have path and method. 
                    const type = route.path.startsWith('/api') || route.path.startsWith('/trpc') ? 'api' : 'page';
                    return {
                        path: route.path,
                        method: route.method,
                        type,
                        handlerFile: 'unknown', // Hard to inspect Elysia internals dynamically in a safe way without internal dependencies
                        framework: 'unknown', // Could infer by analyzing handlers or config
                        lastModified: Date.now(), // Approximate if we can't map exactly
                        runtimeSampleShape: runtimeSampleShapes.get(route.path) || null
                    };
                });

                // Exclude internal absolute routes
                return routes.filter((r) => !r.path.startsWith('/__absolute') && r.path !== '/*');
            })
            .get('/runtime', () => {
                const active = getActiveRuntime();
                if (!active) {
                    return {
                        status: 'no-active-route',
                        message: 'No application route accessed yet.'
                    };
                }
                return {
                    ...active,
                    devMode: true
                };
            })
            .get('/hmr', () => {
                // Return the ring buffer of recent events
                return hmrState.hmrEvents;
            })
            .get('/state', () => {
                // Convert registry map to array
                return Array.from(hmrState.stateRegistry.values());
            })
            .post('/state/update', ({ body }) => {
                if (typeof body !== 'object' || body === null) {
                    return { error: 'Invalid body' };
                }

                const { id, newValue } = body as { id: string; newValue: any };

                if (!id) return { error: 'Missing state id' };

                // Guard against functions
                if (typeof newValue === 'function') {
                    return { error: 'Cannot execute functions' };
                }

                const existing = hmrState.stateRegistry.get(id);
                if (!existing) {
                    return { error: 'State unit not found' };
                }

                existing.currentValue = newValue;
                hmrState.stateRegistry.set(id, existing);

                // Broadcast to clients through websocket
                broadcastToClients(hmrState, {
                    type: 'state-update',
                    id,
                    newValue
                });

                return { success: true };
            })
            .get('/ssr', () => {
                const defaultMetrics = {
                    serverRenderTimeMs: 0,
                    hydrationTimeMs: 0,
                    payloadSizeBytes: 0,
                    mismatchWarnings: []
                };
                const metrics = (globalThis as any).__ABS_LAST_SSR_METRICS__ || defaultMetrics;
                return metrics;
            });
    });
};
