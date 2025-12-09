import { Elysia } from 'elysia';
import { build } from '../core/build';
import type { BuildConfig } from '../types';
import { createHMRState, type HMRState } from './clientManager';
import { buildInitialDependencyGraph } from './dependencyGraph';
import { startFileWatching } from './fileWatcher';
import { getWatchPaths } from './pathUtils';
import { queueFileChange } from './rebuildTrigger';
import { generateSimpleReactHMRClientCode } from './simpleReactHMR';
import { handleClientConnect, handleClientDisconnect, handleHMRMessage } from './webSocket';

/* Development mode function - replaces build() during development
   Returns both the manifest and HMR state for use with the hmr() plugin */
export async function dev(config: BuildConfig): Promise<{
  manifest: Record<string, string>;
  hmrState: HMRState;
}> {
  // Create initial HMR state with config
  const state = createHMRState(config);
  
  // Initialize dependency graph by scanning all source files
  const watchPaths = getWatchPaths(config);
  buildInitialDependencyGraph(state.dependencyGraph, watchPaths);
  
  console.log('🔨 Building AbsoluteJS with HMR...');
  
  // Initial build
  const manifest = await build({
    ...config,
    options: {
      ...config.options,
      preserveIntermediateFiles: true
    }
  });
  
  if (!manifest) {
    throw new Error('Build failed - no manifest generated');
  }
  
  console.log('✅ Build completed successfully');
  
  // Start file watching with callback to update manifest
  // We use a reference so the manifest object can be updated in-place
  let manifestRef = manifest;
  startFileWatching(state, config, (filePath: string) => {
    queueFileChange(state, filePath, config, (newManifest) => {
      // Update the manifest in-place so the hmr() plugin always has the latest
      Object.assign(manifestRef, newManifest);
    });
  });
  
  console.log('👀 File watching: Active');
  console.log('🔥 HMR: Ready');
  
  return { manifest: manifestRef, hmrState: state };
}

/* HMR plugin for Elysia
   Adds WebSocket endpoint and status endpoint for HMR */
export function hmr(hmrState: HMRState, manifest: Record<string, string>) {
  console.log('🔥 HMR plugin: Initializing with', hmrState.connectedClients.size, 'connected clients');
  return (app: Elysia) => {
    console.log('🔥 HMR plugin: Applying to Elysia app');
    return app
    // WebSocket route for HMR updates
    .ws('/hmr', {
      open: (ws) => handleClientConnect(hmrState, ws, manifest),
      message: (ws, msg) => handleHMRMessage(hmrState, ws, msg),
      close: (ws) => handleClientDisconnect(hmrState, ws)
    })
    // Status endpoint for debugging
    .get('/hmr-status', () => ({
      connectedClients: hmrState.connectedClients.size,
      isRebuilding: hmrState.isRebuilding,
      manifestKeys: Object.keys(manifest),
      rebuildQueue: Array.from(hmrState.rebuildQueue),
      timestamp: Date.now()
    }))
    // Intercept and inject HMR client into HTML responses
    .onAfterHandle(async (context) => {
      const { response } = context;
      
      // Only process Response objects with HTML content
      if (response instanceof Response) {
        const contentType = response.headers.get('content-type');
        console.log('🔍 HMR onAfterHandle: content-type =', contentType);
        if (contentType?.includes('text/html')) {
          try {
            console.log('✅ Injecting HMR client into HTML response');
            // Read the entire response body (including streams)
            const html = await response.text();
            const htmlWithHMR = injectHMRClient(html);
            
            // Return new Response with injected HMR client
            return new Response(htmlWithHMR, {
              status: response.status,
              statusText: response.statusText,
              headers: {
                ...Object.fromEntries(response.headers),
                'content-type': contentType
              }
            });
          } catch (error) {
            console.error('❌ Error injecting HMR client:', error);
            return response;
          }
        }
      }
      
      return response;
    });
  };
}

