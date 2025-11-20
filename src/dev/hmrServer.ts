import { resolve as PATH_RESOLVE, sep as PATH_SEP, resolve, dirname } from 'node:path';
import { statSync, readFileSync } from 'node:fs';
import { Elysia } from 'elysia';
import { Transpiler } from 'bun';
import { build } from '../core/build';
import {
  handleHTMLPageRequest,
  handleReactPageRequest,
  handleSveltePageRequest,
  handleVuePageRequest,
  handleHTMXPageRequest
} from '../core/pageHandlers';
import type { BuildConfig } from '../types';
import { generateHeadElement } from '../utils/generateHeadElement';
import { getHostConfig, generateWebSocketURLCode } from '../utils/hostConfig';
import { createHMRState, type HMRState, getSourceFileVersion, incrementSourceFileVersions } from './clientManager';
import { startFileWatching } from './fileWatcher';
import { queueFileChange } from './rebuildTrigger';
import { handleClientConnect, handleClientDisconnect, handleHMRMessage } from './webSocket';
import { buildInitialDependencyGraph } from './dependencyGraph';
import { getWatchPaths } from './pathUtils';
import { generateSimpleReactHMRClientCode } from './simpleReactHMR';
import { loadFreshModule } from './freshModuleLoader';

/* Build root directory for static file serving */
const ROOT_DIR = PATH_RESOLVE('./example/build');

/* Main entry point for the HMR server - orchestrates everything
   This replaces the old class-based approach with a functional one */
