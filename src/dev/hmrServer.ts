import { resolve as PATH_RESOLVE, sep as PATH_SEP } from 'node:path';
import { Elysia } from 'elysia';
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
import { createHMRState, type HMRState } from './clientManager';
import { startFileWatching } from './fileWatcher';
import { queueFileChange } from './rebuildTrigger';
import { handleClientConnect, handleClientDisconnect, handleHMRMessage } from './webSocket';

/* Build root directory for static file serving */
const ROOT_DIR = PATH_RESOLVE('./example/build');

/* Main entry point for the HMR server - orchestrates everything
   This replaces the old class-based approach with a functional one */
export async function startBunHMRDevServer(config: BuildConfig) {
  // Create initial state
  const state = createHMRState();
  
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
          console.log('Initializing HMR client...');
          
          const ws = new WebSocket(
            \`\${location.protocol === 'https:' ? 'wss' : 'ws'}://\${location.host}/hmr\`
          );
          let reconnectTimeout;
          let pingInterval;
          let isConnected = false;
          
          ws.onopen = function() {
            console.log('HMR client connected');
            isConnected = true;
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
              
              switch (message.type) {
                case 'manifest':
                  console.log('Received manifest:', Object.keys(message.data));
                  window.__HMR_MANIFEST__ = message.data;
                  break;
                  
                case 'rebuild-start':
                  console.log('Rebuild started for:', message.data.affectedFrameworks);
                  break;
                  
                case 'rebuild-complete':
                  console.log('Rebuild completed');
                  if (window.__HMR_MANIFEST__) {
                    window.__HMR_MANIFEST__ = message.data.manifest;
                  }
                  console.log('Reloading page due to rebuild...');
                  window.location.reload();
                  break;
                  
                case 'framework-update':
                  console.log('Framework updated:', message.data.framework);
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
            
            if (event.code !== 1000 && event.code !== 1001) {
              console.log('Connection lost, attempting to reconnect in 3 seconds...');
              reconnectTimeout = setTimeout(function() {
                console.log('Attempting to reconnect HMR client...');
                window.location.reload();
              }, 3000);
            }
          };
          
          ws.onerror = function(error) {
            console.error('HMR WebSocket error:', error);
            isConnected = false;
          };
          
          window.__HMR_WS__ = ws;
          
          window.addEventListener('beforeunload', function() {
            if (pingInterval) clearInterval(pingInterval);
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(1000, 'Page unloading');
            }
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
          const ReactModule = await import('../../example/react/pages/ReactExample');
          const indexPath = manifest['ReactExampleIndex'];
          if (!indexPath) {
            return new Response('ReactExampleIndex not found in manifest', { status: 500 });
          }
          const reactResponse = await handleReactPageRequest(
            ReactModule.ReactExample,
            indexPath,
            {
              cssPath: manifest['ReactExampleCSS'] || '',
              initialCount: 0
            }
          );

          return await injectHMRIntoResponse(reactResponse);
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
              return new Response(file);
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
    .listen(3000);
  
  const rebuildCallback = async (newManifest: Record<string, string>) => {
    manifest = newManifest;
  };
  
  startFileWatching(state, config, (filePath: string) => {
    queueFileChange(state, filePath, config, rebuildCallback);
  });
  
  console.log('Bun HMR Dev Server started');
  console.log('Server: http://localhost:3000');
  console.log('WebSocket: ws://localhost:3000/hmr');
  console.log('File watching: Active');
  console.log('Available routes:');
  console.log('  - http://localhost:3000/ (HTML)');
  console.log('  - http://localhost:3000/react (React)');
  console.log('  - http://localhost:3000/svelte (Svelte)');
  console.log('  - http://localhost:3000/vue (Vue)');
  console.log('  - http://localhost:3000/htmx (HTMX)');
  
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