import { readFileSync } from 'node:fs';
import { resolve as PATH_RESOLVE, sep as PATH_SEP, resolve } from 'node:path';
import { env } from 'bun';
import { Elysia } from 'elysia';
import { scopedState } from 'elysia-scoped-state';
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
import { createHMRState } from './clientManager';
import { buildInitialDependencyGraph } from './dependencyGraph';
import { startFileWatching } from './fileWatcher';
import { loadFreshModule } from './freshModuleLoader';
import { getWatchPaths } from './pathUtils';
import { queueFileChange } from './rebuildTrigger';
import { generateSimpleReactHMRClientCode } from './simpleReactHMR';
import { handleClientConnect, handleClientDisconnect, handleHMRMessage } from './webSocket';

/* Build root directory for static file serving */
const ROOT_DIR = PATH_RESOLVE('./example/build');

/* Main entry point for the HMR server - orchestrates everything
   This replaces the old class-based approach with a functional one */
export async function startBunHMRDevServer(config: BuildConfig) {
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
          
          console.log('Initializing HMR client...');
          
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
            console.log('🔍 Detecting framework from path:', path);
            
            if (path === '/react' || path.startsWith('/react/')) {
              console.log('✅ Detected: react');
              return 'react';
            }
            if (path === '/vue' || path.startsWith('/vue/')) {
              console.log('✅ Detected: vue');
              return 'vue';
            }
            if (path === '/svelte' || path.startsWith('/svelte/')) {
              console.log('✅ Detected: svelte');
              return 'svelte';
            }
            if (path === '/htmx' || path.startsWith('/htmx/')) {
              console.log('✅ Detected: htmx');
              return 'htmx';
            }
            if (path === '/' || path === '/html' || path.startsWith('/html/')) {
              console.log('✅ Detected: html');
              return 'html';
            }
            
            console.warn('⚠️ Could not detect framework from path:', path);
            return null;
          }
          
          ws.onopen = function() {
            console.log('HMR client connected');
            isConnected = true;
            // Set HMR active flag when WebSocket connects - this prevents bundle hash check from reloading
            sessionStorage.setItem('__HMR_CONNECTED__', 'true');
            
            // Send ready message with current framework
            const currentFramework = detectCurrentFramework();
            ws.send(JSON.stringify({ 
              type: 'ready',
              framework: currentFramework
            }));
            console.log('📍 Current framework:', currentFramework || 'unknown');
            
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
              console.log('HMR message received:', message.type);
              
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
                  // Don't reload for React, HTML, HTMX, or Vue updates - they're handled via dedicated update messages
                  // Only reload for frameworks that don't have HMR support
                  if (message.data.affectedFrameworks && 
                      !message.data.affectedFrameworks.includes('react') && 
                      !message.data.affectedFrameworks.includes('html') &&
                      !message.data.affectedFrameworks.includes('htmx') &&
                      !message.data.affectedFrameworks.includes('vue') &&
                      !message.data.affectedFrameworks.includes('svelte')) {
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
                    if (message.data.affectedFrameworks?.includes('htmx')) hmrFrameworks.push('HTMX');
                    if (message.data.affectedFrameworks?.includes('vue')) hmrFrameworks.push('Vue');
                    if (message.data.affectedFrameworks?.includes('svelte')) hmrFrameworks.push('Svelte');
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
                  
                  // For frameworks with dedicated HMR handlers, skip version mismatch checking
                  // These updates are handled via dedicated update messages with DOM patching
                  const hasHMRHandler = message.data.framework === 'react' || 
                                       message.data.framework === 'vue' || 
                                       message.data.framework === 'svelte' ||
                                       message.data.framework === 'html' ||
                                       message.data.framework === 'htmx';
                  
                  if (hasHMRHandler) {
                    // Just update versions and manifest, but don't pre-fetch modules or reload
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
                    console.log('✅', message.data.framework, 'module update processed (will be handled by dedicated update message)');
                    break; // Don't reload - dedicated update messages will handle the update
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
                  
                  // Fallback: reload for frameworks without HMR support
                  // React, Vue, Svelte, HTML, and HTMX have dedicated update handlers, so skip reload
                  const hasHMRSupport = message.data.framework === 'react' || 
                                       message.data.framework === 'vue' || 
                                       message.data.framework === 'svelte' ||
                                       message.data.framework === 'html' || 
                                       message.data.framework === 'htmx';
                  
                  if (!hasHMRSupport) {
                    console.log('Module update requires page reload (no HMR support for ' + message.data.framework + ')');
                    window.location.reload();
                  } else {
                    console.log('Module update processed (HMR will handle ' + message.data.framework + ' update)');
                  }
                  break;
                
                case 'react-update':
                  // Check if we're on a React page
                  const currentFramework = detectCurrentFramework();
                  if (currentFramework !== 'react') {
                    console.log('📍 Ignoring React update (currently on ' + (currentFramework || 'unknown') + ' page)');
                    break;
                  }
                  
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
                      console.log('🔄 Re-rendering React with preserved state...');
                      
                      // PRESERVE STATE: Extract ALL component state using automatic framework introspection
                      // This runs INSIDE the message handler, so it won't affect WebSocket initialization
                      let preservedProps = {};
                      try {
                        const { extractStateAutomatically } = await import('../dev/statePreservation');
                        preservedProps = await extractStateAutomatically(container);
                        
                        if (Object.keys(preservedProps).length > 0) {
                          window.__HMR_PRESERVED_STATE__ = preservedProps;
                          console.log('📦 Automatically extracted React state:', window.__HMR_PRESERVED_STATE__);
                        }
                      } catch (error) {
                        console.warn('⚠️ Automatic state extraction failed, using fallback pattern matching:', error);
                        
                        // Fallback: manual pattern matching
                        const button = container.querySelector('button');
                        if (button && button.textContent) {
                          const countMatch = button.textContent.match(/count is (\\d+)/);
                          if (countMatch) {
                            preservedProps = { initialCount: parseInt(countMatch[1], 10) };
                            window.__HMR_PRESERVED_STATE__ = preservedProps;
                            console.log('📦 Fallback: Preserved counter state:', preservedProps);
                          }
                        }
                      }
                      
                      // Simple approach: Re-import the React component and re-render
                      const componentPath = message.data.manifest?.ReactExample || '/react/pages/ReactExample.tsx';
                      const modulePath = componentPath + '?t=' + Date.now();
                      
                      console.log('🔄 Re-importing React component:', modulePath);
                      
                      import(/* @vite-ignore */ modulePath)
                        .then(async (module) => {
                          const Component = module.default || module.ReactExample;
                          
                          if (Component && window.__REACT_ROOT__) {
                            // Re-render using the existing React root with preserved state
                            const React = await import('react');
                            const mergedProps = { ...(window.__INITIAL_PROPS__ || {}), ...(window.__HMR_PRESERVED_STATE__ || {}) };
                            
                            // Simple re-render - React handles the rest
                            window.__REACT_ROOT__.render(React.createElement(Component, mergedProps));
                            console.log('✅ React re-rendered with preserved state');
                            
                            sessionStorage.removeItem('__HMR_ACTIVE__');
                          } else {
                            throw new Error('Component or root not found');
                          }
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
                  // Check if we're on an HTML page
                  const htmlFrameworkCheck = detectCurrentFramework();
                  if (htmlFrameworkCheck !== 'html') {
                    console.log('📍 Ignoring HTML update (currently on ' + (htmlFrameworkCheck || 'unknown') + ' page)');
                    console.log('📍 URL path is:', window.location.pathname);
                    break;
                  }
                  
                  console.log('🔄 HTML update received:', message.data.sourceFile);
                  console.log('✅ On HTML page, processing update');
                  
                  // Clear React globals if they exist (prevents interference from previous React page)
                  if (window.__REACT_ROOT__) {
                    console.log('🗑️ Clearing React globals (navigated away from React)');
                    window.__REACT_ROOT__ = undefined;
                  }
                  
                  // Set HMR active flag to prevent bundle hash check from triggering reload
                  sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                  
                  // Simple DOM patching with new HTML from server
                  if (message.data.html) {
                    const container = document.body;
                    if (container) {
                      console.log('🔄 Patching DOM with new HTML...');
                      console.log('📦 HTML length:', message.data.html.length);
                      console.log('📦 Body before patch:', container.innerHTML.length, 'chars');
                      
                      // PRESERVE STATE: Save form data and scroll position before patching
                      const savedState = {
                        forms: saveFormState(),
                        scroll: saveScrollState()
                      };
                      
                      // Extract counter state from DOM before patching
                      const counterSpan = container.querySelector('#counter');
                      const counterValue = counterSpan ? parseInt(counterSpan.textContent || '0', 10) : 0;
                      savedState.componentState = { count: counterValue };
                      console.log('📦 Preserved HTML counter state:', counterValue);
                      
                      // Store counter state in a global so scripts can access it
                      window.__HTML_COUNTER_STATE__ = counterValue;
                      
                      // CRITICAL: Store existing compiled script elements before patching
                      // We need to preserve these because the new HTML has TypeScript source paths
                      const existingScripts = Array.from(container.querySelectorAll('script[src]')).map((script) => ({
                        src: script.getAttribute('src') || '',
                        type: script.getAttribute('type') || 'text/javascript'
                      }));
                      console.log('📦 Stored existing compiled scripts:', existingScripts.length);
                      
                      // For HTML files, we need to preserve the HMR client script
                      // Extract and store HMR script before patching
                      const hmrScript = container.querySelector('script[data-hmr-client]');
                      console.log('📦 HMR script found:', !!hmrScript);
                      
                      // Patch the DOM with new content
                      console.log('📦 HTML content preview (first 500 chars):', message.data.html.substring(0, 500));
                      container.innerHTML = message.data.html;
                      console.log('✅ HTML updated via DOM patch');
                      console.log('📦 Body after patch:', container.innerHTML.length, 'chars');
                      console.log('📦 h1 content after patch:', container.querySelector('h1')?.textContent || 'NOT FOUND');
                      
                      // Re-append HMR script if it was present
                      if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
                        container.appendChild(hmrScript);
                        console.log('✅ HMR script restored after patch');
                      }
                      
                      // RESTORE STATE: Restore form data, scroll position, and counter state
                      requestAnimationFrame(() => {
                        restoreFormState(savedState.forms);
                        restoreScrollState(savedState.scroll);
                        
                        // Restore counter state in DOM
                        const newCounterSpan = container.querySelector('#counter');
                        if (newCounterSpan && savedState.componentState.count !== undefined) {
                          newCounterSpan.textContent = String(savedState.componentState.count);
                          console.log('📦 Restored counter display:', savedState.componentState.count);
                        }
                        
                        // Remove any script tags from the patched HTML (they have TypeScript source paths)
                        const scriptsInNewHTML = container.querySelectorAll('script[src]');
                        scriptsInNewHTML.forEach((script) => {
                          script.remove();
                        });
                        console.log('🗑️ Removed', scriptsInNewHTML.length, 'script tag(s) from patched HTML');
                        
                        // Clear the script initialization flag so script can re-run after patching
                        window.__HTML_SCRIPT_INITIALIZED__ = false;
                        console.log('🔄 Cleared script initialization flag for re-initialization');
                        
                        // Re-append the existing compiled scripts with cache busting to trigger re-execution
                        existingScripts.forEach((scriptInfo) => {
                          const newScript = document.createElement('script');
                          // Add cache buster to force reload
                          const separator = scriptInfo.src.includes('?') ? '&' : '?';
                          newScript.src = scriptInfo.src + separator + 't=' + Date.now();
                          newScript.type = scriptInfo.type;
                          container.appendChild(newScript);
                          console.log('📦 Re-appended compiled script:', scriptInfo.src);
                        });
                        
                        // Re-execute inline scripts
                        const inlineScripts = container.querySelectorAll('script:not([src])');
                        inlineScripts.forEach((script) => {
                          const newScript = document.createElement('script');
                          newScript.textContent = script.textContent || '';
                          newScript.type = script.type || 'text/javascript';
                          script.parentNode?.replaceChild(newScript, script);
                        });
                        
                        console.log('✅ State preserved across HTML update');
                      });
                      
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

                case 'htmx-update':
                  // Check if we're on an HTMX page
                  const htmxFrameworkCheck = detectCurrentFramework();
                  if (htmxFrameworkCheck !== 'htmx') {
                    console.log('📍 Ignoring HTMX update (currently on ' + (htmxFrameworkCheck || 'unknown') + ' page)');
                    console.log('📍 URL path is:', window.location.pathname);
                    break;
                  }
                  
                  console.log('🔄 HTMX update received:', message.data.sourceFile);
                  console.log('✅ On HTMX page, processing update');
                  
                  // Clear React globals if they exist (prevents interference from previous React page)
                  if (window.__REACT_ROOT__) {
                    console.log('🗑️ Clearing React globals (navigated away from React)');
                    window.__REACT_ROOT__ = undefined;
                  }
                  
                  sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                  
                  if (message.data.html) {
                    const container = document.body;
                    if (container) {
                      console.log('🔄 Patching DOM with new HTMX HTML...');
                      console.log('📦 HTML length:', message.data.html.length);
                      console.log('📦 Body before patch:', container.innerHTML.length, 'chars');
                      
                      // PRESERVE STATE: Save form data and scroll position before patching
                      const savedState = {
                        forms: saveFormState(),
                        scroll: saveScrollState()
                      };
                      
                      // Extract counter state from DOM before patching
                      const countSpan = container.querySelector('#count');
                      const countValue = countSpan ? parseInt(countSpan.textContent || '0', 10) : 0;
                      savedState.componentState = { count: countValue };
                      console.log('📦 Preserved HTMX counter state:', countValue);
                      
                      // CRITICAL: Update server-side state to match client state
                      // HTMX uses server-side state, so we need to sync it before patching
                      // Send a POST request to update the server-side counter
                      if (savedState.componentState.count !== undefined && savedState.componentState.count > 0) {
                        console.log('🔄 Syncing server-side HTMX state...');
                        fetch('/htmx/sync-count', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ count: savedState.componentState.count })
                        }).then(() => {
                          console.log('✅ Server-side HTMX state synced');
                        }).catch((error) => {
                          console.warn('⚠️ Failed to sync server-side HTMX state:', error);
                        });
                      }
                      // Preserve HMR client script before patching
                      const hmrScript = container.querySelector('script[data-hmr-client]');
                      console.log('📦 HMR script found:', !!hmrScript);
                      
                      container.innerHTML = message.data.html;
                      console.log('✅ HTMX content updated via DOM patch');
                      console.log('📦 Body after patch:', container.innerHTML.length, 'chars');
                      
                      // Re-append HMR script if it was present
                      if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
                        container.appendChild(hmrScript);
                        console.log('✅ HMR script restored after patch');
                      }
                      
                      // RESTORE STATE: Restore form data, scroll position, and counter state
                      requestAnimationFrame(() => {
                        restoreFormState(savedState.forms);
                        restoreScrollState(savedState.scroll);
                        
                        // Restore counter state in DOM
                        const newCountSpan = container.querySelector('#count');
                        if (newCountSpan && savedState.componentState.count !== undefined) {
                          newCountSpan.textContent = String(savedState.componentState.count);
                          console.log('📦 Restored counter display:', savedState.componentState.count);
                        }
                        
                        // Re-initialize HTMX after DOM patch
                        // HTMX needs to be re-initialized to attach event handlers to new DOM
                        if (typeof window !== 'undefined' && window.htmx) {
                          window.htmx.process(document.body);
                          console.log('✅ HTMX re-initialized after DOM patch');
                        } else if (typeof window !== 'undefined' && window.htmx === undefined) {
                          // HTMX might not be loaded yet, try to load it
                          const htmxScript = document.querySelector('script[src*="htmx"]');
                          if (htmxScript) {
                            const newScript = document.createElement('script');
                            newScript.src = htmxScript.getAttribute('src') || '';
                            newScript.onload = () => {
                              if (window.htmx) {
                                window.htmx.process(document.body);
                                console.log('✅ HTMX loaded and initialized');
                              }
                            };
                            document.head.appendChild(newScript);
                          }
                        }
                        
                        console.log('✅ State preserved across HTMX update');
                      });
                      
                      if (container.innerHTML.trim().length === 0) {
                        console.error('❌ HTMX DOM patch resulted in empty body - this should not happen');
                      } else {
                        console.log('✅ HTMX DOM patch verified - body has content');
                      }
                      
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    } else {
                      console.error('❌ document.body not found - this should never happen');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    }
                  } else {
                    console.warn('⚠️ No HTML in HTMX update');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                    console.error('❌ Failed to update HTMX - no HTML provided');
                  }
                  break;
                
                case 'svelte-update':
                  // Check if we're on a Svelte page
                  const svelteFrameworkCheck = detectCurrentFramework();
                  console.log('🔍 Svelte update: detected framework =', svelteFrameworkCheck);
                  console.log('🔍 Svelte update: URL =', window.location.href);
                  console.log('🔍 Svelte update: has __SVELTE_COMPONENT__ =', !!window.__SVELTE_COMPONENT__);
                  console.log('🔍 Svelte update: has __REACT_ROOT__ =', !!window.__REACT_ROOT__);
                  
                  if (svelteFrameworkCheck !== 'svelte') {
                    console.log('📍 Ignoring Svelte update (currently on ' + (svelteFrameworkCheck || 'unknown') + ' page)');
                    console.log('📍 URL path is:', window.location.pathname);
                    break;
                  }
                  
                  console.log('✅ Svelte update: Passed framework check, processing update');
                  console.log('🔄 Svelte update received:', message.data.sourceFile);
                  
                  // CRITICAL: Double-check we're actually on Svelte page
                  if (!window.location.pathname.includes('/svelte')) {
                    console.error('❌ URL does not include /svelte - ABORTING');
                    console.error('❌ Current URL:', window.location.href);
                    break;
                  }
                  
                  console.log('✅ URL verification passed');
                  
                  // Clear React globals if they exist (prevents interference from previous React page)
                  if (window.__REACT_ROOT__) {
                    console.log('🗑️ Clearing React globals (navigated away from React)');
                    window.__REACT_ROOT__ = undefined;
                  }
                  
                  // Set HMR active flag to prevent bundle hash check from triggering reload
                  sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                  
                  // Simple DOM patching with new HTML from server
                  if (message.data.html) {
                    console.log('🔄 Re-mounting Svelte with preserved state...');
                    
                    // PRESERVE STATE: Simple pattern matching (reliable and works)
                    const button = document.body.querySelector('button');
                    let initialCount = 0;
                    if (button && button.textContent) {
                      const countMatch = button.textContent.match(/count is (\\d+)/);
                      if (countMatch) {
                        initialCount = parseInt(countMatch[1], 10);
                        console.log('📦 Preserved Svelte counter state:', initialCount);
                      }
                    }
                    
                    // Store preserved state
                    window.__HMR_PRESERVED_STATE__ = { initialCount };
                    console.log('📦 Stored Svelte preserved state:', window.__HMR_PRESERVED_STATE__);
                    
                    // Set HMR update flag BEFORE destroying component
                    // This tells the index file to use mount() instead of hydrate()
                    window.__SVELTE_HMR_UPDATE__ = true;
                    
                    // Destroy existing Svelte component
                    if (window.__SVELTE_COMPONENT__ && typeof window.__SVELTE_COMPONENT__.$destroy === 'function') {
                      console.log('🔄 Destroying existing Svelte component...');
                      try {
                        window.__SVELTE_COMPONENT__.$destroy();
                        console.log('✅ Existing Svelte component destroyed');
                      } catch (error) {
                        console.warn('⚠️ Error destroying Svelte component:', error);
                      }
                      window.__SVELTE_COMPONENT__ = undefined;
                    }
                    
                    // Don't clear body here - let the index file handle it synchronously before mount
                    
                    // Re-import index to mount with preserved state
                    const indexPath = message.data.manifest?.SvelteExampleIndex;
                    if (indexPath) {
                      const normalizedPath = indexPath.startsWith('/') ? indexPath : '/' + indexPath;
                      const modulePath = normalizedPath + '?t=' + Date.now();
                      
                      console.log('🔄 Re-importing Svelte index:', modulePath);
                      import(/* @vite-ignore */ modulePath)
                        .then(() => {
                          console.log('✅ Svelte component re-mounted with preserved state');
                          sessionStorage.removeItem('__HMR_ACTIVE__');
                        })
                        .catch((error) => {
                          console.error('❌ Failed to re-mount Svelte:', error);
                          console.error('Module path:', modulePath);
                          sessionStorage.removeItem('__HMR_ACTIVE__');
                          // Don't reload - just log the error to avoid unwanted navigation
                          console.error('⚠️ Svelte HMR update failed - manual reload may be needed');
                        });
                    } else {
                      console.warn('⚠️ No SvelteExampleIndex found in manifest');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    }
                  } else {
                    console.warn('⚠️ No HTML in Svelte update');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                  }
                  break;
                
                case 'vue-update':
                  // Check if we're on a Vue page
                  const vueFrameworkCheck = detectCurrentFramework();
                  if (vueFrameworkCheck !== 'vue') {
                    console.log('📍 Ignoring Vue update (currently on ' + (vueFrameworkCheck || 'unknown') + ' page)');
                    console.log('📍 URL path is:', window.location.pathname);
                    break;
                  }
                  
                  console.log('🔄 Vue update received:', message.data.sourceFile);
                  console.log('✅ On Vue page, processing update');
                  
                  // Clear React globals if they exist (prevents interference from previous React page)
                  if (window.__REACT_ROOT__) {
                    console.log('🗑️ Clearing React globals (navigated away from React)');
                    window.__REACT_ROOT__ = undefined;
                  }
                  console.log('✅ On Vue page, processing update');
                  
                  // Set HMR active flag to prevent bundle hash check from triggering reload
                  sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                  
                  // Simple DOM patching with new HTML from server
                  if (message.data.html) {
                    // Vue renders to <div id="root"> inside <body>
                    const rootContainer = document.getElementById('root');
                    const bodyContainer = document.body;
                    
                    if (rootContainer || bodyContainer) {
                      console.log('🔄 Re-mounting Vue with preserved state...');
                      
                      // PRESERVE STATE: Simple pattern matching (reliable and works)
                      const button = (rootContainer || bodyContainer)?.querySelector('button');
                      let initialCount = 0;
                      if (button && button.textContent) {
                        const countMatch = button.textContent.match(/count is (\\d+)/);
                        if (countMatch) {
                          initialCount = parseInt(countMatch[1], 10);
                          console.log('📦 Preserved Vue counter state:', initialCount);
                        }
                      }
                      
                      // Store preserved state
                      window.__HMR_PRESERVED_STATE__ = { initialCount };
                      
                      // DON'T unmount Vue - just keep the DOM and re-mount will update it
                      // Unmounting removes styles and breaks event handlers
                      console.log('📦 Skipping unmount - Vue will update in place');
                      
                      // Re-import the Vue client bundle to re-mount the Vue app
                      const indexPath = message.data.manifest?.VueExampleIndex;
                      
                      if (indexPath) {
                        const normalizedPath = indexPath.startsWith('/') ? indexPath : '/' + indexPath;
                        const modulePath = normalizedPath + '?t=' + Date.now();
                        
                        console.log('🔄 Re-importing Vue index:', modulePath);
                        import(/* @vite-ignore */ modulePath)
                          .then(() => {
                            console.log('✅ Vue app re-mounted with preserved state');
                            sessionStorage.removeItem('__HMR_ACTIVE__');
                          })
                          .catch((error) => {
                            console.error('❌ Failed to re-mount Vue:', error);
                            sessionStorage.removeItem('__HMR_ACTIVE__');
                            window.location.reload();
                          });
                      } else {
                        console.warn('⚠️ No VueExampleIndex found in manifest');
                        sessionStorage.removeItem('__HMR_ACTIVE__');
                      }
                    } else {
                      console.error('❌ No root container or body found - this should never happen');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    }
                  } else {
                    console.warn('⚠️ No HTML in Vue update');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
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
          
          const props: Record<string, string | number> = {
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
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Content-Type': 'text/html', 'Expires': '0', 'Pragma': 'no-cache'
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
                // Ensure JavaScript files are served with the correct MIME type for ES modules
                headers['Content-Type'] = 'application/javascript';
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
    .use(
      scopedState({
        count: { value: 0 }
      })
    )
    .ws('/hmr', {
      close: (websocket) => handleClientDisconnect(state, websocket), message: (websocket, message) => {
        handleHMRMessage(state, websocket, message);
      }, open: (websocket) => handleClientConnect(state, websocket, manifest)
    })
    // HTMX endpoints for server-side counter state
    .post('/htmx/reset', ({ resetScopedStore }) => resetScopedStore())
    .get('/htmx/count', ({ scopedStore }) => scopedStore.count)
    .post('/htmx/increment', ({ scopedStore }) => ++scopedStore.count)
    .post('/htmx/sync-count', async ({ request, scopedStore }) => {
      try {
        const body = await request.json();
        if (body && typeof body.count === 'number') {
          scopedStore.count = body.count;
          console.log('📦 Synced HTMX server-side count to:', body.count);
          return new Response(JSON.stringify({ success: true, count: scopedStore.count }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ success: false, error: 'Invalid count' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error syncing HTMX count:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to sync' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    })
    .get('*', handleRequest)
    .listen({
      hostname: config.host ?? (env.HOST ?? 'localhost'),
      port: config.port ?? (env.PORT ? Number(env.PORT) : 3000)
    });
  
  const rebuildCallback = async (newManifest: Record<string, string>) => {
    manifest = newManifest;
  };
  
  startFileWatching(state, config, (filePath: string) => {
    queueFileChange(state, filePath, config, rebuildCallback);
  });
  
  const port = config.port ?? (env.PORT ? Number(env.PORT) : 3000);
  const baseUrl = `http://localhost:${port}`;
  
  console.log('Bun HMR Dev Server started');
  console.log(`➜  Local:   ${baseUrl}/`);
  console.log(`➜  WebSocket: ws://localhost:${port}/hmr`);
  console.log('File watching: Active');
  console.log('Available routes:');
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