export async function startBunHMRDevServer(config: BuildConfig) {
  // Get host configuration with priority: CLI flag > config > environment > default
  const hostConfig = getHostConfig(config);
  
  // Create initial state
  const state = createHMRState();
  
  // Initialize dependency graph by scanning all source files
  const watchPaths = getWatchPaths(config);
  buildInitialDependencyGraph(state.dependencyGraph, watchPaths);
  
  console.log('Building AbsoluteJS with HMR...');
  
  // Initial build
  let manifest = await build({
    ...config,
    options: {
      ...config.options,
      preserveIntermediateFiles: true
    }
  });
  
  if (!manifest) {
    throw new Error('Build failed - no manifest generated');
  }
  
  console.log('Build completed successfully');
  console.log('Manifest keys:', Object.keys(manifest));
  
  // Inject HMR client script into HTML
  const injectHMRClient = (html: string): string => {
    const hmrScript = `
      <script>
        (function() {
          // Declare HMR globals for TypeScript and framework HMR clients
          if (typeof window !== 'undefined') {
            if (!window.__HMR_MANIFEST__) {
              window.__HMR_MANIFEST__ = {};
            }
            if (!window.__HMR_MODULE_UPDATES__) {
              window.__HMR_MODULE_UPDATES__ = [];
            }
            if (!window.__HMR_MODULE_VERSIONS__) {
              window.__HMR_MODULE_VERSIONS__ = {}; // Client module versions
            }
            if (!window.__HMR_SERVER_VERSIONS__) {
              window.__HMR_SERVER_VERSIONS__ = {}; // Server module versions (for sync check)
            }
          }
          
          // Module version validation and sync
          function checkModuleVersions(serverVersions, clientVersions) {
            if (!serverVersions || !clientVersions) {
              return { stale: [], needsSync: false };
            }
            
            const stale = [];
            let needsSync = false;
            
            for (const [modulePath, serverVersion] of Object.entries(serverVersions)) {
              const clientVersion = clientVersions[modulePath];
              
              if (clientVersion === undefined || clientVersion < serverVersion) {
                stale.push(modulePath);
                needsSync = true;
              }
            }
            
            return { stale, needsSync };
          }
          
          // Pre-fetch updated modules to ensure sync
          async function prefetchModules(modulePaths, manifest) {
            const prefetchPromises = [];
            
            for (const modulePath of modulePaths) {
              // Find the manifest key for this path
              let manifestPath = modulePath;
              for (const [key, path] of Object.entries(manifest || {})) {
                if (path === modulePath || path.includes(modulePath)) {
                  manifestPath = path;
                  break;
                }
              }
              
              // Add cache busting
              const cacheBuster = '?t=' + Date.now();
              const fullPath = manifestPath.startsWith('/') 
                ? manifestPath + cacheBuster
                : '/' + manifestPath + cacheBuster;
              
              // Pre-fetch the module
              prefetchPromises.push(
                import(/* @vite-ignore */ fullPath).catch(err => {
                  console.warn('Failed to prefetch module:', modulePath, err);
                })
              );
            }
            
            await Promise.all(prefetchPromises);
            console.log('✅ Pre-fetched', modulePaths.length, 'module(s) for sync');
          }
          
          // Simple React HMR Client Handler
          ${generateSimpleReactHMRClientCode()}
          
          console.log('Initializing HMR client...');
          
          // Determine WebSocket URL based on host configuration
          // Generated code handles --host flag, config.host, or default behavior
          ${generateWebSocketURLCode(hostConfig)}
          const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
          const wsUrl = \`\${wsProtocol}://\${wsHost}:\${wsPort}/hmr\`;
          
          const ws = new WebSocket(wsUrl);
          let reconnectTimeout;
          let pingInterval;
          let isConnected = false;
          let isHMRUpdating = false; // Track if HMR update is in progress
          
          ws.onopen = function() {
            console.log('HMR client connected');
            isConnected = true;
            // Set HMR active flag when WebSocket connects - this prevents bundle hash check from reloading
            sessionStorage.setItem('__HMR_CONNECTED__', 'true');
            ws.send(JSON.stringify({ type: 'ready' }));
            
            if (reconnectTimeout) {
              clearTimeout(reconnectTimeout);
              reconnectTimeout = null;
            }
            
            pingInterval = setInterval(function() {
              if (ws.readyState === WebSocket.OPEN && isConnected) {
                ws.send(JSON.stringify({ type: 'ping' }));
              }
            }, 30000);
          };
          
          ws.onmessage = function(event) {
            try {
              const message = JSON.parse(event.data);
              console.log('HMR message received:', message.type);
              
              // Track HMR update state to prevent WebSocket from closing during updates
              if (message.type === 'react-update' || message.type === 'html-update' || message.type === 'module-update' || message.type === 'rebuild-start') {
                isHMRUpdating = true;
                // Clear flag after update completes (give it time for DOM patching)
                setTimeout(() => { isHMRUpdating = false; }, 2000);
              }
              
              switch (message.type) {
                case 'manifest':
                  console.log('Received manifest:', Object.keys(message.data.manifest || message.data));
                  window.__HMR_MANIFEST__ = message.data.manifest || message.data;
                  
                  // Update server versions
                  if (message.data.serverVersions) {
                    window.__HMR_SERVER_VERSIONS__ = message.data.serverVersions;
                    console.log('📌 Received server module versions');
                  }
                  
                  // Initialize client versions if not present
                  if (!window.__HMR_MODULE_VERSIONS__) {
                    window.__HMR_MODULE_VERSIONS__ = {};
                  }
                  
                  window.__HMR_MODULE_UPDATES__ = []; // Initialize module updates array
                  break;
                  
                case 'rebuild-start':
                  console.log('Rebuild started for:', message.data.affectedFrameworks);
                  break;
                  
                case 'rebuild-complete':
                  console.log('Rebuild completed');
                  if (window.__HMR_MANIFEST__) {
                    window.__HMR_MANIFEST__ = message.data.manifest;
                  }
                  // Don't reload for React or HTML updates - they're handled via dedicated update messages
                  // Only reload for frameworks that don't have HMR support
                  if (message.data.affectedFrameworks && 
                      !message.data.affectedFrameworks.includes('react') && 
                      !message.data.affectedFrameworks.includes('html')) {
                    console.log('Reloading page due to rebuild (non-HMR framework)...');
                    // Force a hard reload to bypass browser cache
                    // Add cache busting to the URL to ensure fresh bundle
                    const url = new URL(window.location.href);
                    url.searchParams.set('_cb', Date.now().toString());
                    window.location.href = url.toString();
                  } else {
                    const hmrFrameworks = [];
                    if (message.data.affectedFrameworks?.includes('react')) hmrFrameworks.push('React');
                    if (message.data.affectedFrameworks?.includes('html')) hmrFrameworks.push('HTML');
                    if (hmrFrameworks.length > 0) {
                      console.log('Rebuild completed - ' + hmrFrameworks.join(' and ') + ' updates will be handled via HMR');
                    }
                  }
                  break;
                  
                case 'framework-update':
                  console.log('Framework updated:', message.data.framework);
                  break;
                  
                case 'module-update':
                  console.log('Module update received:', {
                    framework: message.data.framework,
                    moduleCount: message.data.modules?.length || 0
                  });
                  
                  // For React updates, skip version mismatch checking and reload
                  // React updates are handled via the dedicated 'react-update' message with DOM patching
                  if (message.data.framework === 'react') {
                    // Just update versions and manifest, but don't check for mismatches or reload
                    if (message.data.serverVersions) {
                      window.__HMR_SERVER_VERSIONS__ = { ...window.__HMR_SERVER_VERSIONS__, ...message.data.serverVersions };
                    }
                    if (message.data.moduleVersions) {
                      window.__HMR_MODULE_VERSIONS__ = { ...window.__HMR_MODULE_VERSIONS__, ...message.data.moduleVersions };
                    }
                    if (message.data.manifest) {
                      window.__HMR_MANIFEST__ = { ...window.__HMR_MANIFEST__, ...message.data.manifest };
                    }
                    // Store module updates for framework-specific HMR clients
                    if (!window.__HMR_MODULE_UPDATES__) {
                      window.__HMR_MODULE_UPDATES__ = [];
                    }
                    window.__HMR_MODULE_UPDATES__.push(message.data);
                    console.log('✅ React module update processed (will be handled by react-update message)');
                    break; // Don't reload - react-update message will handle the update
                  }
                  
                  // For non-React frameworks, do version mismatch checking
                  // Update server versions
                  if (message.data.serverVersions) {
                    window.__HMR_SERVER_VERSIONS__ = { ...window.__HMR_SERVER_VERSIONS__, ...message.data.serverVersions };
                  }
                  
                  // Update client versions for updated modules
                  if (message.data.moduleVersions) {
                    window.__HMR_MODULE_VERSIONS__ = { ...window.__HMR_MODULE_VERSIONS__, ...message.data.moduleVersions };
                  }
                  
                  // Check for version mismatches (only for non-React frameworks)
                  const versionCheck = checkModuleVersions(
                    message.data.serverVersions || window.__HMR_SERVER_VERSIONS__,
                    window.__HMR_MODULE_VERSIONS__
                  );
                  
                  if (versionCheck.needsSync && versionCheck.stale.length > 0) {
                    console.warn('⚠️ Module version mismatch detected:', versionCheck.stale.length, 'stale module(s)');
                    console.log('Stale modules:', versionCheck.stale);
                    
                    // If too many modules are stale, force reload for safety
                    if (versionCheck.stale.length > 10) {
                      console.error('❌ Too many stale modules, forcing full reload');
                      window.location.reload();
                      break;
                    }
                    
                    // Pre-fetch stale modules to sync
                    const updatedManifest = message.data.manifest || window.__HMR_MANIFEST__ || {};
                    prefetchModules(versionCheck.stale, updatedManifest).then(() => {
                      console.log('✅ Module sync complete');
                      // Update client versions after successful prefetch
                      if (message.data.moduleVersions) {
                        window.__HMR_MODULE_VERSIONS__ = { ...window.__HMR_MODULE_VERSIONS__, ...message.data.moduleVersions };
                      }
                    }).catch((error) => {
                      console.error('❌ Module sync failed:', error);
                      console.warn('⚠️ Falling back to full reload');
                      window.location.reload();
                    });
                  }
                  
                  // Store module updates for framework-specific HMR clients
                  if (!window.__HMR_MODULE_UPDATES__) {
                    window.__HMR_MODULE_UPDATES__ = [];
                  }
                  window.__HMR_MODULE_UPDATES__.push(message.data);
                  
                  // Update manifest with new module paths
                  const updatedManifest = message.data.manifest || window.__HMR_MANIFEST__ || {};
                  if (window.__HMR_MANIFEST__) {
                    window.__HMR_MANIFEST__ = { ...window.__HMR_MANIFEST__, ...updatedManifest };
                  }
                  
                  // Fallback: reload for non-React updates
                  console.log('Module update requires page reload');
                  window.location.reload();
                  break;
                
                case 'react-update':
                  console.log('🔄 React update received:', message.data.sourceFile);
                  console.log('📦 Update #', (window.__HMR_UPDATE_COUNT__ || 0) + 1);
                  window.__HMR_UPDATE_COUNT__ = (window.__HMR_UPDATE_COUNT__ || 0) + 1;
                  
                  // Set HMR active flag to prevent bundle hash check from triggering reload
                  sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                  
                  // Update bundle hash if provided in manifest
                  if (message.data.manifest && message.data.manifest.ReactExampleIndex) {
                    const indexPath = message.data.manifest.ReactExampleIndex;
                    const bundleHashMatch = indexPath.match(/\\.([a-z0-9]+)\\.js$/);
                    if (bundleHashMatch) {
                      const newBundleHash = bundleHashMatch[1];
                      sessionStorage.setItem('__BUNDLE_HASH__', newBundleHash);
                      console.log('📦 Updated bundle hash to:', newBundleHash);
                    }
                  }
                  
                  // Simple DOM patching with new HTML from server
                  if (message.data.html) {
                    // Always use document.body as the container - it's the most reliable
                    // The body content from the server includes everything we need
                    const container = document.body;
                    if (container) {
                      console.log('🔄 Patching DOM with new HTML...');
                      console.log('📦 HTML length:', message.data.html.length);
                      console.log('📦 Body before patch:', container.innerHTML.length, 'chars');
                      
                      // CRITICAL: Instead of unmounting and re-hydrating, re-render with the new component
                      // This avoids the white flicker by keeping React connected to the DOM
                      console.log('🔄 Re-rendering React component with fresh code...');
                      
                      // Re-import the React component directly (not the index file)
                      // This gets us the fresh component code without going through hydration
                      const cacheBuster = '?t=' + Date.now();
                      const componentPath = '../../example/react/pages/ReactExample.tsx' + cacheBuster;
                      
                      Promise.all([
                        import(/* @vite-ignore */ componentPath),
                        import('react'),
                        import('react-dom/client')
                      ])
                        .then(([ReactModule, React, ReactDOM]) => {
                          const ReactExample = ReactModule.ReactExample;
                          if (!ReactExample) {
                            throw new Error('ReactExample not found in module');
                          }
                          
                          const { createElement } = React;
                          const props = window.__INITIAL_PROPS__ || {};
                          const element = createElement(ReactExample, props);
                          
                          // Re-render using existing root (if available) or create new one
                          if (window.__REACT_ROOT__ && typeof window.__REACT_ROOT__.render === 'function') {
                            // Use existing root to re-render (no flicker - React handles the update smoothly!)
                            window.__REACT_ROOT__.render(element);
                            console.log('✅ React component re-rendered (no flicker)');
                          } else {
                            // No existing root, need to create one
                            // But first, we need to patch the DOM with the new HTML so React has something to render into
                            container.innerHTML = message.data.html;
                            const { createRoot } = ReactDOM;
                            const root = createRoot(document);
                            root.render(element);
                            window.__REACT_ROOT__ = root;
                            console.log('✅ React root created and component rendered');
                          }
                          
                          // Clear HMR active flag after successful update
                          sessionStorage.removeItem('__HMR_ACTIVE__');
                        })
                        .catch((error) => {
                          console.error('❌ Failed to re-render React:', error);
                          console.warn('⚠️ Falling back to DOM patch + re-hydration...');
                          
                          // Fallback: patch DOM and re-hydrate (will cause flicker but at least it works)
                          container.innerHTML = message.data.html;
                          
                          const indexPath = message.data.manifest?.ReactExampleIndex;
                          if (indexPath) {
                            const modulePath = indexPath.startsWith('/') 
                              ? indexPath + '?t=' + Date.now()
                              : '/' + indexPath + '?t=' + Date.now();
                            
                            import(/* @vite-ignore */ modulePath)
                              .then(() => {
                                console.log('✅ Fallback: React re-hydrated after DOM patch');
                                sessionStorage.removeItem('__HMR_ACTIVE__');
                              })
                              .catch(() => {
                                console.warn('⚠️ Fallback re-hydration failed, reloading...');
                                sessionStorage.removeItem('__HMR_ACTIVE__');
                                window.location.reload();
                              });
                          } else {
                            sessionStorage.removeItem('__HMR_ACTIVE__');
                          }
                        });
                    } else {
                      console.error('❌ document.body not found - this should never happen');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    }
                  } else {
                    console.warn('⚠️ No HTML in React update');
                    console.warn('⚠️ Message data:', Object.keys(message.data || {}));
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                    // Don't reload - this is a server-side issue, not a client issue
                    console.error('❌ Failed to update React component - no HTML provided');
                  }
                  break;
                
                case 'html-update':
                  console.log('🔄 HTML update received:', message.data.sourceFile);
                  
                  // Set HMR active flag to prevent bundle hash check from triggering reload
                  sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                  
                  // Simple DOM patching with new HTML from server
                  if (message.data.html) {
                    const container = document.body;
                    if (container) {
                      console.log('🔄 Patching DOM with new HTML...');
                      console.log('📦 HTML length:', message.data.html.length);
                      console.log('📦 Body before patch:', container.innerHTML.length, 'chars');
                      
                      // For HTML files, we can simply replace the body content
                      // No need for React re-hydration - just patch the DOM
                      container.innerHTML = message.data.html;
                      console.log('✅ HTML updated via DOM patch');
                      console.log('📦 Body after patch:', container.innerHTML.length, 'chars');
                      
                      // Verify the patch worked
                      if (container.innerHTML.trim().length === 0) {
                        console.error('❌ DOM patch resulted in empty body - this should not happen');
                      } else {
                        console.log('✅ DOM patch verified - body has content');
                      }
                      
                      // Clear HMR active flag after successful update
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    } else {
                      console.error('❌ document.body not found - this should never happen');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    }
                  } else {
                    console.warn('⚠️ No HTML in HTML update');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                    console.error('❌ Failed to update HTML - no HTML provided');
                  }
                  break;
                
                case 'rebuild-error':
                  console.error('Rebuild error:', message.data.error);
                  break;
                  
                case 'pong':
                  console.log('Pong received - connection healthy');
                  break;
                  
                case 'connected':
                  console.log('HMR connection confirmed');
                  break;
                  
                default:
                  console.log('Unknown HMR message:', message.type);
              }
            } catch (error) {
              console.error('Error processing HMR message:', error);
            }
          };
          
          ws.onclose = function(event) {
            console.log('HMR client disconnected', event.code, event.reason);
            isConnected = false;
            
            if (pingInterval) {
              clearInterval(pingInterval);
              pingInterval = null;
            }
            
            // Don't clear __HMR_CONNECTED__ flag on disconnect - keep it for bundle hash check
            // Only clear it if it's a normal close (code 1000 or 1001) and we're not in the middle of an update
            if (event.code === 1000 || event.code === 1001) {
              // Normal close - might be a page navigation, keep the flag for now
              // It will be cleared on next page load if HMR doesn't reconnect
            } else {
              // Abnormal close - connection lost, but keep flag to prevent bundle hash check from reloading
              // The reconnect will restore the connection
              console.log('Connection lost, attempting to reconnect in 3 seconds...');
              reconnectTimeout = setTimeout(function() {
                console.log('Attempting to reconnect HMR client...');
                // Don't reload - let the WebSocket reconnect naturally
                // If reconnection fails, the page will naturally reload on next interaction
                window.location.reload();
              }, 3000);
            }
          };
          
          ws.onerror = function(error) {
            console.error('HMR WebSocket error:', error);
            isConnected = false;
          };
          
          window.__HMR_WS__ = ws;
          
          window.addEventListener('beforeunload', function(event) {
            // Don't close WebSocket during HMR updates - let it persist
            if (isHMRUpdating) {
              console.log('🔄 HMR update in progress - keeping WebSocket connection alive');
              // Just clear intervals, but keep connection alive
              if (pingInterval) clearInterval(pingInterval);
              if (reconnectTimeout) clearTimeout(reconnectTimeout);
              return;
            }
            
            // Only close WebSocket if we're actually navigating away (not a reload)
            // Note: We can't reliably detect navigation vs reload in beforeunload,
            // so we'll be conservative and only close if explicitly needed
            // The browser will close the connection naturally when the page unloads anyway
            if (pingInterval) clearInterval(pingInterval);
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            // Don't actively close WebSocket - let browser handle it naturally
            // This prevents disconnects during HMR updates
          });
        })();
      </script>
    `;
    
    // Inject before </body> if present; otherwise append
    const closingTagRegex = /<\/body\s*>/i;
    const match = closingTagRegex.exec(html);

    return match !== null
      ? html.slice(0, match.index) + hmrScript + html.slice(match.index)
      : html + hmrScript;
  };
  
  const injectHMRIntoResponse = async (response: Response): Promise<Response> => {
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('text/html')) {
      const htmlContent = await response.text();
      const htmlWithHMR = injectHMRClient(htmlContent);

      return new Response(htmlWithHMR, {
        headers: new Headers(response.headers)
      });
    }
    
    return response;
  };
  
  const handleRequest = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const {pathname} = url;
    
    try {
      switch (pathname) {
        case '/':
        case '/html': {
          const htmlFile = await handleHTMLPageRequest('./example/build/html/pages/HtmlExample.html');
          const htmlContent = await htmlFile.text();
          const htmlWithHMR = injectHMRClient(htmlContent);

          return new Response(htmlWithHMR, {
            headers: { 'Content-Type': 'text/html' }
          });
        }
          
        case '/react': {
          // CRITICAL: Wait for any pending rebuilds to complete
          // This ensures the server uses the latest built code, not stale modules
          // According to React docs: "The React tree must produce the same output on server and client"
          if (state.isRebuilding) {
            console.log('⏳ Waiting for rebuild to complete before serving request...');
            // Wait up to 5 seconds for rebuild to complete
            let waitCount = 0;
            while (state.isRebuilding && waitCount < 50) {
              await new Promise(resolve => setTimeout(resolve, 100));
              waitCount++;
            }
            if (state.isRebuilding) {
              console.warn('⚠️ Rebuild still in progress after 5 seconds, serving anyway');
            }
          }
          
          // CRITICAL: Get the latest manifest path - it includes content hash
          // The manifest path already has a hash (e.g., ReactExample.abc123.js)
          // When files change and rebuild, we get a NEW hash (e.g., ReactExample.def456.js)
          const indexPath = manifest['ReactExampleIndex'];
          if (!indexPath) {
            return new Response('ReactExampleIndex not found in manifest', { status: 500 });
          }
          
          // Log the manifest path for debugging
          console.log(`📦 Using manifest path: ${indexPath}`);
          
          // Verify the bundle file exists and check its content matches source
          const bundlePath = indexPath.startsWith('/') 
            ? PATH_RESOLVE(ROOT_DIR, indexPath.slice(1))
            : PATH_RESOLVE(ROOT_DIR, indexPath);
          
          const { existsSync } = await import('node:fs');
          if (existsSync(bundlePath)) {
            // Check if bundle matches source content
            const bundleContent = readFileSync(bundlePath, 'utf-8');
            const appComponentPath = resolve('./example/react/components/App.tsx');
            const appSourceContent = existsSync(appComponentPath) 
              ? readFileSync(appComponentPath, 'utf-8')
              : '';
            
            // Check for mismatch: source has "ReactJS" but bundle has "React" (or vice versa)
            const sourceHasReactJS = appSourceContent.includes('AbsoluteJS + ReactJS');
            const bundleHasReactJS = bundleContent.includes('AbsoluteJS + ReactJS');
            const bundleHasReact = bundleContent.includes('AbsoluteJS + React') && !bundleHasReactJS;
            
            if (sourceHasReactJS && bundleHasReact) {
              console.warn('⚠️  Bundle is stale: source has "ReactJS" but bundle has "React"');
              console.warn('🔄 Triggering rebuild to sync bundle with source...');
              
              // Check if rebuild is already in progress
              if (state.isRebuilding) {
                console.log('⏳ Rebuild already in progress, waiting...');
                // Wait for rebuild to complete (up to 5 seconds)
                let waitCount = 0;
                while (state.isRebuilding && waitCount < 50) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                  waitCount++;
                }
                // After rebuild, the manifest should be updated, so we can continue
                // But we need to get the new manifest path
                const newIndexPath = manifest['ReactExampleIndex'];
                if (newIndexPath && newIndexPath !== indexPath) {
                  console.log(`✅ Rebuild complete, using new bundle: ${newIndexPath}`);
                  // Continue with the new bundle path
                }
              } else {
                // Trigger rebuild for App.tsx to update the bundle
                queueFileChange(state, appComponentPath, config, (newManifest) => {
                  manifest = newManifest;
                  console.log('✅ Bundle rebuilt, manifest updated');
                });
                
                // Wait a bit for rebuild to start, then return a response
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // If rebuild started, return a response asking client to reload
                if (state.isRebuilding) {
                  return new Response(
                    '<!DOCTYPE html><html><head><title>Rebuilding...</title></head><body>' +
                    '<h1>Bundle is stale, rebuilding...</h1>' +
                    '<p>Please wait a moment and refresh the page.</p>' +
                    '<script>setTimeout(() => window.location.reload(), 2000);</script>' +
                    '</body></html>',
                    { headers: { 'Content-Type': 'text/html' } }
                  );
                }
              }
            } else if (bundleHasReactJS) {
              console.log('✅ Bundle file contains "ReactJS" (matches source)');
            } else if (bundleHasReact) {
              console.log('✅ Bundle file contains "React" (matches source)');
            }
          } else {
            console.warn(`⚠️ Bundle file not found: ${bundlePath}, using manifest path: ${indexPath}`);
          }
          
          const componentPath = resolve('./example/react/pages/ReactExample.tsx');
          
          // Read file content to verify what we're about to import
          let fileContent = '';
          try {
            fileContent = readFileSync(componentPath, 'utf-8');
            // Log a snippet to help debug hydration mismatches
            if (fileContent.includes('AbsoluteJS + React')) {
              console.log('✅ Server: Source file contains "AbsoluteJS + React"');
            } else if (fileContent.includes('AbsoluteJS + ReactJS')) {
              console.warn('⚠️  Server: Source file contains "AbsoluteJS + ReactJS" (old version?)');
            }
          } catch (error) {
            console.warn('Failed to read component file for verification:', error);
          }
          
          // CRITICAL: Use fresh module loader to bypass Bun's module cache entirely
          // Bun's cache doesn't respect query parameters for transitive dependencies
          // This ensures server HTML always matches the latest source code
          console.log(`📦 Loading ReactExample using fresh module loader (bypassing Bun cache)`);
          
          let ReactModule: any;
          try {
            // Use fresh module loader to ensure we get the latest code, including all dependencies
            // This transpiles files on-the-fly and imports from temp files, bypassing cache
            console.log(`📦 Loading fresh module: ${componentPath}`);
            ReactModule = await loadFreshModule(componentPath);
            console.log(`✅ Fresh module loaded successfully`);
            
            // Verify the loaded module has the expected content
            if (ReactModule && ReactModule.ReactExample) {
              // Try to render it to a string to see what it actually contains
              const testRender = ReactModule.ReactExample.toString();
              if (testRender.includes('ReactJS')) {
                console.log(`⚠️  Server module contains "ReactJS" in render function`);
              } else if (testRender.includes('React')) {
                console.log(`✅ Server module contains "React" in render function`);
              }
            }
          } catch (error) {
            console.error(`❌ Failed to load fresh module:`, error);
            // Fallback to regular import with cache busting
            try {
              const cacheBuster = `?t=${Date.now()}`;
              ReactModule = await import(`../../example/react/pages/ReactExample.tsx${cacheBuster}`);
              console.warn(`⚠️ Using regular import fallback (may be cached)`);
            } catch (fallbackError) {
              console.error(`❌ Fallback import also failed:`, fallbackError);
              return new Response('Failed to load ReactExample component', { status: 500 });
            }
          }
          
          if (!ReactModule || !ReactModule.ReactExample) {
            console.error('Failed to import ReactExample component');
            return new Response('Failed to load ReactExample component', { status: 500 });
          }
          
          console.log('📦 Server: Loaded ReactModule successfully');
          
          const props = {
            cssPath: manifest['ReactExampleCSS'] || '',
            initialCount: 0
          };
          
          // Simple approach: Just render the page
          // HMR updates are handled via rebuildTrigger.ts
          const reactResponse = await handleReactPageRequest(
            ReactModule.ReactExample,
            indexPath, // Use original path, we'll inject cache busting after rendering
            props
          );
          
          // Read HTML and inject cache-busted script tag
          // This ensures the browser always loads fresh bundle, preventing hydration errors
          const html = await reactResponse.text();
          
          // Extract bundle hash from manifest path (e.g., ReactExample.abc123.js -> abc123)
          const bundleHashMatch = indexPath.match(/\.([a-z0-9]+)\.js$/);
          const bundleHash = bundleHashMatch ? bundleHashMatch[1] : Date.now().toString();
          
          // CRITICAL: Replace the bootstrapModules script tag with cache-busted version
          // The manifest path already includes a content hash (e.g., ReactExample.abc123.js)
          // We add a timestamp AND the bundle hash to ensure the browser always loads fresh
          let cacheBustedHtml = html.replace(
            /(<script[^>]*type=["']module["'][^>]*src=["'])([^"']+)(["'][^>]*><\/script>)/g,
            (match, prefix, src, suffix) => {
              // Remove any existing query parameters first (clean slate)
              const [basePath] = src.split('?');
              
              // Add bundle hash + timestamp cache buster
              // The bundle hash changes when the bundle is rebuilt, forcing a reload
              const cacheBuster = `?_h=${bundleHash}&_t=${Date.now()}`;
              return `${prefix}${basePath}${cacheBuster}${suffix}`;
            }
          );
          
          // CRITICAL: Inject bundle hash check as the VERY FIRST script in <head>
          // This must run synchronously before ANY other scripts, including module scripts
          // We use a blocking inline script that runs immediately when parsed
          const bundleHashCheckScript = `
            <script>
              // CRITICAL: This runs IMMEDIATELY when the script tag is parsed
              // It must run before any module scripts start loading
              // NOTE: Bundle hash check only runs on initial page load, not during HMR updates
              (function() {
                const expectedHash = '${bundleHash}';
                const storedHash = sessionStorage.getItem('__BUNDLE_HASH__');
                const isHMRUpdate = sessionStorage.getItem('__HMR_ACTIVE__') === 'true';
                const isHMRConnected = sessionStorage.getItem('__HMR_CONNECTED__') === 'true';
                
                // Skip bundle hash check if HMR is connected or during HMR updates
                // HMR will handle bundle updates via WebSocket, no need to reload
                if (isHMRConnected || isHMRUpdate) {
                  // Update stored hash to match new bundle, but don't reload
                  if (expectedHash) {
                    sessionStorage.setItem('__BUNDLE_HASH__', expectedHash);
                  }
                  // Clear HMR active flag after processing (if it was set)
                  if (isHMRUpdate) {
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                  }
                  return;
                }
                
                // Wait a bit for WebSocket to connect before checking bundle hash
                // This prevents reload loops when the page reloads but WebSocket hasn't connected yet
                setTimeout(function() {
                  // Re-check if HMR connected while we were waiting
                  const nowHMRConnected = sessionStorage.getItem('__HMR_CONNECTED__') === 'true';
                  const hmrConnectedAt = sessionStorage.getItem('__HMR_CONNECTED_AT__');
                  // If HMR was connected recently (within last 5 seconds), treat it as still connected
                  // This handles brief disconnects during updates
                  const wasRecentlyConnected = hmrConnectedAt && (Date.now() - parseInt(hmrConnectedAt)) < 5000;
                  
                  if (nowHMRConnected || wasRecentlyConnected) {
                    // HMR connected (or was recently connected) - update hash and skip reload
                    if (expectedHash) {
                      sessionStorage.setItem('__BUNDLE_HASH__', expectedHash);
                    }
                    // Restore the connected flag if it was recently connected
                    if (wasRecentlyConnected && !nowHMRConnected) {
                      sessionStorage.setItem('__HMR_CONNECTED__', 'true');
                    }
                    return;
                  }
                  
                  // Only check bundle hash on initial page load (not during HMR updates)
                  // If we have a stored hash and it doesn't match expected, reload immediately
                  if (storedHash && expectedHash && storedHash !== expectedHash) {
                    console.warn('⚠️ Bundle hash changed! Previous:', storedHash, 'Expected:', expectedHash);
                    console.warn('🔄 Stale bundle detected, forcing reload BEFORE module loads...');
                    // Store the new expected hash
                    sessionStorage.setItem('__BUNDLE_HASH__', expectedHash);
                    // Force reload immediately - this prevents the module script from loading
                    window.location.replace(window.location.href + (window.location.search ? '&' : '?') + '_cb=' + Date.now());
                    return;
                  }
                  
                  // Store expected hash for next load
                  if (expectedHash) {
                    sessionStorage.setItem('__BUNDLE_HASH__', expectedHash);
                  }
                }, 200); // Wait 200ms for WebSocket to connect (increased from 100ms for reliability)
              })();
                
                // Store expected hash for next load
                if (expectedHash) {
                  sessionStorage.setItem('__BUNDLE_HASH__', expectedHash);
                }
                
                // Also check when DOM is ready (in case script tag is added dynamically)
                // But only on initial load, not during HMR updates
                function verifyBundleHash() {
                  const moduleScript = document.querySelector('script[type="module"]');
                  if (moduleScript) {
                    const scriptSrc = moduleScript.getAttribute('src') || '';
                    const urlParams = new URLSearchParams(scriptSrc.split('?')[1] || '');
                    const actualHash = urlParams.get('_h');
                    
                    if (expectedHash && actualHash && expectedHash !== actualHash) {
                      console.warn('⚠️ Bundle hash mismatch detected! Expected:', expectedHash, 'Got:', actualHash);
                      console.warn('🔄 Removing stale module script and reloading...');
                      moduleScript.remove();
                      window.location.reload();
                    }
                  }
                }
                
                // Check immediately if DOM is ready, otherwise wait
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', verifyBundleHash);
                } else {
                  setTimeout(verifyBundleHash, 0);
                }
              })();
            </script>
          `;
          
          // Inject the bundle hash check as the VERY FIRST thing in <head>
          // This ensures it runs before any other scripts, including module scripts
          cacheBustedHtml = cacheBustedHtml.replace(
            /(<head[^>]*>)/i,
            `$1${bundleHashCheckScript}`
          );
          
          // Log for debugging
          const scriptMatch = cacheBustedHtml.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)/);
          if (scriptMatch) {
            console.log(`📦 Client bundle path: ${scriptMatch[1]}`);
            console.log(`📦 Bundle hash: ${bundleHash}`);
          }

          // Add cache-control headers to prevent browser caching in development
          // This ensures the browser always fetches fresh HTML and bundles
          return await injectHMRIntoResponse(new Response(cacheBustedHtml, {
            headers: { 
              'Content-Type': 'text/html',
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          }));
        }
          
        case '/svelte': {
          const SvelteModule = await import('../../example/svelte/pages/SvelteExample.svelte');
          const svelteResponse = await handleSveltePageRequest(
            SvelteModule.default,
            manifest['SvelteExample'] || '',
            manifest['SvelteExampleIndex'] || '',
            {
              cssPath: manifest['SvelteExampleCSS'] || '',
              initialCount: 0
            }
          );

          return await injectHMRIntoResponse(svelteResponse);
        }
          
        case '/vue': {
          const VueModule = await import('../../example/vue/pages/VueExample.vue');
          const vueResponse = await handleVuePageRequest(
            VueModule.default,
            manifest['VueExample'] || '',
            manifest['VueExampleIndex'] || '',
            generateHeadElement({
              cssPath: manifest['VueExampleCSS'] || '',
              title: 'AbsoluteJS + Vue'
            }),
            {
              initialCount: 0
            }
          );

          return await injectHMRIntoResponse(vueResponse);
        }
          
        case '/htmx': {
          const htmxFile = await handleHTMXPageRequest('./example/build/htmx/pages/HTMXExample.html');
          const htmxContent = await htmxFile.text();
          const htmxWithHMR = injectHMRClient(htmxContent);

          return new Response(htmxWithHMR, {
            headers: { 'Content-Type': 'text/html' }
          });
        }
          
        case '/hmr-status': {
          return new Response(JSON.stringify({
            connectedClients: state.connectedClients.size, isRebuilding: state.isRebuilding, manifestKeys: Object.keys(manifest), rebuildQueue: Array.from(state.rebuildQueue), timestamp: Date.now()
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
          
        default: {
          // Normalize and constrain requests to the build root to prevent path traversal
          const resolved = PATH_RESOLVE(ROOT_DIR, `.${pathname}`);
          
          // Verify that resolved path is within ROOT_DIR
          if (resolved !== ROOT_DIR && !resolved.startsWith(ROOT_DIR + PATH_SEP)) {
            return new Response('Forbidden', { status: 403 });
          }
          
          try {
            const file = Bun.file(resolved);
            if (await file.exists()) {
              // Add cache-control headers for JavaScript files to prevent browser caching
              // This ensures the browser always loads fresh bundles, preventing hydration errors
              const headers: HeadersInit = {};
              
              if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
                headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
                headers['Pragma'] = 'no-cache';
                headers['Expires'] = '0';
              }
              
              return new Response(file, { headers });
            }
          } catch {
            // File doesn't exist, continue to 404
          }
          
          return new Response('Not Found', { status: 404 });
        }
      }
    } catch (error) {
      console.error('Error handling request:', error);

      return new Response('Internal Server Error', { status: 500 });
    }
  };
  
  const server = new Elysia()
    .ws('/hmr', {
      close: (ws) => handleClientDisconnect(state, ws), message: (ws, message) => {
        handleHMRMessage(state, ws, message);
      }, open: (ws) => handleClientConnect(state, ws, manifest)
    })
    .get('*', handleRequest)
    .listen({
      hostname: hostConfig.hostname,
      port: hostConfig.port
    });
  
  const rebuildCallback = async (newManifest: Record<string, string>) => {
    manifest = newManifest;
  };
  
  startFileWatching(state, config, (filePath: string) => {
    queueFileChange(state, filePath, config, rebuildCallback);
  });
  
  console.log('Bun HMR Dev Server started');
  
  // Format console output to match Vite's style
  if (hostConfig.enabled) {
    if (hostConfig.customHost) {
      // Custom host specified: --host <value>
      console.log(`➜  Local:   http://localhost:${hostConfig.port}/`);
      console.log(`➜  Network: http://${hostConfig.customHost}:${hostConfig.port}/`);
    } else {
      // --host with no value: show all network IPs
      console.log(`➜  Local:   http://localhost:${hostConfig.port}/`);
      if (hostConfig.networkIPs.length > 0) {
        for (const ip of hostConfig.networkIPs) {
          console.log(`➜  Network: http://${ip}:${hostConfig.port}/`);
        }
      } else {
        console.warn('⚠️  No network IPs detected');
      }
    }
  } else {
    // Default: localhost only
    console.log(`➜  Local:   http://${hostConfig.hostname}:${hostConfig.port}/`);
  }
  
  // Show WebSocket endpoint
  const wsHost = hostConfig.enabled && hostConfig.networkIPs.length > 0 
    ? hostConfig.networkIPs[0] 
    : hostConfig.enabled && hostConfig.customHost
    ? hostConfig.customHost
    : 'localhost';
  console.log(`➜  WebSocket: ws://${wsHost}:${hostConfig.port}/hmr`);
  
  console.log('File watching: Active');
  console.log('Available routes:');
  const baseUrl = hostConfig.enabled && hostConfig.networkIPs.length > 0 
    ? `http://${hostConfig.networkIPs[0]}:${hostConfig.port}` 
    : hostConfig.enabled && hostConfig.customHost
    ? `http://${hostConfig.customHost}:${hostConfig.port}`
    : `http://localhost:${hostConfig.port}`;
  console.log(`  - ${baseUrl}/ (HTML)`);
  console.log(`  - ${baseUrl}/react (React)`);
  console.log(`  - ${baseUrl}/svelte (Svelte)`);
  console.log(`  - ${baseUrl}/vue (Vue)`);
  console.log(`  - ${baseUrl}/htmx (HTMX)`);
  
  return {
    stop: async () => {
      for (const watcher of state.watchers) {
        try {
          watcher.close();
        } catch (error) {
          console.error('Error closing watcher:', error);
        }
      }
      state.watchers = [];
      
      console.log('File watching stopped');
      
      if (state.rebuildTimeout) {
        clearTimeout(state.rebuildTimeout);
      }
      
      server.stop();
      console.log('HMR Dev Server stopped');
    }
  };
}