/* Inject HMR client script into HTML
   This function contains all the client-side HMR code */
function injectHMRClient(html: string): string {
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
        }
        
        // State Preservation Utilities
        // These functions save and restore frontend state across HMR updates
        function saveFormState() {
          const formState = {};
          const forms = document.querySelectorAll('form');
          forms.forEach((form, formIndex) => {
            const formId = form.id || 'form-' + formIndex;
            formState[formId] = {};
            const inputs = form.querySelectorAll('input, textarea, select');
            inputs.forEach((input) => {
              const element = input;
              const name = element.name || element.id || 'input-' + formIndex + '-' + inputs.length;
              if (element.type === 'checkbox' || element.type === 'radio') {
                formState[formId][name] = element.checked;
              } else {
                formState[formId][name] = element.value;
              }
            });
          });
          const standaloneInputs = document.querySelectorAll('input:not(form input), textarea:not(form textarea), select:not(form select)');
          if (standaloneInputs.length > 0) {
            formState['__standalone__'] = {};
            standaloneInputs.forEach((input) => {
              const element = input;
              const name = element.name || element.id || 'standalone-' + standaloneInputs.length;
              if (element.type === 'checkbox' || element.type === 'radio') {
                formState['__standalone__'][name] = element.checked;
              } else {
                formState['__standalone__'][name] = element.value;
              }
            });
          }
          return formState;
        }
        
        function restoreFormState(formState) {
          Object.keys(formState).forEach((formId) => {
            const isStandalone = formId === '__standalone__';
            const form = isStandalone ? null : document.getElementById(formId) || document.querySelector('form:nth-of-type(' + (parseInt(formId.replace('form-', '')) + 1) + ')');
            Object.keys(formState[formId]).forEach((name) => {
              let element = null;
              if (isStandalone) {
                element = document.querySelector('input[name="' + name + '"], textarea[name="' + name + '"], select[name="' + name + '"]');
                if (!element) {
                  element = document.getElementById(name);
                }
              } else if (form) {
                element = form.querySelector('[name="' + name + '"], #' + name);
              }
              if (element) {
                const value = formState[formId][name];
                if (element.type === 'checkbox' || element.type === 'radio') {
                  element.checked = value === true;
                } else {
                  element.value = String(value);
                }
              }
            });
          });
        }
        
        function saveScrollState() {
          return {
            window: {
              x: window.scrollX || window.pageXOffset,
              y: window.scrollY || window.pageYOffset
            }
          };
        }
        
        function restoreScrollState(scrollState) {
          if (scrollState && scrollState.window) {
            window.scrollTo(scrollState.window.x, scrollState.window.y);
          }
        }
        
        // Simple React HMR Client Handler
        ${generateSimpleReactHMRClientCode()}
        
        
        // Determine WebSocket URL (use client's current hostname and port)
        const wsHost = location.hostname;
        const wsPort = location.port || (location.protocol === 'https:' ? '443' : '80');
        const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = \`\${wsProtocol}://\${wsHost}:\${wsPort}/hmr\`;
        
        const ws = new WebSocket(wsUrl);
        let reconnectTimeout;
        let pingInterval;
        let isConnected = false;
        let isHMRUpdating = false; // Track if HMR update is in progress
        
        // Detect which framework page we're currently on
        function detectCurrentFramework() {
          // CRITICAL: Use URL path as the ONLY source of truth
          // Never rely on globals as they persist across navigation
          const path = window.location.pathname;
          
          // Check for framework-specific paths first
          if (path === '/vue' || path.startsWith('/vue/')) {
            return 'vue';
          }
          if (path === '/svelte' || path.startsWith('/svelte/')) {
            return 'svelte';
          }
          if (path === '/htmx' || path.startsWith('/htmx/')) {
            return 'htmx';
          }
          if (path === '/html' || path.startsWith('/html/')) {
            return 'html';
          }
          
          // Check if React root exists - if so, this is a React page
          if (window.__REACT_ROOT__) {
            return 'react';
          }
          
          // Fallback: check path
          if (path === '/react' || path.startsWith('/react/') || path === '/') {
            return 'react';
          }
          
          return null;
        }
        
        ws.onopen = function() {
          isConnected = true;
          console.log('🔥 HMR connected');
          // Set HMR active flag when WebSocket connects - this prevents bundle hash check from reloading
          sessionStorage.setItem('__HMR_CONNECTED__', 'true');
          
          // Send ready message with current framework
          const currentFramework = detectCurrentFramework();
          ws.send(JSON.stringify({ 
            type: 'ready',
            framework: currentFramework
          }));
          
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
        
        ws.onmessage = async function(event) {
          try {
            const message = JSON.parse(event.data);
            console.log('📨 HMR message received:', message.type);
            
            // Track HMR update state to prevent WebSocket from closing during updates
            if (
              message.type === 'react-update' ||
              message.type === 'html-update' ||
              message.type === 'htmx-update' ||
              message.type === 'vue-update' ||
              message.type === 'svelte-update' ||
              message.type === 'module-update' ||
              message.type === 'rebuild-start'
            ) {
              isHMRUpdating = true;
              // Clear flag after update completes (give it time for DOM patching)
              setTimeout(() => { isHMRUpdating = false; }, 2000);
            }
            
            switch (message.type) {
              case 'manifest':
                window.__HMR_MANIFEST__ = message.data.manifest || message.data;
                
                // Update server versions
                if (message.data.serverVersions) {
                  window.__HMR_SERVER_VERSIONS__ = message.data.serverVersions;
                }
                
                // Initialize client versions if not present
                if (!window.__HMR_MODULE_VERSIONS__) {
                  window.__HMR_MODULE_VERSIONS__ = {};
                }
                
                window.__HMR_MODULE_UPDATES__ = []; // Initialize module updates array
                break;
                
              case 'rebuild-start':
                console.log('🔨 Rebuilding...');
                break;
                
              case 'rebuild-complete':
                console.log('✅ Rebuild complete');
                console.log('🔍 Affected frameworks:', message.data.affectedFrameworks);
                if (window.__HMR_MANIFEST__) {
                  window.__HMR_MANIFEST__ = message.data.manifest;
                }
                // Don't reload for React, HTML, HTMX, Vue, or Svelte - they're handled via dedicated update messages
                // Only reload for frameworks that don't have HMR support
                if (message.data.affectedFrameworks && 
                    !message.data.affectedFrameworks.includes('react') && 
                    !message.data.affectedFrameworks.includes('html') &&
                    !message.data.affectedFrameworks.includes('htmx') &&
                    !message.data.affectedFrameworks.includes('vue') &&
                    !message.data.affectedFrameworks.includes('svelte')) {
                  console.log('🔄 No framework-specific handler, doing full reload');
                  // Force a hard reload to bypass browser cache
                  const url = new URL(window.location.href);
                  url.searchParams.set('_cb', Date.now().toString());
                  window.location.href = url.toString();
                } else {
                  console.log('✅ Framework-specific handler will process update, skipping reload');
                }
                break;
                
              case 'framework-update':
                break;
                
              case 'module-update':
                // For frameworks with dedicated HMR handlers, skip version mismatch checking
                const hasHMRHandler = message.data.framework === 'react' || 
                                     message.data.framework === 'vue' || 
                                     message.data.framework === 'svelte' ||
                                     message.data.framework === 'html' ||
                                     message.data.framework === 'htmx';
                
                if (hasHMRHandler) {
                  // Just update versions and manifest
                  if (message.data.serverVersions) {
                    window.__HMR_SERVER_VERSIONS__ = { ...window.__HMR_SERVER_VERSIONS__, ...message.data.serverVersions };
                  }
                  if (message.data.moduleVersions) {
                    window.__HMR_MODULE_VERSIONS__ = { ...window.__HMR_MODULE_VERSIONS__, ...message.data.moduleVersions };
                  }
                  if (message.data.manifest) {
                    window.__HMR_MANIFEST__ = { ...window.__HMR_MANIFEST__, ...message.data.manifest };
                  }
                  if (!window.__HMR_MODULE_UPDATES__) {
                    window.__HMR_MODULE_UPDATES__ = [];
                  }
                  window.__HMR_MODULE_UPDATES__.push(message.data);
                  break;
                }
                
                // For frameworks without HMR handlers, do full reload
                window.location.reload();
                break;
              
              case 'react-update':
                const currentFramework = detectCurrentFramework();
                console.log('🔍 Client: Received react-update, detected framework:', currentFramework);
                console.log('🔍 Client: window.__REACT_ROOT__ exists?', !!window.__REACT_ROOT__);
                console.log('🔍 Client: Current path:', window.location.pathname);
                
                if (currentFramework !== 'react') {
                  console.log('❌ Client: Not a React page, ignoring react-update.');
                  break;
                }
                
                console.log('⚛️ Updating React component...');
                sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                
                if (message.data.html) {
                  const container = document.body;
                  if (container) {
                    // PRESERVE STATE: Extract component state from DOM
                    let preservedProps = {};
                    const button = container.querySelector('button');
                    if (button && button.textContent) {
                      const countMatch = button.textContent.match(/count is (\\d+)/);
                      if (countMatch) {
                        preservedProps = { initialCount: parseInt(countMatch[1], 10) };
                        window.__HMR_PRESERVED_STATE__ = preservedProps;
                        console.log('💾 Preserved React counter state:', preservedProps.initialCount);
                      }
                    }
                    
                    // Re-import the updated index file (contains the fresh component)
                    const indexPath = message.data.manifest?.ReactExampleIndex;
                    console.log('🔍 Client: Importing updated index:', indexPath);
                    
                    if (!indexPath) {
                      console.error('❌ No ReactExampleIndex in manifest, falling back to DOM replacement');
                      container.innerHTML = message.data.html;
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                      return;
                    }
                    
                    const modulePath = indexPath + '?hmr=' + Date.now();
                    
                    import(/* @vite-ignore */ modulePath)
                      .then(async (module) => {
                        console.log('✅ Module imported, re-rendering...');
                        const Component = module.default || module.ReactExample;
                        
                        if (Component && window.__REACT_ROOT__) {
                          const React = await import('react');
                          const mergedProps = { ...(window.__INITIAL_PROPS__ || {}), ...(window.__HMR_PRESERVED_STATE__ || {}) };
                          
                          window.__REACT_ROOT__.render(React.createElement(Component, mergedProps));
                          sessionStorage.removeItem('__HMR_ACTIVE__');
                          console.log('✅ React component updated');
                        } else {
                          console.warn('⚠️ Component or root not found, falling back to DOM replacement');
                          container.innerHTML = message.data.html;
                          sessionStorage.removeItem('__HMR_ACTIVE__');
                        }
                      })
                      .catch((error) => {
                        console.error('❌ Failed to import/render:', error);
                        console.log('📝 Falling back to DOM replacement');
                        container.innerHTML = message.data.html;
                        sessionStorage.removeItem('__HMR_ACTIVE__');
                      });
                  }
                }
                break;
              
              case 'html-update':
                const htmlFrameworkCheck = detectCurrentFramework();
                if (htmlFrameworkCheck !== 'html') {
                  console.log('❌ Client: Not an HTML page, ignoring html-update.');
                  break;
                }
                
                // Clear React globals if they exist (prevents interference from previous React page)
                if (window.__REACT_ROOT__) {
                  window.__REACT_ROOT__ = undefined;
                }
                
                sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                
                if (message.data.html) {
                  const container = document.body;
                  if (container) {
                    // PRESERVE STATE: Extract counter from DOM
                    const counterSpan = container.querySelector('#counter');
                    const counterValue = counterSpan ? parseInt(counterSpan.textContent || '0', 10) : 0;
                    
                    const savedState = {
                      forms: saveFormState(),
                      scroll: saveScrollState(),
                      componentState: { count: counterValue }
                    };
                    
                    // Store counter state globally for the TypeScript file to read
                    window.__HTML_COUNTER_STATE__ = counterValue;
                    
                    // Store existing compiled script elements
                    const existingScripts = Array.from(container.querySelectorAll('script[src]')).map((script) => ({
                      src: script.getAttribute('src') || '',
                      type: script.getAttribute('type') || 'text/javascript'
                    }));
                    
                    // Preserve HMR client script
                    const hmrScript = container.querySelector('script[data-hmr-client]');
                    
                    // Patch the DOM
                    container.innerHTML = message.data.html;
                    
                    // Re-append HMR script
                    if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
                      container.appendChild(hmrScript);
                    }
                    
                    // RESTORE STATE
                    requestAnimationFrame(() => {
                      restoreFormState(savedState.forms);
                      restoreScrollState(savedState.scroll);
                      
                      // Restore counter state
                      const newCounterSpan = container.querySelector('#counter');
                      if (newCounterSpan && savedState.componentState.count !== undefined) {
                        newCounterSpan.textContent = String(savedState.componentState.count);
                      }
                      
                      // Remove script tags with TypeScript source paths
                      const scriptsInNewHTML = container.querySelectorAll('script[src]');
                      scriptsInNewHTML.forEach((script) => {
                        script.remove();
                      });
                      
                      // Clear script initialization flag
                      window.__HTML_SCRIPT_INITIALIZED__ = false;
                      
                      // Re-append compiled scripts with cache busting
                      existingScripts.forEach((scriptInfo) => {
                        const newScript = document.createElement('script');
                        const separator = scriptInfo.src.includes('?') ? '&' : '?';
                        newScript.src = scriptInfo.src + separator + 't=' + Date.now();
                        newScript.type = scriptInfo.type;
                        container.appendChild(newScript);
                      });
                      
                      // Re-execute inline scripts
                      const inlineScripts = container.querySelectorAll('script:not([src])');
                      inlineScripts.forEach((script) => {
                        const newScript = document.createElement('script');
                        newScript.textContent = script.textContent || '';
                        newScript.type = script.type || 'text/javascript';
                        script.parentNode?.replaceChild(newScript, script);
                      });
                    });
                    
                    console.log('✅ HTML updated via DOM patching');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                  } else {
                    console.error('❌ document.body not found');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                  }
                } else {
                  console.error('❌ No HTML provided in html-update');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                }
                break;
                
              case 'htmx-update':
                const htmxFrameworkCheck = detectCurrentFramework();
                console.log('🔍 Client: Received htmx-update, detected framework:', htmxFrameworkCheck);
                console.log('🔍 Client: Current path:', window.location.pathname);
                
                if (htmxFrameworkCheck !== 'htmx') {
                  console.log('❌ Client: Not an HTMX page, ignoring htmx-update.');
                  break;
                }
                
                console.log('✅ Client: Processing HTMX update...');
                
                // Clear React globals if they exist
                if (window.__REACT_ROOT__) {
                  window.__REACT_ROOT__ = undefined;
                }
                
                sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                
                if (message.data.html) {
                  console.log('📦 Client: HTML data received, length:', message.data.html.length);
                  console.log('📦 Client: HTML preview (first 200 chars):', message.data.html.substring(0, 200));
                  const container = document.body;
                  if (container) {
                    // PRESERVE STATE: Extract counter from DOM
                    const countSpan = container.querySelector('#count');
                    const countValue = countSpan ? parseInt(countSpan.textContent || '0', 10) : 0;
                    
                    const savedState = {
                      forms: saveFormState(),
                      scroll: saveScrollState(),
                      componentState: { count: countValue }
                    };
                    
                    // Sync server-side state (HTMX uses server-side state)
                    if (savedState.componentState.count !== undefined && savedState.componentState.count > 0) {
                      fetch('/htmx/sync-count', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ count: savedState.componentState.count })
                      }).catch((error) => {
                        console.warn('⚠️ Failed to sync server-side HTMX state:', error);
                      });
                    }
                    
                    // Preserve HMR client script
                    const hmrScript = container.querySelector('script[data-hmr-client]');
                    
                    // Patch the DOM
                    container.innerHTML = message.data.html;
                    
                    // Re-append HMR script
                    if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
                      container.appendChild(hmrScript);
                    }
                    
                    // RESTORE STATE
                    requestAnimationFrame(() => {
                      restoreFormState(savedState.forms);
                      restoreScrollState(savedState.scroll);
                      
                      // Restore counter state
                      const newCountSpan = container.querySelector('#count');
                      if (newCountSpan && savedState.componentState.count !== undefined) {
                        newCountSpan.textContent = String(savedState.componentState.count);
                      }
                      
                      // Re-initialize HTMX on new content
                      if (window.htmx) {
                        window.htmx.process(container);
                      }
                    });
                    
                    console.log('✅ HTMX updated via DOM patching');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                  } else {
                    console.error('❌ document.body not found');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                  }
                } else {
                  console.error('❌ No HTML provided in htmx-update');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                }
                break;
                
              case 'svelte-update':
                const svelteFrameworkCheck = detectCurrentFramework();
                console.log('🔍 Client: Received svelte-update, detected framework:', svelteFrameworkCheck);
                
                if (svelteFrameworkCheck !== 'svelte') {
                  console.log('❌ Client: Not a Svelte page, ignoring svelte-update.');
                  break;
                }
                
                console.log('✅ Client: Processing Svelte component update...');
                
                // Clear React globals if they exist
                if (window.__REACT_ROOT__) {
                  window.__REACT_ROOT__ = undefined;
                }
                
                sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                
                try {
                  // Extract and preserve current state from DOM
                  let preservedState = {};
                  const button = document.querySelector('button');
                  if (button) {
                    const countMatch = button.textContent?.match(/count is (\\d+)/);
                    if (countMatch) {
                      preservedState.initialCount = parseInt(countMatch[1], 10);
                      console.log('💾 Preserved Svelte counter state:', preservedState.initialCount);
                    }
                  }
                  
                  // Set HMR flags for the Svelte index file to read
                  // The index file checks for __SVELTE_HMR_UPDATE__ and handles the update itself
                  window.__SVELTE_HMR_UPDATE__ = true;
                  window.__HMR_PRESERVED_STATE__ = preservedState;
                  
                  // Get the new component path from manifest
                  const indexPath = message.data.manifest?.SvelteExampleIndex;
                  if (!indexPath) {
                    console.error('❌ SvelteExampleIndex not found in manifest');
                    window.location.reload();
                    break;
                  }
                  
                  console.log('📦 Importing new Svelte index (self-executing):', indexPath);
                  
                  // Import the index file with cache busting
                  // The index file is self-executing and will:
                  // 1. Read __SVELTE_HMR_UPDATE__ flag
                  // 2. Read __HMR_PRESERVED_STATE__
                  // 3. Use the clone-and-replace technique for zero-flicker updates
                  const modulePath = indexPath + '?hmr=' + Date.now();
                  await import(/* @vite-ignore */ modulePath);
                  
                  console.log('✅ Svelte component hot-swapped successfully!');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                } catch (error) {
                  console.error('❌ Failed to hot-swap Svelte component:', error);
                  console.log('🔄 Falling back to full reload...');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                  window.location.reload();
                }
                break;
                
              case 'vue-update':
                const vueFrameworkCheck = detectCurrentFramework();
                console.log('🔍 Client: Received vue-update, detected framework:', vueFrameworkCheck);
                
                if (vueFrameworkCheck !== 'vue') {
                  console.log('❌ Client: Not a Vue page, ignoring vue-update.');
                  break;
                }
                
                console.log('✅ Client: Processing Vue component update...');
                sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                
                try {
                  // Extract and preserve current state from DOM
                  let preservedState = {};
                  const vueButton = document.querySelector('button');
                  if (vueButton) {
                    const vueCountMatch = vueButton.textContent?.match(/count is (\\d+)/);
                    if (vueCountMatch) {
                      preservedState.initialCount = parseInt(vueCountMatch[1], 10);
                      console.log('💾 Preserved Vue counter state:', preservedState.initialCount);
                    }
                  }
                  
                  // Unmount the old Vue app
                  if (window.__VUE_APP__) {
                    console.log('🔄 Unmounting old Vue app...');
                    window.__VUE_APP__.unmount();
                    window.__VUE_APP__ = null;
                  }
                  
                  // Get the new HTML from the server (sent in the message)
                  const newHTML = message.data.html;
                  if (!newHTML) {
                    console.error('❌ No HTML in vue-update message');
                    window.location.reload();
                    break;
                  }
                  
                  // Extract just the INNER content of the root div (not the root div itself)
                  // The server HTML includes <div id="root">...</div>, but we only want the ...
                  const tempDiv = document.createElement('div');
                  tempDiv.innerHTML = newHTML;
                  const newRootDiv = tempDiv.querySelector('#root');
                  let innerContent = newRootDiv ? newRootDiv.innerHTML : newHTML;
                  
                  // Pre-update the HTML to show the preserved state (eliminates flicker)
                  // Server renders with initialCount: 0, but we want to show the preserved count
                  if (preservedState.initialCount !== undefined) {
                    innerContent = innerContent.replace(
                      /count is 0/g,
                      'count is ' + preservedState.initialCount
                    );
                    console.log('🎯 Pre-updated HTML with preserved count:', preservedState.initialCount);
                  }
                  
                  // Replace the root content with the new server-rendered HTML
                  const root = document.getElementById('root');
                  if (root) {
                    console.log('📝 Replacing root HTML for re-hydration...');
                    root.innerHTML = innerContent;
                  }
                  
                  // Set preserved state for Vue to read
                  window.__HMR_PRESERVED_STATE__ = preservedState;
                  
                  // Get the new Vue index path
                  const indexPath = message.data.manifest?.VueExampleIndex;
                  if (!indexPath) {
                    console.error('❌ VueExampleIndex not found in manifest');
                    window.location.reload();
                    break;
                  }
                  
                  console.log('📦 Importing new Vue index for re-hydration:', indexPath);
                  
                  // Import the new index with cache busting
                  // The index will detect the HTML in root and use createSSRApp to hydrate
                  // This will add the data-v-* attributes needed for scoped styles
                  const modulePath = indexPath + '?hmr=' + Date.now();
                  await import(/* @vite-ignore */ modulePath);
                  
                  console.log('✅ Vue component hot-swapped successfully!');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                } catch (error) {
                  console.error('❌ Failed to hot-swap Vue component:', error);
                  console.log('🔄 Falling back to full reload...');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                  window.location.reload();
                }
                break;
                
              case 'rebuild-error':
                console.error('❌ Rebuild error:', message.data.error);
                break;
                
              case 'pong':
                break;
                
              case 'connected':
                break;
                
              default:
                break;
            }
          } catch (error) {
            console.error('Error processing HMR message:', error);
          }
        };
        
        ws.onclose = function(event) {
          isConnected = false;
          
          if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
          }
          
          if (event.code !== 1000 && event.code !== 1001) {
            console.log('Connection lost, attempting to reconnect in 3 seconds...');
            reconnectTimeout = setTimeout(function() {
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
          if (isHMRUpdating) {
            if (pingInterval) clearInterval(pingInterval);
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            return;
          }
          
          if (pingInterval) clearInterval(pingInterval);
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
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
}

