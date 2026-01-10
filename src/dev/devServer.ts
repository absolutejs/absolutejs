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
      const { response, path } = context;
      console.log('🔍 HMR onAfterHandle triggered for path:', path);
      
      // Only process Response objects with HTML content
      if (response instanceof Response) {
        const contentType = response.headers.get('content-type');
        console.log('🔍 HMR onAfterHandle: content-type =', contentType, 'path =', path);
        if (contentType?.includes('text/html')) {
          try {
            console.log('✅ Injecting HMR client into HTML response for path:', path);
            // Read the entire response body (including streams)
            const html = await response.text();
            const htmlWithHMR = injectHMRClient(html);
            console.log('✅ HMR client injected, WebSocket script present:', htmlWithHMR.includes('WebSocket') ? 'YES' : 'NO');
            
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
        } else {
          console.log('⏭️  Skipping HMR injection - not HTML content type:', contentType);
        }
      } else {
        console.log('⏭️  Skipping HMR injection - not a Response object:', typeof response);
      }
      
      return response;
    });
  };
}

/* Inject HMR client script into HTML
   This function contains all the client-side HMR code */
    function injectHMRClient(html: string): string {
  // Static import map placed in <head> so dynamic imports can resolve immediately
  // We map React to a single CDN ESM copy and set globals so all bundles share the same instance
  const importMap = `
    <script type="importmap" data-react-import-map>
      {
        "imports": {
          "react": "https://esm.sh/react@19?dev",
          "react-dom/client": "https://esm.sh/react-dom@19/client?dev",
          "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime?dev",
          "react/jsx-dev-runtime": "https://esm.sh/react@19/jsx-dev-runtime?dev"
        }
      }
    </script>
    <script type="module" data-react-globals>
      // Ensure a single React instance is shared and exposed globally for HMR
      import React from 'react';
      import * as ReactDOMClient from 'react-dom/client';
      if (!window.React) window.React = React;
      if (!window.ReactDOM) window.ReactDOM = ReactDOMClient;
      // For convenience, also expose default for ReactDOM
      if (!window.ReactDOM.default) window.ReactDOM.default = ReactDOMClient;
      console.log('✅ React globals set from import map');
    </script>
  `;
  
  const hmrScript = `
    <script>
      (function() {
        // DOM diffing/patching function for in-place updates (zero flicker)
        function patchDOMInPlace(oldContainer, newHTML) {
          // Parse new HTML into a temporary container
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = newHTML;
          const newContainer = tempDiv;
          
          // Helper to get element key for matching (id > data-key > tag + index)
          function getElementKey(el, index) {
            if (el.nodeType !== Node.ELEMENT_NODE) return 'text_' + index;
            if (el.id) return 'id_' + el.id;
            if (el.hasAttribute('data-key')) return 'key_' + el.getAttribute('data-key');
            return 'tag_' + el.tagName + '_' + index;
          }
          
          // Helper to update element attributes in place
          function updateElementAttributes(oldEl, newEl) {
            // Update all attributes from new element
            const newAttrs = Array.from(newEl.attributes);
            const oldAttrs = Array.from(oldEl.attributes);
            
            // Preserve runtime HMR attributes (don't remove them during patching)
            const runtimeAttrs = ['data-hmr-listeners-attached'];
            
            // Remove attributes that don't exist in new element (except runtime attributes)
            oldAttrs.forEach(function(oldAttr) {
              if (!newEl.hasAttribute(oldAttr.name) && runtimeAttrs.indexOf(oldAttr.name) === -1) {
                oldEl.removeAttribute(oldAttr.name);
              }
            });
            
            // Add/update attributes from new element (but don't overwrite runtime attributes if they exist)
            newAttrs.forEach(function(newAttr) {
              // Don't set runtime attributes from new HTML if they already exist
              if (runtimeAttrs.indexOf(newAttr.name) !== -1 && oldEl.hasAttribute(newAttr.name)) {
                return; // Preserve existing runtime attribute
              }
              const oldValue = oldEl.getAttribute(newAttr.name);
              if (oldValue !== newAttr.value) {
                oldEl.setAttribute(newAttr.name, newAttr.value);
              }
            });
          }
          
          // Helper to update text content
          function updateTextNode(oldNode, newNode) {
            if (oldNode.nodeValue !== newNode.nodeValue) {
              oldNode.nodeValue = newNode.nodeValue;
            }
          }
          
          // Match children by key instead of index for better accuracy
          function matchChildren(oldChildren, newChildren) {
            const oldMap = new Map();
            const newMap = new Map();
            
            oldChildren.forEach(function(child, i) {
              const key = getElementKey(child, i);
              if (!oldMap.has(key)) {
                oldMap.set(key, []);
              }
              oldMap.get(key).push({ node: child, index: i });
            });
            
            newChildren.forEach(function(child, i) {
              const key = getElementKey(child, i);
              if (!newMap.has(key)) {
                newMap.set(key, []);
              }
              newMap.get(key).push({ node: child, index: i });
            });
            
            return { oldMap, newMap };
          }
          
          // Recursive diff and patch function with key-based matching
          function patchNode(oldNode, newNode, oldParent, newParent) {
            // Text nodes
            if (oldNode.nodeType === Node.TEXT_NODE && newNode.nodeType === Node.TEXT_NODE) {
              updateTextNode(oldNode, newNode);
              return;
            }
            
            // Element nodes
            if (oldNode.nodeType === Node.ELEMENT_NODE && newNode.nodeType === Node.ELEMENT_NODE) {
              const oldEl = oldNode;
              const newEl = newNode;
              
              // If tag names differ, replace the entire element
              if (oldEl.tagName !== newEl.tagName) {
                const clone = newEl.cloneNode(true);
                oldEl.replaceWith(clone);
                return;
              }
              
              // Same tag - update attributes in place (including style, class, id)
              updateElementAttributes(oldEl, newEl);
              
              // Process children with key-based matching
              const oldChildren = Array.from(oldNode.childNodes);
              const newChildren = Array.from(newNode.childNodes);
              
              // Handle scripts specially - preserve HMR script
              function isHMRScript(el) {
                return el.nodeType === Node.ELEMENT_NODE && 
                       el.hasAttribute && 
                       el.hasAttribute('data-hmr-client');
              }
              
              // Filter out HMR script and regular script tags from both
              const oldChildrenFiltered = oldChildren.filter(function(child) {
                return !isHMRScript(child) && 
                       !(child.nodeType === Node.ELEMENT_NODE && child.tagName === 'SCRIPT');
              });
              const newChildrenFiltered = newChildren.filter(function(child) {
                return !isHMRScript(child) && 
                       !(child.nodeType === Node.ELEMENT_NODE && child.tagName === 'SCRIPT');
              });
              
              // Match children by key
              const { oldMap, newMap } = matchChildren(oldChildrenFiltered, newChildrenFiltered);
              
              // Track which old children have been matched
              const matchedOld = new Set();
              
              // First pass: match by key and patch
              newChildrenFiltered.forEach(function(newChild, newIndex) {
                const newKey = getElementKey(newChild, newIndex);
                const oldMatches = oldMap.get(newKey) || [];
                
                if (oldMatches.length > 0) {
                  // Find best match (prefer same position)
                  let bestMatch = null;
                  for (let i = 0; i < oldMatches.length; i++) {
                    if (!matchedOld.has(oldMatches[i].node)) {
                      bestMatch = oldMatches[i];
                      break;
                    }
                  }
                  if (!bestMatch && oldMatches.length > 0) {
                    bestMatch = oldMatches[0];
                  }
                  if (bestMatch && !matchedOld.has(bestMatch.node)) {
                    matchedOld.add(bestMatch.node);
                    patchNode(bestMatch.node, newChild, oldNode, newNode);
                  } else if (oldMatches.length > 0) {
                    // All matches used, create new
                    const clone = newChild.cloneNode(true);
                    oldNode.insertBefore(clone, oldChildrenFiltered[newIndex] || null);
                  }
                } else {
                  // New child - insert at position
                  const clone = newChild.cloneNode(true);
                  oldNode.insertBefore(clone, oldChildrenFiltered[newIndex] || null);
                }
              });
              
              // Remove unmatched old children
              oldChildrenFiltered.forEach(function(oldChild) {
                if (!matchedOld.has(oldChild) && !isHMRScript(oldChild)) {
                  oldChild.remove();
                }
              });
            }
          }
          
          // Start patching from the container level with key-based matching
          const oldChildren = Array.from(oldContainer.childNodes);
          const newChildren = Array.from(newContainer.childNodes);
          
          // Filter out scripts
          const oldChildrenFiltered = oldChildren.filter(function(child) {
            return !(child.nodeType === Node.ELEMENT_NODE && child.tagName === 'SCRIPT' && 
                     !child.hasAttribute('data-hmr-client'));
          });
          const newChildrenFiltered = newChildren.filter(function(child) {
            return !(child.nodeType === Node.ELEMENT_NODE && child.tagName === 'SCRIPT');
          });
          
          // Match by key
          const { oldMap, newMap } = matchChildren(oldChildrenFiltered, newChildrenFiltered);
          const matchedOld = new Set();
          
          // Patch matched children
          newChildrenFiltered.forEach(function(newChild, newIndex) {
            const newKey = getElementKey(newChild, newIndex);
            const oldMatches = oldMap.get(newKey) || [];
            
            if (oldMatches.length > 0) {
              let bestMatch = null;
              for (let i = 0; i < oldMatches.length; i++) {
                if (!matchedOld.has(oldMatches[i].node)) {
                  bestMatch = oldMatches[i];
                  break;
                }
              }
              if (!bestMatch && oldMatches.length > 0) {
                bestMatch = oldMatches[0];
              }
              if (bestMatch && !matchedOld.has(bestMatch.node)) {
                matchedOld.add(bestMatch.node);
                patchNode(bestMatch.node, newChild, oldContainer, newContainer);
              } else {
                const clone = newChild.cloneNode(true);
                oldContainer.insertBefore(clone, oldChildrenFiltered[newIndex] || null);
              }
            } else {
              const clone = newChild.cloneNode(true);
              oldContainer.insertBefore(clone, oldChildrenFiltered[newIndex] || null);
            }
          });
          
          // Remove unmatched old children
          oldChildrenFiltered.forEach(function(oldChild) {
            if (!matchedOld.has(oldChild) && 
                !(oldChild.nodeType === Node.ELEMENT_NODE && oldChild.tagName === 'SCRIPT' && 
                  oldChild.hasAttribute('data-hmr-client'))) {
              oldChild.remove();
            }
          });
        }
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
        function prefetchModules(modulePaths, manifest) {
          const prefetchPromises = [];
          
          for (const modulePath of modulePaths) {
            // Find the manifest key for this path
            let manifestPath = modulePath;
            for (const key in manifest || {}) {
              if (manifest.hasOwnProperty(key)) {
                const path = manifest[key];
                if (path === modulePath || path.includes(modulePath)) {
                  manifestPath = path;
                  break;
                }
              }
            }
            
            // Add cache busting
            const cacheBuster = '?t=' + Date.now();
            const fullPath = manifestPath.startsWith('/') 
              ? manifestPath + cacheBuster
              : '/' + manifestPath + cacheBuster;
            
            // Pre-fetch the module
            prefetchPromises.push(
              import(/* @vite-ignore */ fullPath).catch(function(err) {
                console.warn('Failed to prefetch module:', modulePath, err);
              })
            );
          }
          
          return Promise.all(prefetchPromises);
        }
        
        // State Preservation Utilities
        // These functions save and restore frontend state across HMR updates
        function saveFormState() {
          const formState = {};
          const forms = document.querySelectorAll('form');
          forms.forEach(function(form, formIndex) {
            const formId = form.id || 'form-' + formIndex;
            formState[formId] = {};
            const inputs = form.querySelectorAll('input, textarea, select');
            inputs.forEach(function(input) {
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
            standaloneInputs.forEach(function(input) {
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
          Object.keys(formState).forEach(function(formId) {
            const isStandalone = formId === '__standalone__';
            const form = isStandalone ? null : document.getElementById(formId) || document.querySelector('form:nth-of-type(' + (parseInt(formId.replace('form-', '')) + 1) + ')');
            Object.keys(formState[formId]).forEach(function(name) {
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
        
        // Reload CSS stylesheets when CSS files change
        function reloadCSSStylesheets(manifest) {
          const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
          stylesheets.forEach(function(link) {
            const href = link.getAttribute('href');
            if (!href || href.includes('htmx.min.js')) return; // Skip HTMX script masquerading as stylesheet
            
            // Check if this CSS file is in the manifest (framework CSS files)
            let newHref = null;
            if (manifest) {
              // Try to find matching CSS in manifest by base name
              const baseName = href.split('/').pop().replace(/\\.[^.]*$/, ''); // Get filename without extension
              const manifestKey = baseName.split('-').map(function(part) {
                return part.charAt(0).toUpperCase() + part.slice(1);
              }).join('') + 'CSS';
              
              if (manifest[manifestKey]) {
                newHref = manifest[manifestKey];
              } else {
                // Fallback: check all CSS entries in manifest
                for (const [key, value] of Object.entries(manifest)) {
                  if (key.endsWith('CSS') && value.includes(baseName)) {
                    newHref = value;
                    break;
                  }
                }
              }
            }
            
            if (newHref && newHref !== href) {
              console.log('🔄 Reloading CSS:', href, '→', newHref);
              link.href = newHref + '?t=' + Date.now();
            } else {
              // Fallback: cache busting if we can't find in manifest
              const url = new URL(href, window.location.origin);
              url.searchParams.set('t', Date.now().toString());
              link.href = url.toString();
            }
          });
        }
        
        // Simple React HMR Client Handler
        ${generateSimpleReactHMRClientCode()}
        
        
        // Determine WebSocket URL (use client's current hostname and port)
        const wsHost = location.hostname;
        const wsPort = location.port || (location.protocol === 'https:' ? '443' : '80');
        // Prevent multiple WebSocket connections
        if (window.__HMR_WS__ && window.__HMR_WS__.readyState === WebSocket.OPEN) {
          console.log('⚠️ WebSocket already connected, skipping new connection');
          return;
        }
        
        const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = wsProtocol + '://' + wsHost + ':' + wsPort + '/hmr';
        
        const ws = new WebSocket(wsUrl);
        window.__HMR_WS__ = ws; // Store globally to prevent duplicates
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
        
        ws.onmessage = function(event) {
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
              setTimeout(function() { isHMRUpdating = false; }, 2000);
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
                
              case 'rebuild-complete': {
                console.log('✅ Rebuild complete');
                console.log('🔍 Affected frameworks:', message.data.affectedFrameworks);
                if (window.__HMR_MANIFEST__) {
                  window.__HMR_MANIFEST__ = message.data.manifest;
                }
                
                // Check if CSS files changed (manifest has new CSS entries)
                const currentFrameworkForCSS = detectCurrentFramework();
                if ((currentFrameworkForCSS === 'html' || currentFrameworkForCSS === 'htmx') && message.data.manifest) {
                  // Reload CSS stylesheets when manifest updates (CSS files changed)
                  reloadCSSStylesheets(message.data.manifest);
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
              }
                
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
                    const serverVersions = window.__HMR_SERVER_VERSIONS__ || {};
                    for (const key in message.data.serverVersions) {
                      if (message.data.serverVersions.hasOwnProperty(key)) {
                        serverVersions[key] = message.data.serverVersions[key];
                      }
                    }
                    window.__HMR_SERVER_VERSIONS__ = serverVersions;
                  }
                  if (message.data.moduleVersions) {
                    const moduleVersions = window.__HMR_MODULE_VERSIONS__ || {};
                    for (const key in message.data.moduleVersions) {
                      if (message.data.moduleVersions.hasOwnProperty(key)) {
                        moduleVersions[key] = message.data.moduleVersions[key];
                      }
                    }
                    window.__HMR_MODULE_VERSIONS__ = moduleVersions;
                  }
                  if (message.data.manifest) {
                    const manifest = window.__HMR_MANIFEST__ || {};
                    for (const key in message.data.manifest) {
                      if (message.data.manifest.hasOwnProperty(key)) {
                        manifest[key] = message.data.manifest[key];
                      }
                    }
                    window.__HMR_MANIFEST__ = manifest;
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
              
                case 'react-update': {
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
                  
                  // Check if React root exists
                  if (!window.__REACT_ROOT__) {
                    console.error('❌ React root not found, cannot perform HMR update');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                    window.location.reload();
                    break;
                  }
                  
                  const container = document.body;
                  if (!container) {
                    console.error('❌ document.body not found');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                    break;
                  }
                  
                  // PRESERVE STATE: Extract component state from DOM
                  let preservedProps = {};
                  const button = container.querySelector('button');
                  if (button && button.textContent) {
                    const countMatch = button.textContent.match(/count is (\\d+)/);
                    if (countMatch) {
                      preservedProps = { initialCount: parseInt(countMatch[1], 10) };
                      console.log('💾 Preserved React counter state:', preservedProps.initialCount);
                    }
                  }
                  
                  // Extract form state if form exists
                  const form = container.querySelector('form');
                  if (form) {
                    const formData = new FormData(form);
                    const formState = {};
                    for (const [key, value] of formData.entries()) {
                      formState[key] = value;
                    }
                    // Also check checkboxes
                    const checkboxes = form.querySelectorAll('input[type="checkbox"]');
                    checkboxes.forEach(function(checkbox) {
                      const input = checkbox;
                      if (input.name) {
                        formState[input.name] = input.checked;
                      }
                    });
                    preservedProps.formState = formState;
                  }
                  
                  // Save preserved state to sessionStorage (survives page reload)
                  if (Object.keys(preservedProps).length > 0) {
                    sessionStorage.setItem('__REACT_HMR_STATE__', JSON.stringify(preservedProps));
                    console.log('💾 Saved React state to sessionStorage:', preservedProps);
                  }
                  
                  // Also set in memory for non-reload HMR path
                  window.__HMR_PRESERVED_STATE__ = preservedProps;
                
                // Check if this is a CSS-only update (no component files changed)
                const hasComponentChanges = message.data.hasComponentChanges !== false; // Default to true if not specified
                const hasCSSChanges = message.data.hasCSSChanges === true;
                const cssPath = message.data.manifest && message.data.manifest.ReactExampleCSS;
                
                // If CSS-only update, just reload CSS and don't re-render component
                if (!hasComponentChanges && hasCSSChanges && cssPath) {
                  console.log('🎨 CSS-only update detected, reloading CSS only');
                  const existingCSSLinks = document.head.querySelectorAll('link[rel="stylesheet"]');
                  existingCSSLinks.forEach(function(link) {
                    const href = link.getAttribute('href');
                    if (href) {
                      const hrefBase = href.split('?')[0].split('/').pop() || '';
                      const cssPathBase = cssPath.split('?')[0].split('/').pop() || '';
                      if (hrefBase === cssPathBase || href.includes('react-example') || cssPathBase.includes(hrefBase)) {
                        const newHref = cssPath + (cssPath.includes('?') ? '&' : '?') + 't=' + Date.now();
                        console.log('🔄 Reloading React CSS:', href, '→', newHref);
                        link.href = newHref;
                      }
                    }
                  });
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                  break;
                }
                
                // Get the index path from manifest - we'll import the index file
                // The index file imports ReactExample, so we can extract it after import
                const indexPath = message.data.manifest && message.data.manifest.ReactExampleIndex;
                console.log('🔍 Client: React HMR update, indexPath:', indexPath);
                
                if (!indexPath) {
                  console.error('❌ No ReactExampleIndex in manifest, reloading page');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                  window.location.reload();
                  break;
                }
                
                // CRITICAL: Find the correct page component path from the manifest
                // The page component has a DIFFERENT hash than the index file
                // Look for ReactExamplePage (or similar) in the manifest
                const manifest = message.data.manifest || {};
                let componentPath = null;
                
                // Try to find the page component in the manifest
                // Look for keys like "ReactExamplePage" or extract from index name
                const indexName = indexPath.split('/').pop().split('.')[0]; // "ReactExample"
                const pageKey = indexName + 'Page';
                
                // Search manifest for the page component
                for (const key in manifest) {
                  if (key === pageKey || (key.includes(indexName) && key.includes('Page'))) {
                    componentPath = manifest[key];
                    break;
                  }
                }
                
                // Fallback: try to construct path (this will likely fail, but worth trying)
                if (!componentPath) {
                  console.warn('⚠️ Page component not found in manifest, trying fallback path construction');
                  const indexPathParts = indexPath.split('/');
                  const filename = indexPathParts[indexPathParts.length - 1];
                  const componentDirIndex = indexPathParts.length - 2;
                  if (indexPathParts[componentDirIndex] === 'indexes') {
                    indexPathParts[componentDirIndex] = 'pages';
                  }
                  indexPathParts[indexPathParts.length - 1] = filename;
                  componentPath = indexPathParts.join('/');
                }
                
                console.log('🔍 Client: Trying to import component from:', componentPath);
                console.log('🔍 Client: Available manifest keys:', Object.keys(manifest).join(', '));
                
                // Use React/ReactDOM from window globals (already loaded by index file)
                // Then import the page component which will also use the same React instance
                if (!window.React || !window.ReactDOM) {
                  console.error('❌ React not found on window. Index file may not have loaded correctly.');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                  break;
                }
                
                const React = window.React;
                const ReactDOM = window.ReactDOM;
                
                // Import the page component (it will use the same React instance via externals)
                // Use hashed path directly (no extra cache-bust) to avoid transient blanking
                import(/* @vite-ignore */ componentPath)
                  .then(function(ComponentModule) {
                    console.log('✅ Component import successful, starting render...');
                    
                    // Get ReactExample component from the module
                    const Component = ComponentModule.default || ComponentModule.ReactExample;
                    
                    if (!Component) {
                      throw new Error('ReactExample component not found. Available exports: ' + Object.keys(ComponentModule).join(', '));
                    }
                    
                    // Merge initial props with preserved state
                    const initialProps = window.__INITIAL_PROPS__ || {};
                    const preservedState = window.__HMR_PRESERVED_STATE__ || {};
                    const mergedProps = {};
                    for (const key in initialProps) {
                      if (initialProps.hasOwnProperty(key)) {
                        mergedProps[key] = initialProps[key];
                      }
                    }
                    for (const key in preservedState) {
                      if (preservedState.hasOwnProperty(key)) {
                        mergedProps[key] = preservedState[key];
                      }
                    }
                    
                    // Check if CSS changed (manifest has ReactExampleCSS key)
                    const cssPathUpdate = message.data.manifest && message.data.manifest.ReactExampleCSS;
                if (hasCSSChanges && cssPathUpdate) {
                      // Reload CSS stylesheet if it changed
                      const existingCSSLinks = document.head.querySelectorAll('link[rel="stylesheet"]');
                      existingCSSLinks.forEach(function(link) {
                        const href = link.getAttribute('href');
                        if (href) {
                          // Match React CSS file by checking if href contains the CSS path or 'react-example'
                          const hrefBase = href.split('?')[0].split('/').pop() || '';
                          const cssPathBase = cssPathUpdate.split('?')[0].split('/').pop() || '';
                          if (hrefBase === cssPathBase || href.includes('react-example') || cssPathBase.includes(hrefBase)) {
                            // This is the React CSS file - reload it with cache busting
                            const newHref = cssPathUpdate + (cssPathUpdate.includes('?') ? '&' : '?') + 't=' + Date.now();
                            console.log('🔄 Reloading React CSS:', href, '→', newHref);
                            link.href = newHref;
                          }
                        }
                      });
                    }
                    
                    console.log('🔄 Re-rendering React component with props:', mergedProps);
                    console.log('🔍 React root exists?', !!window.__REACT_ROOT__);
                    console.log('🔍 Component:', Component.name || 'Anonymous');
                    
                    if (!window.__REACT_ROOT__) {
                      console.error('❌ React root not found, cannot render');
                      throw new Error('React root not found');
                    }
                    
                    // Re-render with the existing root (this will pick up className/id/style changes)
                    const element = React.createElement(Component, mergedProps);
                    console.log('🔍 Created React element:', element);
                    
                    // Flush synchronously to avoid visual gaps/flicker during updates
                    if (ReactDOM.flushSync) {
                      ReactDOM.flushSync(function() {
                        window.__REACT_ROOT__.render(element);
                      });
                    } else {
                      window.__REACT_ROOT__.render(element);
                    }
                    console.log('✅ render() called successfully');
                    
                    console.log('✅ React component updated via HMR');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                  })
                  .catch(function(error) {
                    console.error('❌ Failed to import/render React component:', error);
                    console.error('❌ Error details:', error.message);
                    
                    // If component file doesn't exist, try page reload with state preservation
                    if (error.message.includes('Failed to fetch') || error.message.includes('404')) {
                      console.warn('⚠️ Component not found as separate bundle, reloading page with state preservation');
                      
                      // Reload CSS if changed
                      const cssPathUpdate = message.data.manifest && message.data.manifest.ReactExampleCSS;
                      if (cssPathUpdate) {
                        const existingCSSLinks = document.head.querySelectorAll('link[rel="stylesheet"]');
                        existingCSSLinks.forEach(function(link) {
                          const href = link.getAttribute('href');
                          if (href && (href.includes('react-example') || cssPathUpdate.includes(href.split('/').pop()))) {
                            link.href = cssPathUpdate + '?t=' + Date.now();
                          }
                        });
                      }
                      
                      // Reload page
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                      const url = new URL(window.location.href);
                      url.searchParams.set('_hmr', Date.now().toString());
                      window.location.href = url.toString();
                    } else {
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    }
                  });
                break;
              }
              
              case 'html-update': {
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
                
                // Handle both string (legacy) and object (new format with head + body) formats
                let htmlBody = null;
                let htmlHead = null;
                if (typeof message.data.html === 'string') {
                  htmlBody = message.data.html;
                } else if (message.data.html && typeof message.data.html === 'object') {
                  htmlBody = message.data.html.body || message.data.html;
                  htmlHead = message.data.html.head || null;
                }
                
                if (htmlBody) {
                  // Update head CSS links if head content is provided
                  if (htmlHead) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = htmlHead;
                    const newStylesheets = tempDiv.querySelectorAll('link[rel="stylesheet"]');
                    const existingStylesheets = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]'));
                    
                    // Collect new CSS hrefs (normalize by removing query params and hash for comparison)
                    const newHrefs = Array.from(newStylesheets).map(function(link) {
                      const href = link.getAttribute('href') || '';
                      // Extract base path before hash (e.g., /assets/css/html-example.abc123.css -> /assets/css/html-example)
                      const baseName = href.split('?')[0].split('/').pop();
                      return baseName ? baseName.replace(/\.[^.]*$/, '') : '';
                    });
                    
                    // Track which links need to be removed after new ones load
                    const linksToRemove = [];
                    const linksToWaitFor = [];
                    
                    // STEP 1: Add/update new stylesheet links FIRST (before removing old ones)
                    newStylesheets.forEach(function(newLink) {
                      const href = newLink.getAttribute('href');
                      if (!href) return;
                      
                      const baseName = href.split('?')[0].split('/').pop();
                      const baseNew = baseName ? baseName.replace(/\.[^.]*$/, '') : '';
                      
                      // Find existing link with same base path
                      let existingLink = null;
                      document.head.querySelectorAll('link[rel="stylesheet"]').forEach(function(existing) {
                        const existingHref = existing.getAttribute('href') || '';
                        const existingBaseName = existingHref.split('?')[0].split('/').pop();
                        const baseExisting = existingBaseName ? existingBaseName.replace(/\.[^.]*$/, '') : '';
                        if (baseExisting === baseNew || baseExisting.includes(baseNew) || baseNew.includes(baseExisting)) {
                          existingLink = existing;
                        }
                      });
                      
                      if (existingLink) {
                        // Check if href actually changed (new hash)
                        const existingHrefAttr = existingLink.getAttribute('href');
                        const existingHref = existingHrefAttr ? existingHrefAttr.split('?')[0] : '';
                        const newHrefBase = href.split('?')[0];
                        if (existingHref !== newHrefBase) {
                          // Different hash - add new link, wait for it to load AND be applied, then remove old
                          console.log('🔄 CSS hash changed, adding new link before removing old:', existingHref, '→', href);
                          const newLinkElement = document.createElement('link');
                          newLinkElement.rel = 'stylesheet';
                          newLinkElement.href = href + (href.includes('?') ? '&' : '?') + 't=' + Date.now();
                          
                          // Wait for new link to load AND be fully applied before removing old one
                          const loadPromise = new Promise(function(resolve) {
                            let resolved = false;
                            const doResolve = function() {
                              if (resolved) return;
                              resolved = true;
                              console.log('✅ New CSS loaded and applied, removing old link');
                              if (existingLink && existingLink.parentNode) {
                                existingLink.remove();
                              }
                              resolve();
                            };
                            
                            newLinkElement.onload = function() {
                              // Triple RAF ensures CSS is fully processed, painted, and styles applied
                              requestAnimationFrame(function() {
                                requestAnimationFrame(function() {
                                  requestAnimationFrame(function() {
                                    doResolve();
                                  });
                                });
                              });
                            };
                            newLinkElement.onerror = function() {
                              console.warn('⚠️ CSS load error, removing old link anyway');
                              setTimeout(function() {
                                requestAnimationFrame(function() {
                                  doResolve();
                                });
                              }, 50);
                            };
                            
                            // Fallback: if onload doesn't fire (some browsers), check after a delay
                            setTimeout(function() {
                              if (newLinkElement.sheet && !resolved) {
                                requestAnimationFrame(function() {
                                  requestAnimationFrame(function() {
                                    requestAnimationFrame(function() {
                                      doResolve();
                                    });
                                  });
                                });
                              }
                            }, 100);
                          });
                          
                          document.head.appendChild(newLinkElement);
                          linksToWaitFor.push(loadPromise);
                        } else {
                          // Same href (CSS file hasn't changed) - skip CSS reload to prevent flicker
                          // Just update cache buster on existing link if needed, but don't reload
                          console.log('✅ CSS file unchanged, skipping reload:', href);
                          // No action needed - existing link is fine
                        }
                      } else {
                        // Add new link
                        console.log('➕ Adding new CSS link:', href);
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = href + (href.includes('?') ? '&' : '?') + 't=' + Date.now();
                        document.head.appendChild(link);
                      }
                    });
                    
                    // STEP 2: Mark old CSS links that are no longer present for removal (after new ones load)
                    existingStylesheets.forEach(function(existingLink) {
                      const existingHref = existingLink.getAttribute('href') || '';
                      const existingBaseName = existingHref.split('?')[0].split('/').pop();
                      const baseExisting = existingBaseName ? existingBaseName.replace(/\.[^.]*$/, '') : '';
                      const stillExists = newHrefs.some(function(newBase) {
                        // Match by base filename (e.g., "html-example" matches "html-example")
                        return baseExisting === newBase || baseExisting.includes(newBase) || newBase.includes(baseExisting);
                      });
                      
                      if (!stillExists) {
                        // Only remove if not already handled above (hash change case)
                        const wasHandled = Array.from(newStylesheets).some(function(newLink) {
                          const newHref = newLink.getAttribute('href') || '';
                          const newBaseName = newHref.split('?')[0].split('/').pop();
                          const baseNewLocal = newBaseName ? newBaseName.replace(/\.[^.]*$/, '') : '';
                          return baseExisting === baseNewLocal || baseExisting.includes(baseNewLocal) || baseNewLocal.includes(baseExisting);
                        });
                        
                        if (!wasHandled) {
                          console.log('➖ Marking old CSS link for removal:', existingHref);
                          linksToRemove.push(existingLink);
                        }
                      }
                    });
                    
                    // STEP 3: Wait for CSS to load BEFORE patching body to prevent flicker
                    const updateBodyAfterCSS = function() {
                      const container = document.body;
                      if (!container) return;
                      
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
                      const existingScripts = Array.from(container.querySelectorAll('script[src]')).map(function(script) {
                        return {
                          src: script.getAttribute('src') || '',
                          type: script.getAttribute('type') || 'text/javascript'
                        };
                      });
                      
                      // Preserve HMR client script
                      const hmrScript = container.querySelector('script[data-hmr-client]');
                      
                      // Parse new HTML to check what changed
                      const tempDiv = document.createElement('div');
                      tempDiv.innerHTML = htmlBody;
                      const newScripts = Array.from(tempDiv.querySelectorAll('script[src]')).map(function(script) {
                        return {
                          src: script.getAttribute('src') || '',
                          type: script.getAttribute('type') || 'text/javascript'
                        };
                      });
                      
                      // Check if scripts actually changed (compare src without cache-busting params)
                      const scriptsChanged = existingScripts.length !== newScripts.length ||
                        existingScripts.some(function(oldScript, i) {
                          const oldSrcBase = oldScript.src.split('?')[0].split('&')[0];
                          const newScript = newScripts[i];
                          if (!newScript) return true;
                          const newSrcBase = newScript.src.split('?')[0].split('&')[0];
                          return oldSrcBase !== newSrcBase;
                        });
                      
                      // Helper to normalize HTML for comparison (removes runtime attributes and scripts)
                      function normalizeHTMLForComparison(element) {
                        const clone = element.cloneNode(true);
                        // Remove all script tags
                        const scripts = clone.querySelectorAll('script');
                        scripts.forEach(function(script) {
                          if (script.parentNode) {
                            script.parentNode.removeChild(script);
                          }
                        });
                        // Remove runtime HMR attributes from all elements
                        const allElements = clone.querySelectorAll('*');
                        allElements.forEach(function(el) {
                          el.removeAttribute('data-hmr-listeners-attached');
                        });
                        // Also remove from the root element
                        if (clone.removeAttribute) {
                          clone.removeAttribute('data-hmr-listeners-attached');
                        }
                        return clone.innerHTML;
                      }
                      
                      // Check if HTML structure changed (normalized, ignoring runtime attributes and scripts)
                      const existingBodyNormalized = normalizeHTMLForComparison(container);
                      const newBodyNormalized = normalizeHTMLForComparison(tempDiv);
                      const htmlStructureChanged = existingBodyNormalized !== newBodyNormalized;
                      
                      // Smart DOM patching: Only update changed elements, not full replacement
                      patchDOMInPlace(container, htmlBody);
                    
                      // Re-append HMR script if it was removed
                      if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
                        container.appendChild(hmrScript);
                      }
                      
                      // RESTORE STATE
                      requestAnimationFrame(function() {
                        restoreFormState(savedState.forms);
                        restoreScrollState(savedState.scroll);
                        
                        // Restore counter state (preserve current count, don't reset)
                        const newCounterSpan = container.querySelector('#counter');
                        if (newCounterSpan && savedState.componentState.count !== undefined) {
                          newCounterSpan.textContent = String(savedState.componentState.count);
                        }
                        
                        // Re-execute scripts if scripts changed OR HTML structure changed (but not for CSS-only)
                        // When scripts change or HTML structure changes, we need to re-attach listeners
                        if (scriptsChanged || htmlStructureChanged) {
                          // First, clone elements with listeners attached to remove old listeners, then remove flag
                          container.querySelectorAll('[data-hmr-listeners-attached]').forEach(function(el) {
                            // Clone the element to remove all event listeners
                            const cloned = el.cloneNode(true);
                            if (el.parentNode) {
                              el.parentNode.replaceChild(cloned, el);
                            }
                            // Remove the flag from the cloned element so scripts can re-attach
                            cloned.removeAttribute('data-hmr-listeners-attached');
                          });
                          
                          // Remove old script tags first to prevent duplicate execution
                          const scriptsInNewHTML = container.querySelectorAll('script[src]');
                          scriptsInNewHTML.forEach(function(script) {
                            // Don't remove HMR script
                            if (!script.hasAttribute('data-hmr-client')) {
                              script.remove();
                            }
                          });
                          
                          // Clear script initialization flag
                          window.__HTML_SCRIPT_INITIALIZED__ = false;
                          
                          // Re-append compiled scripts with cache busting
                          // Use new cache buster timestamp to ensure fresh execution
                          newScripts.forEach(function(scriptInfo) {
                            const newScript = document.createElement('script');
                            const separator = scriptInfo.src.includes('?') ? '&' : '?';
                            newScript.src = scriptInfo.src + separator + 't=' + Date.now();
                            newScript.type = scriptInfo.type;
                            container.appendChild(newScript);
                          });
                          
                          // Re-execute inline scripts
                          const inlineScripts = container.querySelectorAll('script:not([src])');
                          inlineScripts.forEach(function(script) {
                            if (!script.hasAttribute('data-hmr-client')) {
                              const newScript = document.createElement('script');
                              newScript.textContent = script.textContent || '';
                              newScript.type = script.type || 'text/javascript';
                              if (script.parentNode) {
                                script.parentNode.replaceChild(newScript, script);
                              }
                            }
                          });
                          
                          console.log('✅ Scripts re-executed to re-attach event listeners after DOM patch');
                        } else {
                          console.log('✅ Scripts unchanged, skipping re-execution (CSS-only update)');
                        }
                      });
                      
                      console.log('✅ HTML updated via DOM patching');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    };
                    
                    // Wait for CSS to load AND be fully applied before patching body (prevents flicker)
                    if (linksToWaitFor.length > 0) {
                      Promise.all(linksToWaitFor).then(function() {
                        // Triple RAF ensures CSS is fully processed, painted, and styles applied
                        requestAnimationFrame(function() {
                          requestAnimationFrame(function() {
                            requestAnimationFrame(function() {
                              // Remove old CSS links (new ones are already loaded and applied)
                              linksToRemove.forEach(function(link) {
                                if (link.parentNode) {
                                  console.log('➖ Removing old CSS link:', link.getAttribute('href'));
                                  link.remove();
                                }
                              });
                              // Now patch body (CSS is fully loaded and applied, no flicker)
                              updateBodyAfterCSS();
                            });
                          });
                        });
                      });
                    } else {
                      // No CSS to wait for, patch body immediately and remove old links
                      requestAnimationFrame(function() {
                        requestAnimationFrame(function() {
                          requestAnimationFrame(function() {
                            linksToRemove.forEach(function(link) {
                              if (link.parentNode) {
                                console.log('➖ Removing old CSS link:', link.getAttribute('href'));
                                link.remove();
                              }
                            });
                            updateBodyAfterCSS();
                          });
                        });
                      });
                    }
                  } else {
                    // No head content, just update body immediately using DOM patching
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
                      
                      // Parse new HTML to check what changed
                      const tempDiv = document.createElement('div');
                      tempDiv.innerHTML = htmlBody;
                      const newScripts = Array.from(tempDiv.querySelectorAll('script[src]')).map(script => ({
                        src: script.getAttribute('src') || '',
                        type: script.getAttribute('type') || 'text/javascript'
                      }));
                      
                      // Check if scripts actually changed
                      const scriptsChanged = existingScripts.length !== newScripts.length ||
                        existingScripts.some((oldScript, i) => {
                          const oldSrcBase = oldScript.src.split('?')[0].split('&')[0];
                          const newScript = newScripts[i];
                          if (!newScript) return true;
                          const newSrcBase = newScript.src.split('?')[0].split('&')[0];
                          return oldSrcBase !== newSrcBase;
                        });
                      
                      // Preserve HMR client script
                      const hmrScript = container.querySelector('script[data-hmr-client]');
                      
                      // Patch DOM in place (only updates changed attributes/elements, zero flicker)
                      patchDOMInPlace(container, htmlBody);
                      
                      // Re-append HMR script
                      if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
                        container.appendChild(hmrScript);
                      }
                      
                      // RESTORE STATE
                      requestAnimationFrame(() => {
                        restoreFormState(savedState.forms);
                        restoreScrollState(savedState.scroll);
                        
                        // Restore counter state (preserve current count)
                        const newCounterSpan = container.querySelector('#counter');
                        if (newCounterSpan && savedState.componentState.count !== undefined) {
                          newCounterSpan.textContent = String(savedState.componentState.count);
                        }
                        
                        // Always re-execute scripts after DOM patching to re-attach event listeners
                        // First, clone elements with listeners attached to remove old listeners, then remove flag
                        container.querySelectorAll('[data-hmr-listeners-attached]').forEach(function(el) {
                          // Clone the element to remove all event listeners
                          const cloned = el.cloneNode(true);
                          if (el.parentNode) {
                            el.parentNode.replaceChild(cloned, el);
                          }
                          // Remove the flag from the cloned element so scripts can re-attach
                          cloned.removeAttribute('data-hmr-listeners-attached');
                        });
                        
                        // Remove old script tags first to prevent duplicate execution
                        const scriptsInNewHTML = container.querySelectorAll('script[src]');
                        scriptsInNewHTML.forEach(function(script) {
                          if (!script.hasAttribute('data-hmr-client')) {
                            script.remove();
                          }
                        });
                        
                        // Clear script initialization flag
                        window.__HTML_SCRIPT_INITIALIZED__ = false;
                        
                        // Re-append compiled scripts with cache busting
                        newScripts.forEach((scriptInfo) => {
                          const newScript = document.createElement('script');
                          const separator = scriptInfo.src.includes('?') ? '&' : '?';
                          newScript.src = scriptInfo.src + separator + 't=' + Date.now();
                          newScript.type = scriptInfo.type;
                          container.appendChild(newScript);
                        });
                        
                        // Re-execute inline scripts
                        const inlineScripts = container.querySelectorAll('script:not([src])');
                        inlineScripts.forEach((script) => {
                          if (!script.hasAttribute('data-hmr-client')) {
                            const newScript = document.createElement('script');
                            newScript.textContent = script.textContent || '';
                            newScript.type = script.type || 'text/javascript';
                            if (script.parentNode) {
                              script.parentNode.replaceChild(newScript, script);
                            }
                          }
                        });
                        
                        console.log('✅ Scripts re-executed to re-attach event listeners after DOM patch');
                      });
                      
                      console.log('✅ HTML updated via DOM patching');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    } else {
                      console.error('❌ document.body not found');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    }
                  }
                } else {
                  console.error('❌ No HTML provided in html-update');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                }
                break;
              }
                
              case 'htmx-update': {
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
                
                // Handle both string (legacy) and object (new format with head + body) formats
                let htmxBody = null;
                let htmxHead = null;
                if (typeof message.data.html === 'string') {
                  htmxBody = message.data.html;
                } else if (message.data.html && typeof message.data.html === 'object') {
                  htmxBody = message.data.html.body || message.data.html;
                  htmxHead = message.data.html.head || null;
                }
                
                if (htmxBody) {
                  // Define body update function (used whether or not CSS is updated)
                  const updateHTMXBodyAfterCSS = function() {
                      const container = document.body;
                      if (!container) return;
                      
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
                        }).catch(function(error) {
                          console.warn('⚠️ Failed to sync server-side HTMX state:', error);
                        });
                      }
                      
                      // Store existing compiled script elements
                      const existingScripts = Array.from(container.querySelectorAll('script[src]')).map(function(script) {
                        return {
                          src: script.getAttribute('src') || '',
                          type: script.getAttribute('type') || 'text/javascript'
                        };
                      });
                      
                      // Parse new HTML to check what changed
                      const tempDiv = document.createElement('div');
                      tempDiv.innerHTML = htmxBody;
                      const newScripts = Array.from(tempDiv.querySelectorAll('script[src]')).map(function(script) {
                        return {
                          src: script.getAttribute('src') || '',
                          type: script.getAttribute('type') || 'text/javascript'
                        };
                      });
                      
                      // Check if scripts actually changed
                      const scriptsChanged = existingScripts.length !== newScripts.length ||
                        existingScripts.some(function(oldScript, i) {
                          const oldSrcBase = oldScript.src.split('?')[0].split('&')[0];
                          const newScript = newScripts[i];
                          if (!newScript) return true;
                          const newSrcBase = newScript.src.split('?')[0].split('&')[0];
                          return oldSrcBase !== newSrcBase;
                        });
                      
                      // Helper to normalize HTML for comparison (removes runtime attributes and scripts)
                      function normalizeHTMLForComparisonHTMX(element) {
                        const clone = element.cloneNode(true);
                        // Remove all script tags
                        const scripts = clone.querySelectorAll('script');
                        scripts.forEach(function(script) {
                          if (script.parentNode) {
                            script.parentNode.removeChild(script);
                          }
                        });
                        // Remove runtime HMR attributes from all elements
                        const allElements = clone.querySelectorAll('*');
                        allElements.forEach(function(el) {
                          el.removeAttribute('data-hmr-listeners-attached');
                        });
                        // Also remove from the root element
                        if (clone.removeAttribute) {
                          clone.removeAttribute('data-hmr-listeners-attached');
                        }
                        return clone.innerHTML;
                      }
                      
                      // Preserve HMR client script
                      const hmrScript = container.querySelector('script[data-hmr-client]');
                      
                      // Check if HTML structure changed (normalized, ignoring runtime attributes and scripts)
                      // IMPORTANT: Do this BEFORE patching so we compare old vs new state
                      const existingBodyNormalizedHTMX = normalizeHTMLForComparisonHTMX(container);
                      const newBodyNormalizedHTMX = normalizeHTMLForComparisonHTMX(tempDiv);
                      const htmlStructureChanged = existingBodyNormalizedHTMX !== newBodyNormalizedHTMX;
                      
                      console.log('🔍 HTMX HTML structure changed?', htmlStructureChanged);
                      if (htmlStructureChanged) {
                        console.log('🔍 Existing body length:', existingBodyNormalizedHTMX.length);
                        console.log('🔍 New body length:', newBodyNormalizedHTMX.length);
                      }
                      
                      // Patch DOM in place (only updates changed attributes/elements, zero flicker)
                      patchDOMInPlace(container, htmxBody);
                    
                      // Re-append HMR script
                      if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
                        container.appendChild(hmrScript);
                      }
                    
                    // RESTORE STATE
                    requestAnimationFrame(function() {
                      restoreFormState(savedState.forms);
                      restoreScrollState(savedState.scroll);
                      
                      // Restore counter state (preserve current count)
                      const newCountSpan = container.querySelector('#count');
                      if (newCountSpan && savedState.componentState.count !== undefined) {
                        newCountSpan.textContent = String(savedState.componentState.count);
                      }
                      
                      // Re-execute scripts if scripts changed OR HTML structure changed (but not for CSS-only)
                      // When scripts change or HTML structure changes, we need to re-attach listeners
                      if (scriptsChanged || htmlStructureChanged) {
                        console.log('🔄 HTMX: Scripts or HTML structure changed, re-executing scripts and re-processing HTMX');
                        // First, clone elements with listeners attached to remove old listeners, then remove flag
                        container.querySelectorAll('[data-hmr-listeners-attached]').forEach(function(el) {
                          // Clone the element to remove all event listeners
                          const cloned = el.cloneNode(true);
                          if (el.parentNode) {
                            el.parentNode.replaceChild(cloned, el);
                          }
                          // Remove the flag from the cloned element so scripts can re-attach
                          cloned.removeAttribute('data-hmr-listeners-attached');
                        });
                        
                        // Remove old script tags first to prevent duplicate execution
                        const scriptsInNewHTML = container.querySelectorAll('script[src]');
                        scriptsInNewHTML.forEach(function(script) {
                          if (!script.hasAttribute('data-hmr-client')) {
                            script.remove();
                          }
                        });
                        
                        // Re-append compiled scripts with cache busting
                        newScripts.forEach(function(scriptInfo) {
                          const newScript = document.createElement('script');
                          const separator = scriptInfo.src.includes('?') ? '&' : '?';
                          newScript.src = scriptInfo.src + separator + 't=' + Date.now();
                          newScript.type = scriptInfo.type;
                          container.appendChild(newScript);
                        });
                        
                        // Re-execute inline scripts
                        const inlineScripts = container.querySelectorAll('script:not([src])');
                        inlineScripts.forEach(function(script) {
                          if (!script.hasAttribute('data-hmr-client')) {
                            const newScript = document.createElement('script');
                            newScript.textContent = script.textContent || '';
                            newScript.type = script.type || 'text/javascript';
                            if (script.parentNode) {
                              script.parentNode.replaceChild(newScript, script);
                            }
                          }
                        });
                        
                        console.log('✅ Scripts re-executed to re-attach event listeners after DOM patch');
                      } else {
                        console.log('✅ HTMX: Scripts and HTML structure unchanged, skipping script re-execution (CSS-only update)');
                      }
                      
                      // Re-initialize HTMX on new content (always do this for HTMX, even for CSS-only updates)
                      // This ensures HTMX picks up any attribute changes (hx-*, classes, IDs, etc.)
                      if (window.htmx) {
                        console.log('🔄 HTMX: Re-processing container to pick up attribute changes');
                        window.htmx.process(container);
                      }
                    });
                    
                    console.log('✅ HTMX updated via DOM patching');
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                  };
                  
                  // Update head CSS links if head content is provided
                  if (htmxHead) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = htmxHead;
                    const newStylesheets = tempDiv.querySelectorAll('link[rel="stylesheet"]');
                    const existingStylesheets = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]'));
                    
                    // Collect new CSS hrefs (normalize by removing query params and hash for comparison)
                    const newHrefs = Array.from(newStylesheets).map(link => {
                      const href = link.getAttribute('href') || '';
                      // Extract base path before hash (e.g., /assets/css/htmx-example.abc123.css -> /assets/css/htmx-example)
                      const baseName = href.split('?')[0].split('/').pop();
                      return baseName ? baseName.replace(/\.[^.]*$/, '') : '';
                    });
                    
                    // Track which links need to be removed after new ones load
                    const linksToRemoveHTMX = [];
                    const linksToWaitForHTMX = [];
                    
                    // STEP 1: Add/update new stylesheet links FIRST (before removing old ones)
                    newStylesheets.forEach(function(newLink) {
                      const href = newLink.getAttribute('href');
                      if (!href) return;
                      
                      const baseName = href.split('?')[0].split('/').pop();
                      const baseNew = baseName ? baseName.replace(/\.[^.]*$/, '') : '';
                      
                      // Find existing link with same base path
                      let existingLink = null;
                      document.head.querySelectorAll('link[rel="stylesheet"]').forEach(function(existing) {
                        const existingHref = existing.getAttribute('href') || '';
                        const existingBaseName = existingHref.split('?')[0].split('/').pop();
                        const baseExisting = existingBaseName ? existingBaseName.replace(/\.[^.]*$/, '') : '';
                        if (baseExisting === baseNew || baseExisting.includes(baseNew) || baseNew.includes(baseExisting)) {
                          existingLink = existing;
                        }
                      });
                      
                      if (existingLink) {
                        // Check if href actually changed (new hash)
                        const existingHrefAttr = existingLink.getAttribute('href');
                        const existingHref = existingHrefAttr ? existingHrefAttr.split('?')[0] : '';
                        const newHrefBase = href.split('?')[0];
                        if (existingHref !== newHrefBase) {
                          // Different hash - add new link, wait for it to load AND be applied, then remove old
                          console.log('🔄 CSS hash changed, adding new link before removing old:', existingHref, '→', href);
                          const newLinkElement = document.createElement('link');
                          newLinkElement.rel = 'stylesheet';
                          newLinkElement.href = href + (href.includes('?') ? '&' : '?') + 't=' + Date.now();
                          
                          // Wait for new link to load AND be fully applied before removing old one
                          const loadPromise = new Promise(function(resolve) {
                            let resolved = false;
                            const doResolve = function() {
                              if (resolved) return;
                              resolved = true;
                              console.log('✅ New CSS loaded and applied, removing old link');
                              if (existingLink && existingLink.parentNode) {
                                existingLink.remove();
                              }
                              resolve();
                            };
                            
                            newLinkElement.onload = function() {
                              // Triple RAF ensures CSS is fully processed, painted, and styles applied
                              requestAnimationFrame(function() {
                                requestAnimationFrame(function() {
                                  requestAnimationFrame(function() {
                                    doResolve();
                                  });
                                });
                              });
                            };
                            newLinkElement.onerror = function() {
                              console.warn('⚠️ CSS load error, removing old link anyway');
                              setTimeout(function() {
                                requestAnimationFrame(function() {
                                  doResolve();
                                });
                              }, 50);
                            };
                            
                            // Fallback: if onload doesn't fire (some browsers), check after a delay
                            setTimeout(function() {
                              if (newLinkElement.sheet && !resolved) {
                                requestAnimationFrame(function() {
                                  requestAnimationFrame(function() {
                                    requestAnimationFrame(function() {
                                      doResolve();
                                    });
                                  });
                                });
                              }
                            }, 100);
                          });
                          
                          document.head.appendChild(newLinkElement);
                          linksToWaitForHTMX.push(loadPromise);
                          } else {
                            // Same href (CSS file hasn't changed) - skip CSS reload to prevent flicker
                            console.log('✅ CSS file unchanged, skipping reload:', href);
                            // No action needed - existing link is fine
                          }
                      } else {
                        // Add new link
                        console.log('➕ Adding new CSS link:', href);
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = href + (href.includes('?') ? '&' : '?') + 't=' + Date.now();
                        document.head.appendChild(link);
                      }
                    });
                    
                    // STEP 2: Mark old CSS links that are no longer present for removal (after new ones load)
                    existingStylesheets.forEach(function(existingLink) {
                      const existingHref = existingLink.getAttribute('href') || '';
                      const existingBaseName = existingHref.split('?')[0].split('/').pop();
                      const baseExisting = existingBaseName ? existingBaseName.replace(/\.[^.]*$/, '') : '';
                      const stillExists = newHrefs.some(function(newBase) {
                        // Match by base filename (e.g., "htmx-example" matches "htmx-example")
                        return baseExisting === newBase || baseExisting.includes(newBase) || newBase.includes(baseExisting);
                      });
                      
                      if (!stillExists) {
                        // Only remove if not already handled above (hash change case)
                        const wasHandled = Array.from(newStylesheets).some(function(newLink) {
                          const newHref = newLink.getAttribute('href') || '';
                          const newBaseName = newHref.split('?')[0].split('/').pop();
                          const baseNewLocal = newBaseName ? newBaseName.replace(/\.[^.]*$/, '') : '';
                          return baseExisting === baseNewLocal || baseExisting.includes(baseNewLocal) || baseNewLocal.includes(baseExisting);
                        });
                        
                        if (!wasHandled) {
                          console.log('➖ Marking old CSS link for removal:', existingHref);
                          linksToRemoveHTMX.push(existingLink);
                        }
                      }
                    });
                    
                    // STEP 3: Wait for CSS to load before patching body (prevents flicker)
                    // Use requestAnimationFrame to batch CSS and DOM updates together
                    if (linksToWaitForHTMX.length > 0) {
                      Promise.all(linksToWaitForHTMX).then(function() {
                        // Triple RAF ensures CSS is fully processed, painted, and styles applied
                        requestAnimationFrame(function() {
                          requestAnimationFrame(function() {
                            requestAnimationFrame(function() {
                              // Remove old CSS links
                              linksToRemoveHTMX.forEach(function(link) {
                                if (link.parentNode) {
                                  console.log('➖ Removing old CSS link:', link.getAttribute('href'));
                                  link.remove();
                                }
                              });
                              // Now patch body (CSS is fully loaded and applied, no flicker)
                              updateHTMXBodyAfterCSS();
                            });
                          });
                        });
                      });
                    } else {
                      // No CSS to wait for, patch body immediately and remove old links
                      requestAnimationFrame(function() {
                        requestAnimationFrame(function() {
                          requestAnimationFrame(function() {
                            linksToRemoveHTMX.forEach(function(link) {
                              if (link.parentNode) {
                                console.log('➖ Removing old CSS link:', link.getAttribute('href'));
                                link.remove();
                              }
                            });
                            updateHTMXBodyAfterCSS();
                          });
                        });
                      });
                    }
                  } else {
                    // No head content, just update body immediately
                    updateHTMXBodyAfterCSS();
                  }
                } else {
                  console.error('❌ No HTML provided in htmx-update');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                }
                break;
              }
                
              case 'svelte-update': {
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
                    const countMatch = button.textContent && button.textContent.match(/count is (\\d+)/);
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
                  const indexPath = message.data.manifest && message.data.manifest.SvelteExampleIndex;
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
                  import(/* @vite-ignore */ modulePath)
                    .then(function() {
                      console.log('✅ Svelte component hot-swapped successfully!');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    })
                    .catch(function(error) {
                      console.error('❌ Failed to hot-swap Svelte component:', error);
                      console.log('🔄 Falling back to full reload...');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                      window.location.reload();
                    });
                } catch (error) {
                  console.error('❌ Failed to hot-swap Svelte component:', error);
                  console.log('🔄 Falling back to full reload...');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                  window.location.reload();
                }
                break;
              }
                
              case 'vue-update': {
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
                  const indexPath = message.data.manifest && message.data.manifest.VueExampleIndex;
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
                  import(/* @vite-ignore */ modulePath)
                    .then(function() {
                      console.log('✅ Vue component hot-swapped successfully!');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    })
                    .catch(function(error) {
                      console.error('❌ Failed to hot-swap Vue component:', error);
                      console.log('🔄 Falling back to full reload...');
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                      window.location.reload();
                    });
                } catch (error) {
                  console.error('❌ Failed to hot-swap Vue component:', error);
                  console.log('🔄 Falling back to full reload...');
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                  window.location.reload();
                }
                break;
              }
                
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
  
  // Inject import map before </head> and HMR script before </body>
  const headRegex = /<\/head\s*>/i;
  const bodyRegex = /<\/body\s*>/i;
  const headMatch = headRegex.exec(html);
  let result = html;
  
  // Insert import map early so dynamic imports resolve
  if (headMatch !== null) {
    result = result.slice(0, headMatch.index) + importMap + result.slice(headMatch.index);
  }
  
  const bodyMatch = bodyRegex.exec(result);
  if (bodyMatch !== null) {
    result = result.slice(0, bodyMatch.index) + hmrScript + result.slice(bodyMatch.index);
  } else {
    result = result + hmrScript;
  }
  
  return result;
}

