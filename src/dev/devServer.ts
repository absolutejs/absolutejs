import { Elysia } from 'elysia';
import { build } from '../core/build';
import type { BuildConfig } from '../types';
import { createHMRState, type HMRState } from './clientManager';
import { buildInitialDependencyGraph } from './dependencyGraph';
import { startFileWatching } from './fileWatcher';
import { getWatchPaths } from './pathUtils';
import { queueFileChange } from './rebuildTrigger';
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
  const watchPaths = getWatchPaths(config, state.resolvedPaths);
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
  return (app: Elysia) => {
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
        if (contentType?.includes('text/html')) {
          try {
            const html = await response.text();
            const htmlWithHMR = injectHMRClient(html);
            
            return new Response(htmlWithHMR, {
              status: response.status,
              statusText: response.statusText,
              headers: {
                ...Object.fromEntries(response.headers),
                'content-type': contentType
              }
            });
          } catch {
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
  // Static import map placed in <head> so dynamic imports can resolve immediately
  // We map React to a single CDN ESM copy and set globals so all bundles share the same instance
  // IMPORTANT: react-refresh/runtime is loaded BEFORE React to hook into the reconciler
  const importMap = `
    <script type="importmap" data-hmr-import-map>
      {
        "imports": {
          "react-refresh/runtime": "https://esm.sh/react-refresh@0.18/runtime?dev",
          "react": "https://esm.sh/react@19?dev",
          "react-dom/client": "https://esm.sh/react-dom@19/client?dev",
          "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime?dev",
          "react/jsx-dev-runtime": "https://esm.sh/react@19/jsx-dev-runtime?dev",
          "vue": "https://esm.sh/vue@3?dev"
        }
      }
    </script>
    <script type="module" data-react-refresh-setup>
      // React Refresh runtime MUST be loaded and initialized BEFORE React
      // This hooks into React's internals to track component signatures
      import RefreshRuntime from 'react-refresh/runtime';
      
      // Inject into global hook before React loads
      RefreshRuntime.injectIntoGlobalHook(window);
      
      // Expose for HMR client to use
      window.$RefreshRuntime$ = RefreshRuntime;
      window.$RefreshReg$ = function(type, id) {
        RefreshRuntime.register(type, id);
      };
      window.$RefreshSig$ = function() {
        return RefreshRuntime.createSignatureFunctionForTransform();
      };
    </script>
    <script type="module" data-react-globals>
      // Ensure a single React instance is shared and exposed globally for HMR
      // This runs AFTER react-refresh has hooked into window
      import React from 'react';
      import * as ReactDOMClient from 'react-dom/client';
      if (!window.React) window.React = React;
      if (!window.ReactDOM) window.ReactDOM = ReactDOMClient;
      if (!window.ReactDOM.default) window.ReactDOM.default = ReactDOMClient;
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

        // Generic DOM state snapshot/restore to preserve user-visible state across HMR
        function saveDOMState(root) {
          const snapshot = { items: [], activeKey: null };
          const selector = 'input, textarea, select, option, [contenteditable="true"], details';
          const elements = root.querySelectorAll(selector);
          elements.forEach(function(el, idx) {
            const entry = { tag: el.tagName.toLowerCase(), idx };
            const id = el.getAttribute('id');
            const name = el.getAttribute('name');
            if (id) entry.id = id;
            else if (name) entry.name = name;

            if (el.tagName === 'INPUT') {
              const type = el.getAttribute('type') || 'text';
              entry.type = type;
              if (type === 'checkbox' || type === 'radio') {
                entry.checked = el.checked;
              } else {
                entry.value = el.value;
              }
              if (el.selectionStart !== null && el.selectionEnd !== null) {
                entry.selStart = el.selectionStart;
                entry.selEnd = el.selectionEnd;
              }
            } else if (el.tagName === 'TEXTAREA') {
              entry.value = el.value;
              if (el.selectionStart !== null && el.selectionEnd !== null) {
                entry.selStart = el.selectionStart;
                entry.selEnd = el.selectionEnd;
              }
            } else if (el.tagName === 'SELECT') {
              const vals = [];
              Array.from(el.options).forEach(function(opt) {
                if (opt.selected) vals.push(opt.value);
              });
              entry.values = vals;
            } else if (el.tagName === 'OPTION') {
              entry.selected = el.selected;
            } else if (el.tagName === 'DETAILS') {
              entry.open = el.open;
            } else if (el.getAttribute('contenteditable') === 'true') {
              entry.text = el.textContent;
            }
            snapshot.items.push(entry);
          });

          const active = document.activeElement;
          if (active && root.contains(active)) {
            const id = active.getAttribute('id');
            const name = active.getAttribute('name');
            if (id) snapshot.activeKey = 'id:' + id;
            else if (name) snapshot.activeKey = 'name:' + name;
            else snapshot.activeKey = 'idx:' + Array.prototype.indexOf.call(elements, active);
          }
          return snapshot;
        }

        function restoreDOMState(root, snapshot) {
          if (!snapshot || !snapshot.items) return;
          const selector = 'input, textarea, select, option, [contenteditable="true"], details';
          const elements = root.querySelectorAll(selector);

          snapshot.items.forEach(function(entry) {
            let target = null;
            if (entry.id) {
              target = root.querySelector('#' + CSS.escape(entry.id));
            }
            if (!target && entry.name) {
              target = root.querySelector('[name="' + CSS.escape(entry.name) + '"]');
            }
            if (!target && elements[entry.idx]) {
              target = elements[entry.idx];
            }
            if (!target) return;

            if (target.tagName === 'INPUT') {
              const type = entry.type || target.getAttribute('type') || 'text';
              if (type === 'checkbox' || type === 'radio') {
                if (entry.checked !== undefined) target.checked = entry.checked;
              } else if (entry.value !== undefined) {
                target.value = entry.value;
              }
              if (entry.selStart !== undefined && entry.selEnd !== undefined && target.setSelectionRange) {
                try { target.setSelectionRange(entry.selStart, entry.selEnd); } catch {}
              }
            } else if (target.tagName === 'TEXTAREA') {
              if (entry.value !== undefined) target.value = entry.value;
              if (entry.selStart !== undefined && entry.selEnd !== undefined && target.setSelectionRange) {
                try { target.setSelectionRange(entry.selStart, entry.selEnd); } catch {}
              }
            } else if (target.tagName === 'SELECT') {
              if (Array.isArray(entry.values)) {
                Array.from(target.options).forEach(function(opt) {
                  opt.selected = entry.values.indexOf(opt.value) !== -1;
                });
              }
            } else if (target.tagName === 'OPTION') {
              if (entry.selected !== undefined) target.selected = entry.selected;
            } else if (target.tagName === 'DETAILS') {
              if (entry.open !== undefined) target.open = entry.open;
            } else if (target.getAttribute('contenteditable') === 'true') {
              if (entry.text !== undefined) target.textContent = entry.text;
            }
          });

          if (snapshot.activeKey) {
            let focusEl = null;
            if (snapshot.activeKey.startsWith('id:')) {
              focusEl = root.querySelector('#' + CSS.escape(snapshot.activeKey.slice(3)));
            } else if (snapshot.activeKey.startsWith('name:')) {
              focusEl = root.querySelector('[name="' + CSS.escape(snapshot.activeKey.slice(5)) + '"]');
            } else if (snapshot.activeKey.startsWith('idx:')) {
              const idx = parseInt(snapshot.activeKey.slice(4), 10);
              if (!isNaN(idx) && elements[idx]) focusEl = elements[idx];
            }
            if (focusEl && focusEl.focus) {
              focusEl.focus();
            }
          }
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
              import(/* @vite-ignore */ fullPath).catch(function() {})
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
              link.href = newHref + '?t=' + Date.now();
            } else {
              // Fallback: cache busting if we can't find in manifest
              const url = new URL(href, window.location.origin);
              url.searchParams.set('t', Date.now().toString());
              link.href = url.toString();
            }
          });
        }

        // Determine WebSocket URL (use client's current hostname and port)
        const wsHost = location.hostname;
        const wsPort = location.port || (location.protocol === 'https:' ? '443' : '80');
        // Prevent multiple WebSocket connections
        if (window.__HMR_WS__ && window.__HMR_WS__.readyState === WebSocket.OPEN) {
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
        let isFirstHMRUpdate = true; // Track if this is the first HMR update since page load

        // Detect which framework page we're currently on
        function detectCurrentFramework() {
          // CRITICAL: Use URL path as the primary signal; avoid sticky globals
          const path = window.location.pathname;
          
          // Prefer explicit routes
          if (path === '/vue' || path.startsWith('/vue/')) return 'vue';
          if (path === '/svelte' || path.startsWith('/svelte/')) return 'svelte';
          if (path === '/htmx' || path.startsWith('/htmx/')) return 'htmx';
          if (path === '/html' || path.startsWith('/html/')) return 'html';
          
          // Root defaults to HTML (example root renders HTML page)
          if (path === '/') return 'html';
          
          // React detection: explicit routes first
          if (path === '/react' || path.startsWith('/react/')) return 'react';
          
          // React fallback if a React root already exists on the page
          if (window.__REACT_ROOT__) return 'react';

          return null;
        }

        // Derive manifest key from source file path
        // Example: "example/svelte/pages/SvelteExample.svelte" -> "SvelteExample"
        function getComponentNameFromPath(filePath) {
          if (!filePath) return null;
          const parts = filePath.replace(/\\\\/g, '/').split('/');
          const fileName = parts[parts.length - 1] || '';
          const baseName = fileName.replace(/\\.(tsx?|jsx?|vue|svelte|html)$/, '');
          // Convert to PascalCase: split on hyphen/underscore, capitalize each word
          return baseName.split(/[-_]/).map(function(word) {
            return word.charAt(0).toUpperCase() + word.slice(1);
          }).join('');
        }

        // Find index path in manifest by deriving from source file or searching for pattern
        function findIndexPath(manifest, sourceFile, framework) {
          if (!manifest) return null;

          // Try to derive from source file first
          if (sourceFile) {
            const componentName = getComponentNameFromPath(sourceFile);
            if (componentName) {
              const indexKey = componentName + 'Index';
              if (manifest[indexKey]) return manifest[indexKey];
            }
          }

          // Fallback: search for any Index key matching the framework
          const frameworkPatterns = {
            react: /react/i,
            svelte: /svelte/i,
            vue: /vue/i
          };
          const pattern = frameworkPatterns[framework];

          for (const key in manifest) {
            if (key.endsWith('Index') && (!pattern || pattern.test(key) || manifest[key].includes('/' + framework + '/'))) {
              return manifest[key];
            }
          }

          return null;
        }

        ws.onopen = function() {
          isConnected = true;
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
                break;
                
              case 'rebuild-complete': {
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
                  const url = new URL(window.location.href);
                  url.searchParams.set('_cb', Date.now().toString());
                  window.location.href = url.toString();
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
                  
                  if (currentFramework !== 'react') {
                    break;
                  }
                  
                  sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                  
                  if (!window.__REACT_ROOT__) {
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                    window.location.reload();
                    break;
                  }
                  
                  const container = document.body;
                  if (!container) {
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                    break;
                  }
                  
                  // Snapshot full DOM state (inputs, selects, contenteditable, details, focus) before rerender
                  const reactDomState = saveDOMState(container);
                
                // Check if this is a CSS-only update (no component files changed)
                const hasComponentChanges = message.data.hasComponentChanges !== false; // Default to true if not specified
                const hasCSSChanges = message.data.hasCSSChanges === true;
                const cssPath = message.data.manifest && message.data.manifest.ReactExampleCSS;
                
                // If CSS-only update, just reload CSS and don't re-render component
                if (!hasComponentChanges && hasCSSChanges && cssPath) {
                  const existingCSSLinks = document.head.querySelectorAll('link[rel="stylesheet"]');
                  existingCSSLinks.forEach(function(link) {
                    const href = link.getAttribute('href');
                    if (href) {
                      const hrefBase = href.split('?')[0].split('/').pop() || '';
                      const cssPathBase = cssPath.split('?')[0].split('/').pop() || '';
                      if (hrefBase === cssPathBase || href.includes('react-example') || cssPathBase.includes(hrefBase)) {
                        const newHref = cssPath + (cssPath.includes('?') ? '&' : '?') + 't=' + Date.now();
                        link.href = newHref;
                      }
                    }
                  });
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                  break;
                }
                
                // Dynamically find index path from manifest using source file or framework pattern
                const indexPath = findIndexPath(message.data.manifest, message.data.primarySource, 'react');

                if (!indexPath) {
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
                
                // Fallback: try to construct path
                if (!componentPath) {
                  const indexPathParts = indexPath.split('/');
                  const filename = indexPathParts[indexPathParts.length - 1];
                  const componentDirIndex = indexPathParts.length - 2;
                  if (indexPathParts[componentDirIndex] === 'indexes') {
                    indexPathParts[componentDirIndex] = 'pages';
                  }
                  indexPathParts[indexPathParts.length - 1] = filename;
                  componentPath = indexPathParts.join('/');
                }
                
                if (!window.React || !window.ReactDOM) {
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                  break;
                }
                
                const React = window.React;
                const ReactDOM = window.ReactDOM;
                
                // Import the page component (it will use the same React instance via externals)
                // Use cache-busted path to ensure fresh module is loaded
                const cacheBustedPath = componentPath + '?t=' + Date.now();
                import(/* @vite-ignore */ cacheBustedPath)
                  .then(function(ComponentModule) {
                    const RefreshRuntime = window.$RefreshRuntime$;
                    if (!RefreshRuntime) {
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                      window.location.reload();
                      return;
                    }
                    
                    // Check if CSS changed (manifest has ReactExampleCSS key)
                    const cssPathUpdate = message.data.manifest && message.data.manifest.ReactExampleCSS;
                    if (hasCSSChanges && cssPathUpdate) {
                      // Reload CSS stylesheet if it changed
                      const existingCSSLinks = document.head.querySelectorAll('link[rel="stylesheet"]');
                      existingCSSLinks.forEach(function(link) {
                        const href = link.getAttribute('href');
                        if (href) {
                          const hrefBase = href.split('?')[0].split('/').pop() || '';
                          const cssPathBase = cssPathUpdate.split('?')[0].split('/').pop() || '';
                          if (hrefBase === cssPathBase || href.includes('react-example') || cssPathBase.includes(hrefBase)) {
                            const newHref = cssPathUpdate + (cssPathUpdate.includes('?') ? '&' : '?') + 't=' + Date.now();
                            link.href = newHref;
                          }
                        }
                      });
                    }
                    
                    RefreshRuntime.performReactRefresh();
                    restoreDOMState(container, reactDomState);
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                  })
                  .catch(function(error) {
                    if (error.message.includes('Failed to fetch') || error.message.includes('404')) {
                      
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
                console.log('[HMR] Received html-update message');
                const htmlFrameworkCheck = detectCurrentFramework();
                console.log('[HMR] Current framework:', htmlFrameworkCheck);
                if (htmlFrameworkCheck !== 'html') {
                  console.log('[HMR] Skipping - not on HTML page');
                  break;
                }
                
                // Clear React globals if they exist (prevents interference from previous React page)
                if (window.__REACT_ROOT__) {
                  window.__REACT_ROOT__ = undefined;
                }
                
                sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                
                // Snapshot DOM state before patching
                const htmlDomState = saveDOMState(document.body);
                
                // Handle both string (legacy) and object (new format with head + body) formats
                let htmlBody = null;
                let htmlHead = null;
                if (typeof message.data.html === 'string') {
                  htmlBody = message.data.html;
                } else if (message.data.html && typeof message.data.html === 'object') {
                  htmlBody = message.data.html.body || message.data.html;
                  htmlHead = message.data.html.head || null;
                }
                console.log('[HMR] htmlBody length:', htmlBody ? htmlBody.length : 'null');
                console.log('[HMR] htmlHead:', htmlHead ? 'present' : 'null');
                
                if (htmlBody) {
                  console.log('[HMR] Processing htmlBody');
                  // Update head CSS links if head content is provided
                  if (htmlHead) {
                    console.log('[HMR] Has htmlHead, processing CSS');
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
                    const linksToActivate = [];  // Track new CSS links to activate AFTER body patch
                    
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
                          const newLinkElement = document.createElement('link');
                          newLinkElement.rel = 'stylesheet';
                          // Start with media="print" to prevent FOUC - CSS loads but doesn't apply
                          newLinkElement.media = 'print';
                          const newHref = href + (href.includes('?') ? '&' : '?') + 't=' + Date.now();
                          newLinkElement.href = newHref;

                          // Track old link for removal AFTER body patch (prevents flash)
                          linksToRemove.push(existingLink);

                          // Track this link for activation AFTER body is patched
                          linksToActivate.push(newLinkElement);

                          // Wait for new link to load AND be verified in CSSOM
                          const loadPromise = new Promise(function(resolve) {
                            let resolved = false;
                            const doResolve = function() {
                              if (resolved) return;
                              resolved = true;
                              // DON'T activate CSS here - keep media="print" hidden
                              // CSS will be activated AFTER body is patched to prevent flash
                              resolve();
                            };

                            // Helper to verify CSS is in CSSOM
                            const verifyCSSOM = function() {
                              try {
                                const sheets = Array.from(document.styleSheets);
                                return sheets.some(function(sheet) {
                                  return sheet.href && sheet.href.includes(newHref.split('?')[0]);
                                });
                              } catch (e) {
                                return false;
                              }
                            };

                            newLinkElement.onload = function() {
                              // Wait for CSSOM to register the stylesheet
                              var checkCount = 0;
                              var checkCSSOM = function() {
                                checkCount++;
                                if (verifyCSSOM() || checkCount > 10) {
                                  doResolve();
                                } else {
                                  requestAnimationFrame(checkCSSOM);
                                }
                              };
                              requestAnimationFrame(checkCSSOM);
                            };
                            newLinkElement.onerror = function() {
                              setTimeout(function() {
                                doResolve();
                              }, 50);
                            };

                            // Fallback: if onload doesn't fire, check sheet property
                            setTimeout(function() {
                              if (newLinkElement.sheet && !resolved) {
                                doResolve();
                              }
                            }, 100);

                            // Ultimate fallback: always resolve after 500ms to prevent stuck promises
                            setTimeout(function() {
                              if (!resolved) {
                                doResolve();
                              }
                            }, 500);
                          });

                          document.head.appendChild(newLinkElement);
                          linksToWaitFor.push(loadPromise);
                        }
                      } else {
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
                          linksToRemove.push(existingLink);
                        }
                      }
                    });
                    
                    // STEP 3: Wait for CSS to load BEFORE patching body to prevent flicker
                    const updateBodyAfterCSS = function() {
                      console.log('[HMR] updateBodyAfterCSS called');
                      const container = document.body;
                      if (!container) {
                        console.log('[HMR] ERROR: document.body not found');
                        return;
                      }
                      
                      // PRESERVE STATE: Extract counter from DOM
                      const counterSpan = container.querySelector('#counter');
                      const counterValue = counterSpan ? parseInt(counterSpan.textContent || '0', 10) : 0;
                      
                      const savedState = {
                        forms: saveFormState(),
                        scroll: saveScrollState(),
                        componentState: { count: counterValue }
                      };
                      
                      // Pre-fill counter value in new HTML to prevent flash of "0"
                      // This ensures the DOM patch shows the correct value immediately
                      if (counterValue > 0) {
                        htmlBody = htmlBody.replace(
                          new RegExp('<span id="counter">0<' + '/span>', 'g'),
                          '<span id="counter">' + counterValue + '<' + '/span>'
                        );
                      }
                      
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
                          // Clone ALL potentially interactive elements to remove old event listeners
                          // This prevents listener accumulation (e.g., counter incrementing by 2, 3, 4...)
                          // We clone instead of relying on data-hmr-listeners-attached (which scripts may not set)
                          var interactiveSelectors = 'button, [onclick], [onchange], [oninput], [onsubmit], ' +
                              'details, input[type="button"], input[type="submit"], input[type="reset"]';
                          container.querySelectorAll(interactiveSelectors).forEach(function(el) {
                            // Clone the element to remove all event listeners
                            var cloned = el.cloneNode(true);
                            if (el.parentNode) {
                              el.parentNode.replaceChild(cloned, el);
                            }
                          });

                          // Expose preserved state to window BEFORE scripts run
                          // Scripts can check window.__HMR_DOM_STATE__ for initial values
                          window.__HMR_DOM_STATE__ = {
                            count: savedState.componentState.count || 0
                          };

                          // Remove old script tags first to prevent duplicate execution
                          const scriptsInNewHTML = container.querySelectorAll('script[src]');
                          scriptsInNewHTML.forEach(function(script) {
                            // Don't remove HMR script
                            if (!script.hasAttribute('data-hmr-client')) {
                              script.remove();
                            }
                          });
                          
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
                          
                        }
                      });
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    };
                    
                    // Wait for CSS to load AND be fully applied before patching body (prevents flicker)
                    console.log('[HMR] linksToWaitFor count:', linksToWaitFor.length);
                    if (linksToWaitFor.length > 0) {
                      console.log('[HMR] Waiting for CSS to load...');
                      Promise.all(linksToWaitFor).then(function() {
                        console.log('[HMR] CSS loaded, waiting for paint...');
                        // Add delay to ensure CSS is fully painted (fixes Windows Chrome timing)
                        setTimeout(function() {
                          // Triple RAF ensures CSS is fully processed, painted, and styles applied
                          requestAnimationFrame(function() {
                            requestAnimationFrame(function() {
                              requestAnimationFrame(function() {
                                console.log('[HMR] Patching body');
                                // Patch body FIRST while new CSS is still hidden (media="print")
                                updateBodyAfterCSS();
                                console.log('[HMR] Body patched');
                                // NOW activate new CSS (change media to "all") - DOM structure is ready
                                linksToActivate.forEach(function(link) {
                                  link.media = 'all';
                                });
                                console.log('[HMR] CSS activated');
                                // Remove old CSS links AFTER body is patched and new CSS is active
                                requestAnimationFrame(function() {
                                  linksToRemove.forEach(function(link) {
                                    if (link.parentNode) {
                                      link.remove();
                                    }
                                  });
                                });
                              });
                            });
                          });
                        }, 50); // Small delay for CSS to be fully painted
                      });
                    } else {
                      console.log('[HMR] No CSS to wait for');

                      var doUpdate = function() {
                        requestAnimationFrame(function() {
                          requestAnimationFrame(function() {
                            requestAnimationFrame(function() {
                              updateBodyAfterCSS();
                              console.log('[HMR] Body patched (no CSS wait)');
                              // Remove old CSS links AFTER body is patched
                              requestAnimationFrame(function() {
                                linksToRemove.forEach(function(link) {
                                  if (link.parentNode) {
                                    link.remove();
                                  }
                                });
                              });
                            });
                          });
                        });
                      };

                      // On first HMR update, add delay for CSS/paint stabilization to prevent FOUC
                      if (isFirstHMRUpdate) {
                        console.log('[HMR] First update - adding CSS stabilization delay');
                        isFirstHMRUpdate = false;
                        setTimeout(doUpdate, 50);
                      } else {
                        doUpdate();
                      }
                    }
                  } else {
                    console.log('[HMR] No htmlHead, patching body directly');
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
                      
                      // Pre-fill counter value in new HTML to prevent flash of "0"
                      if (counterValue > 0) {
                        htmlBody = htmlBody.replace(
                          new RegExp('<span id="counter">0<' + '/span>', 'g'),
                          '<span id="counter">' + counterValue + '<' + '/span>'
                        );
                      }
                      
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
                        
                      });
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    
                    // Restore generic DOM state (inputs, selects, details, focus)
                    restoreDOMState(container, htmlDomState);
                    } else {
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                    }
                  }
                } else {
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                }
                break;
              }
                
              case 'htmx-update': {
                const htmxFrameworkCheck = detectCurrentFramework();
                
                if (htmxFrameworkCheck !== 'htmx') {
                  break;
                }
                
                // Clear React globals if they exist
                if (window.__REACT_ROOT__) {
                  window.__REACT_ROOT__ = undefined;
                }
                
                sessionStorage.setItem('__HMR_ACTIVE__', 'true');
                
                // Snapshot DOM state before HTMX patch
                const htmxDomState = saveDOMState(document.body);
                
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
                        }).catch(function() {
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

                      // Preserve counter in the incoming HTML to avoid visible flicker
                      if (savedState.componentState.count !== undefined) {
                        const newCounterSpan = tempDiv.querySelector('#count');
                        if (newCounterSpan) {
                          newCounterSpan.textContent = String(savedState.componentState.count);
                          htmxBody = tempDiv.innerHTML;
                        }
                      }
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
                      
                      // Restore generic DOM state (inputs, selects, details, focus)
                      restoreDOMState(container, htmxDomState);
                      
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
                        
                      }
                      
                      // Re-initialize HTMX on new content (always do this for HTMX, even for CSS-only updates)
                      // This ensures HTMX picks up any attribute changes (hx-*, classes, IDs, etc.)
                      if (window.htmx) {
                        window.htmx.process(container);
                      }
                    });
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
                    const linksToActivateHTMX = [];  // Track new CSS links to activate AFTER body patch
                    
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
                          const newLinkElement = document.createElement('link');
                          newLinkElement.rel = 'stylesheet';
                          // Start with media="print" to prevent FOUC - CSS loads but doesn't apply
                          newLinkElement.media = 'print';
                          const newHref = href + (href.includes('?') ? '&' : '?') + 't=' + Date.now();
                          newLinkElement.href = newHref;

                          // Track old link for removal AFTER body patch (prevents flash)
                          linksToRemoveHTMX.push(existingLink);

                          // Track this link for activation AFTER body is patched
                          linksToActivateHTMX.push(newLinkElement);

                          // Wait for new link to load AND be verified in CSSOM
                          const loadPromise = new Promise(function(resolve) {
                            let resolved = false;
                            const doResolve = function() {
                              if (resolved) return;
                              resolved = true;
                              // DON'T activate CSS here - keep media="print" hidden
                              // CSS will be activated AFTER body is patched to prevent flash
                              resolve();
                            };

                            // Helper to verify CSS is in CSSOM
                            const verifyCSSOM = function() {
                              try {
                                const sheets = Array.from(document.styleSheets);
                                return sheets.some(function(sheet) {
                                  return sheet.href && sheet.href.includes(newHref.split('?')[0]);
                                });
                              } catch (e) {
                                return false;
                              }
                            };

                            newLinkElement.onload = function() {
                              // Wait for CSSOM to register the stylesheet
                              var checkCount = 0;
                              var checkCSSOM = function() {
                                checkCount++;
                                if (verifyCSSOM() || checkCount > 10) {
                                  doResolve();
                                } else {
                                  requestAnimationFrame(checkCSSOM);
                                }
                              };
                              requestAnimationFrame(checkCSSOM);
                            };
                            newLinkElement.onerror = function() {
                              setTimeout(function() {
                                doResolve();
                              }, 50);
                            };

                            // Fallback: if onload doesn't fire, check sheet property
                            setTimeout(function() {
                              if (newLinkElement.sheet && !resolved) {
                                doResolve();
                              }
                            }, 100);

                            // Ultimate fallback: always resolve after 500ms to prevent stuck promises
                            setTimeout(function() {
                              if (!resolved) {
                                doResolve();
                              }
                            }, 500);
                          });

                          document.head.appendChild(newLinkElement);
                          linksToWaitForHTMX.push(loadPromise);
                          }
                        } else {
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
                          linksToRemoveHTMX.push(existingLink);
                        }
                      }
                    });
                    
                    // STEP 3: Wait for CSS to load before patching body (prevents flicker)
                    // Use requestAnimationFrame to batch CSS and DOM updates together
                    if (linksToWaitForHTMX.length > 0) {
                      Promise.all(linksToWaitForHTMX).then(function() {
                        // Add delay to ensure CSS is fully painted (fixes Windows Chrome timing)
                        setTimeout(function() {
                          // Triple RAF ensures CSS is fully processed, painted, and styles applied
                          requestAnimationFrame(function() {
                            requestAnimationFrame(function() {
                              requestAnimationFrame(function() {
                                // Patch body FIRST while new CSS is still hidden (media="print")
                                updateHTMXBodyAfterCSS();
                                // NOW activate new CSS (change media to "all") - DOM structure is ready
                                linksToActivateHTMX.forEach(function(link) {
                                  link.media = 'all';
                                });
                                // Remove old CSS links AFTER body is patched and new CSS is active
                                requestAnimationFrame(function() {
                                  linksToRemoveHTMX.forEach(function(link) {
                                    if (link.parentNode) {
                                      link.remove();
                                    }
                                  });
                                });
                              });
                            });
                          });
                        }, 50); // Small delay for CSS to be fully painted
                      });
                    } else {
                      // No CSS to wait for, patch body immediately
                      requestAnimationFrame(function() {
                        requestAnimationFrame(function() {
                          requestAnimationFrame(function() {
                            updateHTMXBodyAfterCSS();
                            // Remove old CSS links AFTER body is patched
                            requestAnimationFrame(function() {
                              linksToRemoveHTMX.forEach(function(link) {
                                if (link.parentNode) {
                                  link.remove();
                                }
                              });
                            });
                          });
                        });
                      });
                    }
                  } else {
                    // No head content, just update body immediately
                    updateHTMXBodyAfterCSS();
                  }
                } else {
                  sessionStorage.removeItem('__HMR_ACTIVE__');
                }
                break;
              }
                
              case 'svelte-update': {
                const svelteFrameworkCheck = detectCurrentFramework();

                if (svelteFrameworkCheck !== 'svelte') {
                  break;
                }

                // CSS-only update: hot-swap stylesheet without remounting component (preserves state!)
                if (message.data.updateType === 'css-only' && message.data.cssUrl) {
                  console.log('[HMR] Svelte CSS-only update (state preserved)');
                  var cssBaseName = message.data.cssBaseName || '';
                  var existingLink = null;
                  document.querySelectorAll('link[rel="stylesheet"]').forEach(function(link) {
                    var href = link.getAttribute('href') || '';
                    if (href.includes(cssBaseName) || href.includes('svelte')) {
                      existingLink = link;
                    }
                  });

                  if (existingLink) {
                    var newLink = document.createElement('link');
                    newLink.rel = 'stylesheet';
                    newLink.href = message.data.cssUrl + '?t=' + Date.now();
                    newLink.onload = function() {
                      if (existingLink && existingLink.parentNode) {
                        existingLink.remove();
                      }
                      console.log('[HMR] Svelte CSS updated');
                    };
                    document.head.appendChild(newLink);
                  }
                  break;
                }

                // Clear React globals if they exist
                if (window.__REACT_ROOT__) {
                  window.__REACT_ROOT__ = undefined;
                }

                sessionStorage.setItem('__HMR_ACTIVE__', 'true');

                // Try official HMR first: import the client module which triggers import.meta.hot.accept()
                // The accept handler destroys old component and mounts new one with preserved props
                if (message.data.clientModuleUrl) {
                  // Store current props before HMR
                  window.__SVELTE_PROPS__ = window.__SVELTE_PROPS__ || window.__INITIAL_PROPS__ || {};

                  var clientModuleUrl = message.data.clientModuleUrl + '?t=' + Date.now();
                  console.log('[HMR] Svelte official HMR: importing', clientModuleUrl);

                  import(/* @vite-ignore */ clientModuleUrl)
                    .then(function() {
                      sessionStorage.removeItem('__HMR_ACTIVE__');
                      console.log('[HMR] Svelte component updated via official HMR (state preserved)');
                    })
                    .catch(function(err) {
                      console.warn('[HMR] Svelte official HMR failed, trying fallback:', err);
                      // Fall back to index-based approach
                      performSvelteFallback();
                    });
                  break;
                }

                // Fallback: Index-based approach
                performSvelteFallback();

                function performSvelteFallback() {
                  try {
                    // Extract and preserve current state from DOM
                    var preservedState = {};
                    var button = document.querySelector('button');
                    if (button) {
                      var countMatch = button.textContent && button.textContent.match(/count is (\d+)/);
                      if (countMatch) {
                        preservedState.initialCount = parseInt(countMatch[1], 10);
                      }
                    }

                    // Set HMR flags for the Svelte index file to read
                    window.__SVELTE_HMR_UPDATE__ = true;
                    window.__HMR_PRESERVED_STATE__ = preservedState;

                    // Dynamically find index path from manifest
                    var indexPath = findIndexPath(message.data.manifest, message.data.sourceFile, 'svelte');
                    if (!indexPath) {
                      window.location.reload();
                      return;
                    }

                    // Import the index file with cache busting
                    var modulePath = indexPath + '?hmr=' + Date.now();
                    import(/* @vite-ignore */ modulePath)
                      .then(function() {
                        sessionStorage.removeItem('__HMR_ACTIVE__');
                        console.log('[HMR] Svelte component updated via fallback');
                      })
                      .catch(function() {
                        sessionStorage.removeItem('__HMR_ACTIVE__');
                        window.location.reload();
                      });
                  } catch (e) {
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                    window.location.reload();
                  }
                }
                break;
              }
                
              case 'vue-update': {
                const vueFrameworkCheck = detectCurrentFramework();

                if (vueFrameworkCheck !== 'vue') {
                  break;
                }

                // CSS-only update: hot-swap stylesheet without remounting component (preserves state!)
                if (message.data.updateType === 'css-only' && message.data.cssUrl) {
                  console.log('[HMR] Vue CSS-only update (state preserved)');
                  var cssBaseName = message.data.cssBaseName || '';
                  var existingLink = null;
                  document.querySelectorAll('link[rel="stylesheet"]').forEach(function(link) {
                    var href = link.getAttribute('href') || '';
                    if (href.includes(cssBaseName) || href.includes('vue')) {
                      existingLink = link;
                    }
                  });

                  if (existingLink) {
                    var newLink = document.createElement('link');
                    newLink.rel = 'stylesheet';
                    newLink.href = message.data.cssUrl + '?t=' + Date.now();
                    newLink.onload = function() {
                      if (existingLink && existingLink.parentNode) {
                        existingLink.remove();
                      }
                      console.log('[HMR] Vue CSS updated');
                    };
                    document.head.appendChild(newLink);
                  }
                  break;
                }

                sessionStorage.setItem('__HMR_ACTIVE__', 'true');

                // Save DOM state (form inputs, scroll, focus) before update
                var vueRoot = document.getElementById('root');
                var vueDomState = vueRoot ? saveDOMState(vueRoot) : null;

                // Extract Vue reactive state from DOM (counters, buttons with state)
                var vuePreservedState = {};
                var countButton = document.querySelector('button');
                if (countButton && countButton.textContent) {
                  var countMatch = countButton.textContent.match(/count is (\d+)/i);
                  if (countMatch) {
                    vuePreservedState.initialCount = parseInt(countMatch[1], 10);
                  }
                }

                // Set preserved state for Vue index to read
                window.__HMR_PRESERVED_STATE__ = vuePreservedState;

                // Unmount the old Vue app
                if (window.__VUE_APP__) {
                  window.__VUE_APP__.unmount();
                  window.__VUE_APP__ = null;
                }

                // Get the new HTML from the server
                var newHTML = message.data.html;
                if (!newHTML) {
                  window.location.reload();
                  break;
                }

                // Extract inner content
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = newHTML;
                var newRootDiv = tempDiv.querySelector('#root');
                var innerContent = newRootDiv ? newRootDiv.innerHTML : newHTML;

                // Pre-apply preserved state to HTML (prevents flicker showing count=0)
                if (vuePreservedState.initialCount !== undefined) {
                  innerContent = innerContent.replace(/count is 0/g, 'count is ' + vuePreservedState.initialCount);
                }

                // Update DOM
                if (vueRoot) {
                  vueRoot.innerHTML = innerContent;
                }

                // Find index path from manifest
                var indexPath = findIndexPath(message.data.manifest, message.data.sourceFile, 'vue');
                if (!indexPath) {
                  console.warn('[HMR] Vue index path not found, reloading');
                  window.location.reload();
                  break;
                }

                // Import the new index with proper cache-busting
                var modulePath = indexPath + '?t=' + Date.now();
                import(/* @vite-ignore */ modulePath)
                  .then(function() {
                    // Restore form state after Vue mounts
                    if (vueRoot && vueDomState) {
                      restoreDOMState(vueRoot, vueDomState);
                    }
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                    console.log('[HMR] Vue updated (state preserved)');
                  })
                  .catch(function(err) {
                    console.warn('[HMR] Vue import failed:', err);
                    sessionStorage.removeItem('__HMR_ACTIVE__');
                    window.location.reload();
                  });
                break;
              }
                
              case 'rebuild-error':
                break;
                
              case 'pong':
                break;
                
              case 'connected':
                break;
                
              default:
                break;
            }
          } catch {
          }
        };
        
        ws.onclose = function(event) {
          isConnected = false;
          
          if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
          }
          
          if (event.code !== 1000 && event.code !== 1001) {
            reconnectTimeout = setTimeout(function() {
              window.location.reload();
            }, 3000);
          }
        };
        
        ws.onerror = function() {
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
  
  // Guard: Don't inject if HMR script is already present (prevents double connection)
  if (html.includes('data-hmr-client')) {
    return html;
  }
  
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

