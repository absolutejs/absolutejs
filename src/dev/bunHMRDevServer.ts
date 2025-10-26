// src/dev/bunHMRDevServer.ts
import { watch } from 'chokidar';
import { EventEmitter } from 'events';
import { build } from '../core/build';
import { BuildConfig } from '../types';
import { generateHeadElement } from '../utils/generateHeadElement';
import { Elysia } from 'elysia';
import { 
  handleHTMLPageRequest,
  handleReactPageRequest,
  handleSveltePageRequest,
  handleVuePageRequest,
  handleAngularPageRequest,
  handleHTMXPageRequest
} from '../core/pageHandlers';

/* OKAY SO THIS IS THE MAIN HMR SERVER CLASS - basically the brain of our whole hot reloading system
   We're using Bun's native HMR capabilities but ALSO building our own custom layer on top
   because we need to integrate with AbsoluteJS's build system and page handlers
   Going back to my analogies this is like having a smart kitchen that can cook any cuisine but also 
   has specialized chefs that can cook each cuisine perfectly */
export class BunHMRDevServer {
  private config: BuildConfig;
  private manifest: Record<string, string> = {};
  private server: any = null;
  // File watching stuff - chokidar is watching our source files like a hawk
  private fileWatcher: any = null;
  private isRebuilding: boolean = false;
  private rebuildQueue: Set<string> = new Set();
  private rebuildTimeout: NodeJS.Timeout | null = null;
  /* These are our set of WebSocket clients - basically browsers that are connected to us
     We need to track them so we can tell them when stuff changes */
  private connectedClients: Set<any> = new Set();

  constructor(config: BuildConfig) {
    this.config = config;
  }

  async start() {
    console.log('🔨 Building AbsoluteJS with HMR...');
    
    /* First we need to build everything so we have a starting point
       This is like prepping all the ingredients before we start cooking */
    this.manifest = await build({
      ...this.config,
      options: { 
        ...this.config.options,
        preserveIntermediateFiles: true 
      }
    });
  
    if (!this.manifest) {
      throw new Error('Build failed - no manifest generated');
    }
  
    console.log('✅ Build completed successfully');
    console.log('📋 Manifest keys:', Object.keys(this.manifest));
  
    /* Okay here's where the magic happens, we're using Elysia for WebSocket support because
       Bun's native WebSocket handling was being a pain in the ass Elysia gives us better control 
       over the WebSocket upgrade process we needed for our HMR system */
    this.server = new Elysia()
        .ws('/hmr', {
          open: (ws) => this.onClientConnect(ws),
          message: (ws, message) => this.onHMRMessage(ws, message),
          close: (ws) => this.onClientDisconnect(ws)
        })
        .get('*', (req) => this.handleRequest(req))
        .listen(3000);
  
    /* Start watching files AFTER the server is running
       This is important because we don't want to miss any changes
       or miss any updates*/
    await this.startFileWatching();
  
    console.log('🔥 Bun HMR Dev Server started');
    console.log('🌐 Server: http://localhost:3000');
    console.log('🔌 WebSocket: ws://localhost:3000/hmr');
    console.log('👀 File watching: Active');
    console.log('📄 Available routes:');
    console.log('  - http://localhost:3000/ (HTML)');
    console.log('  - http://localhost:3000/react (React)');
    console.log('  - http://localhost:3000/svelte (Svelte)');
    console.log('  - http://localhost:3000/vue (Vue)');
    console.log('  - http://localhost:3000/htmx (HTMX)');
  }

  /* Magic pt. 2 - when a browser connects to our WebSocket
     We send them the current manifest so they know what files exist
     Like giving them a menu of all the dishes we can serve */
  private async onClientConnect(ws: any) {
    console.log('🔥 HMR client connected');
    this.connectedClients.add(ws);
    
    // Send them the current state of the menu (manifest)
    ws.send(JSON.stringify({
      type: 'manifest',
      data: this.manifest,
      timestamp: Date.now()
    }));
    
    // Aaaaaand confirm they're connected
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'HMR client connected successfully',
      timestamp: Date.now()
    }));
  }

  /* Handle messages from clients - they might ping us or request rebuilds
     We need to handle different message types because WebSocket is just a pipe/stream */
  private onHMRMessage(ws: any, message: any) {
    try {
      /* Okay so this is the tricky part....WebSocket messages can come in different formats
         sometimes they're strings, sometimes they're Buffers, sometimes they're objects...
         we need to handle all of them because JavaScript is weird like that...literally anything goes */
      let data;
      
      if (typeof message === 'string') {
        data = JSON.parse(message);
      } else if (message instanceof Buffer) {
        data = JSON.parse(message.toString());
      } else if (typeof message === 'object') {
        // Message is already an object - no parsing needed
        data = message;
      } else {
        console.log('🤷 Unknown message type:', typeof message);
        return;
      }
      
      console.log('📨 HMR message received:', data.type);
      
      switch (data.type) {
        case 'ping':
          // Client is checking if we're alive - respond with pong to let them know we're still here
          ws.send(JSON.stringify({ 
            type: 'pong', 
            timestamp: Date.now() 
          }));
          break;
          
        case 'request-rebuild':
          // Client wants us to rebuild everything - useful for debugging or testing
          console.log('🔄 Client requested rebuild');
          this.triggerRebuild();
          break;
          
        case 'ready':
          // Client is ready to receive updates - just log it
          console.log('✅ Client ready for HMR updates');
          break;
          
        default:
          console.log('🤷 Unknown HMR message type:', data.type);
      }
    } catch (error) {
      console.error('❌ Error parsing HMR message:', error);
      console.log('📨 Raw message:', message);
    }
  }

  /* When a client disconnects, remove them from our tracking
     This prevents memory leaks and keeps our client list clean */
  private onClientDisconnect(ws: any) {
    console.log('🔥 HMR client disconnected');
    this.connectedClients.delete(ws);
  }

  /* THIS IS THE HEART OF THE SYSTEM - this method handles all incoming requests, 
     routes them to the appropriate page handlers and injects HMR client scripts
     it's like a smart waiter who knows exactly which chef to send each order to */
  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;
  
    try {
      // Route to appropriate handler based on pathname
      switch (pathname) {
        case '/':
        case '/html':
          // HTML is simple - just serve the file and inject the HMR script
          const htmlFile = await handleHTMLPageRequest('./example/build/html/pages/HtmlExample.html');
          const htmlContent = await htmlFile.text();
          const htmlWithHMR = this.injectHMRClient(htmlContent);
          return new Response(htmlWithHMR, {
            headers: { 'Content-Type': 'text/html' }
          });
          
        case '/react':
          // React needs special handling - we import the component and use React's SSR
          const ReactModule = await import('../../example/react/pages/ReactExample');
          const reactResponse = await handleReactPageRequest(
            ReactModule.ReactExample,
            this.manifest['ReactExampleIndex'] || '',
            {
              cssPath: this.manifest['ReactExampleCSS'] || '',
              initialCount: 0
            }
          );
          // Inject HMR into the response so React pages can hot reload
          return await this.injectHMRIntoResponse(reactResponse);
          
        case '/svelte':
          // Svelte is similar to React but uses its own SSR system
          const SvelteModule = await import('../../example/svelte/pages/SvelteExample.svelte');
          const svelteResponse = await handleSveltePageRequest(
            SvelteModule.default,
            this.manifest['SvelteExample'] || '',
            this.manifest['SvelteExampleIndex'] || '',
            {
              cssPath: this.manifest['SvelteExampleCSS'] || '',
              initialCount: 0
            }
          );
          // Inject HMR into the response so Svelte pages can hot reload
          return await this.injectHMRIntoResponse(svelteResponse);
          
        case '/vue':
          // Vue uses its own SSR system and needs special head element handling
          const VueModule = await import('../../example/vue/pages/VueExample.vue');
          const vueResponse = await handleVuePageRequest(
            VueModule.default,
            this.manifest['VueExample'] || '',
            this.manifest['VueExampleIndex'] || '',
            generateHeadElement({
              cssPath: this.manifest['VueExampleCSS'] || '',
              title: 'AbsoluteJS + Vue'
            }),
            {
              initialCount: 0
            }
          );
          // Inject HMR into the response so Vue pages can hot reload
          return await this.injectHMRIntoResponse(vueResponse);
          
        case '/htmx':
          // HTMX is like HTML but with special powers - serve it directly
          const htmxFile = await handleHTMXPageRequest('./example/build/htmx/pages/HTMXExample.html');
          const htmxContent = await htmxFile.text();
          const htmxWithHMR = this.injectHMRClient(htmxContent);
          return new Response(htmxWithHMR, {
            headers: { 'Content-Type': 'text/html' }
          });
          
        case '/hmr-status':
          // Debug endpoint - shows us what's going on with the HMR system
          return new Response(JSON.stringify({
            connectedClients: this.connectedClients.size,
            isRebuilding: this.isRebuilding,
            rebuildQueue: Array.from(this.rebuildQueue),
            manifestKeys: Object.keys(this.manifest),
            timestamp: Date.now()
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
          
        default:
          // Try to serve static files - CSS, JS, images, etc.
          const filePath = `./example/build${pathname}`;
          try {
            const file = Bun.file(filePath);
            if (await file.exists()) {
              return new Response(file);
            }
          } catch (error) {
            // File doesn't exist, continue to 404
          }
          
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error('❌ Error handling request:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  /* Magic pt. 3
     We use chokidar to watch all our source directories
     When files change, we detect which framework was 
     affected and trigger rebuilds */
  private async startFileWatching() {
    console.log('👀 Starting file watching...');
    
    const watchPaths = this.getWatchPaths();
    
    /* Configure chokidar to watch our source directories
       We ignore build directories because they would cause infinite loops
       (build creates files -> file watcher sees them -> triggers rebuild -> repeat) */
    this.fileWatcher = watch(watchPaths, {
      ignored: [
        /(^|[\/\\])\../, // ignore dotfiles
        /\/build\//, // ignore build directories
        /\/compiled\//, // ignore compiled directories
        /\/indexes\//, // ignore indexes directories (generated files)
        /\/node_modules\//, // ignore node_modules
        /\.(log|tmp)$/ // ignore log and temp files
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });
  
    // Set up event handlers for file changes
    this.fileWatcher
      .on('change', (filePath: string) => this.onFileChange(filePath))
      .on('add', (filePath: string) => this.onFileChange(filePath))
      .on('unlink', (filePath: string) => this.onFileChange(filePath))
      .on('error', (error: Error) => console.error('❌ File watcher error:', error));
  
    console.log('✅ File watching started for:', watchPaths);
    console.log('🚫 Ignoring build directories, compiled files, and indexes');
  }

  /* Get the directories we should watch based on our config
     only watch source directories, not build output directories */
  private getWatchPaths(): string[] {
    const paths: string[] = [];
    
    if (this.config.reactDirectory) {
      paths.push(this.config.reactDirectory);
    }
    if (this.config.svelteDirectory) {
      paths.push(this.config.svelteDirectory);
    }
    if (this.config.vueDirectory) {
      paths.push(this.config.vueDirectory);
    }
    if (this.config.angularDirectory) {
      paths.push(this.config.angularDirectory);
    }
    if (this.config.htmlDirectory) {
      paths.push(this.config.htmlDirectory);
    }
    if (this.config.htmxDirectory) {
      paths.push(this.config.htmxDirectory);
    }
    if (this.config.assetsDirectory) {
      paths.push(this.config.assetsDirectory);
    }
    
    return paths;
  }

  /* When a file changes, we need to figure out which framework was affected
     this is important because we only want to rebuild what actually changed */
  private async onFileChange(filePath: string) {
    console.log(`🔥 File changed: ${filePath}`);
    
    // Determine which framework was affected
    const framework = this.detectFramework(filePath);
    
    // Ignore build output files - they would cause infinite loops
    if (framework === 'ignored') {
      console.log(`🚫 Ignoring build file: ${filePath}`);
      return;
    }
    
    console.log(`🔥 Framework affected: ${framework}`);
    
    // Add to rebuild queue
    this.rebuildQueue.add(framework);
    
    /* Debounce rebuilds - wait 500ms for more changes before rebuilding
       this prevents rapid-fire rebuilds when multiple files change at once */
    if (this.rebuildTimeout) {
      clearTimeout(this.rebuildTimeout);
    }
    
    this.rebuildTimeout = setTimeout(() => {
      this.triggerRebuild();
    }, 500);
  }

  /* This function detects which framework a file belongs to based on 
     its path and extension this is crucial for knowing what to rebuild 
     when files change */
  private detectFramework(filePath: string): string {
    // Ignore build output files and generated files
    if (filePath.includes('/build/') || 
        filePath.includes('/compiled/') || 
        filePath.includes('/indexes/') ||  
        filePath.includes('/node_modules/')) {
      return 'ignored';
    }
  
    // Check for HTMX first because it's more specific than HTML
    if (filePath.includes('/htmx/')) {
      return 'htmx';
    }
    if (filePath.includes('/react/') || filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
      return 'react';
    }
    if (filePath.includes('/svelte/') || filePath.endsWith('.svelte')) {
      return 'svelte';
    }
    if (filePath.includes('/vue/') || filePath.endsWith('.vue')) {
      return 'vue';
    }
    if (filePath.includes('/angular/') || (filePath.endsWith('.ts') && filePath.includes('angular'))) {
      return 'angular';
    }
    if (filePath.includes('/html/') || filePath.endsWith('.html')) {
      return 'html';
    }
    if (filePath.includes('/assets/') || filePath.endsWith('.css')) {
      return 'assets';
    }
    return 'unknown';
  }

  /* Magic pt. 4
     When files change, we trigger a rebuild and notify all connected clients */
  private async triggerRebuild() {
    if (this.isRebuilding) {
      console.log('⏳ Rebuild already in progress, skipping...');
      return;
    }
  
    this.isRebuilding = true;
    const affectedFrameworks = Array.from(this.rebuildQueue);
    this.rebuildQueue.clear();
  
    console.log(`🔄 Triggering rebuild for: ${affectedFrameworks.join(', ')}`);
  
    // Notify clients that rebuild is starting
    this.broadcastToClients({
      type: 'rebuild-start',
      data: { affectedFrameworks },
      message: 'Rebuild started...'
    });
  
    try {
      // Perform the actual rebuild using AbsoluteJS's build system
      this.manifest = await build({
        ...this.config,
        options: { 
          ...this.config.options,
          preserveIntermediateFiles: true 
        }
      });
  
      if (!this.manifest) {
        throw new Error('Build failed - no manifest generated');
      }
  
      console.log('✅ Rebuild completed successfully');
      console.log('📋 Updated manifest keys:', Object.keys(this.manifest));
  
      // Broadcast successful rebuild to all connected clients
      this.broadcastToClients({
        type: 'rebuild-complete',
        data: { 
          manifest: this.manifest,
          affectedFrameworks
        },
        message: 'Rebuild completed successfully'
      });
  
      // Send individual framework updates
      for (const framework of affectedFrameworks) {
        this.broadcastToClients({
          type: 'framework-update',
          data: { 
            framework,
            manifest: this.manifest
          },
          message: `${framework} framework updated`
        });
      }
  
    } catch (error) {
      console.error('❌ Rebuild failed:', error);
      
      // Broadcast error to clients
      this.broadcastToClients({
        type: 'rebuild-error',
        data: { 
          error: error.message,
          affectedFrameworks
        },
        message: 'Rebuild failed'
      });
    } finally {
      this.isRebuilding = false;
    }
  }

  /* Helper method to inject HMR into any HTML response
     this is used for framework responses that return HTML */
  private async injectHMRIntoResponse(response: Response): Promise<Response> {
    const contentType = response.headers.get('content-type');
    
    // Only inject HMR into HTML responses
    if (contentType && contentType.includes('text/html')) {
      const htmlContent = await response.text();
      const htmlWithHMR = this.injectHMRClient(htmlContent);
      return new Response(htmlWithHMR, {
        headers: response.headers
      });
    }
    
    // Return original response for non-HTML content
    return response;
  }

  /* Inject HMR client script into HTML responses
     This is the client-side code that connects to 
     our WebSocket server */
  private injectHMRClient(html: string): string {
    // Check if HMR script is already injected to prevent duplicates
    const hmrScript = `
      <script>
        (function() {
          console.log('🔥 Initializing HMR client...');
          
          const ws = new WebSocket('ws://localhost:3000/hmr');
          let reconnectTimeout;
          let pingInterval;
          let isConnected = false;
          
          ws.onopen = function() {
            console.log('🔥 HMR client connected');
            isConnected = true;
            ws.send(JSON.stringify({ type: 'ready' }));
            
            // Clear any existing reconnect timeout
            if (reconnectTimeout) {
              clearTimeout(reconnectTimeout);
              reconnectTimeout = null;
            }
            
            // Start ping interval only after successful connection
            pingInterval = setInterval(function() {
              if (ws.readyState === WebSocket.OPEN && isConnected) {
                ws.send(JSON.stringify({ type: 'ping' }));
              }
            }, 30000); // Ping every 30 seconds
          };
          
          ws.onmessage = function(event) {
            try {
              const message = JSON.parse(event.data);
              console.log('📨 HMR message received:', message.type);
              
              switch (message.type) {
                case 'manifest':
                  console.log('📋 Received manifest:', Object.keys(message.data));
                  window.__HMR_MANIFEST__ = message.data;
                  break;
                  
                case 'rebuild-start':
                  console.log('🔄 Rebuild started for:', message.data.affectedFrameworks);
                  break;
                  
                case 'rebuild-complete':
                  console.log('✅ Rebuild completed');
                  console.log('🔍 DEBUG: About to check manifest...');
                  if (window.__HMR_MANIFEST__) {
                    window.__HMR_MANIFEST__ = message.data.manifest;
                    console.log('🔍 DEBUG: Manifest updated');
                  }
                  // Only reload if this is a real rebuild, not a ping response
                  console.log('🔄 Reloading page due to rebuild...');
                  window.location.reload();
                  break;
                  
                case 'framework-update':
                  console.log('🎨 Framework updated:', message.data.framework);
                  break;
                  
                case 'rebuild-error':
                  console.error('❌ Rebuild error:', message.data.error);
                  break;
                  
                case 'pong':
                  console.log('🏓 Pong received - connection healthy');
                  break;
                  
                case 'connected':
                  console.log('✅ HMR connection confirmed');
                  break;
                  
                default:
                  console.log('🤷 Unknown HMR message:', message.type);
              }
            } catch (error) {
              console.error('❌ Error processing HMR message:', error);
            }
          };
          
          ws.onclose = function(event) {
            console.log('🔥 HMR client disconnected', event.code, event.reason);
            isConnected = false;
            
            // Clear ping interval
            if (pingInterval) {
              clearInterval(pingInterval);
              pingInterval = null;
            }
            
            // Only attempt to reconnect if it wasn't a clean close
            if (event.code !== 1000 && event.code !== 1001) {
              console.log('🔄 Connection lost, attempting to reconnect in 3 seconds...');
              reconnectTimeout = setTimeout(function() {
                console.log('🔄 Attempting to reconnect HMR client...');
                window.location.reload();
              }, 3000);
            }
          };
          
          ws.onerror = function(error) {
            console.error('❌ HMR WebSocket error:', error);
            isConnected = false;
          };
          
          // Store WebSocket reference for debugging
          window.__HMR_WS__ = ws;
          
          // Add cleanup on page unload
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
    
    // Inject the script before the closing </body> tag
    return html.replace('</body>', `${hmrScript}</body>`);
  }

  /* Send messages to all connected WebSocket clients
     this is how we notify browsers when files change */
  private broadcastToClients(message: any) {
    console.log('📢 Broadcasting to clients:', message.type);
    
    const messageStr = JSON.stringify({
      ...message,
      timestamp: Date.now()
    });
    
    for (const client of this.connectedClients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(messageStr);
        } catch (error) {
          console.error('❌ Failed to send message to client:', error);
          this.connectedClients.delete(client);
        }
      } else {
        // Remove closed clients
        this.connectedClients.delete(client);
      }
    }
    
    console.log(`📡 Message sent to ${this.connectedClients.size} clients`);
  }

  // Clean shutdown - stop file watching and close the server
  async stop() {
    // Stop file watching
    if (this.fileWatcher) {
      await this.fileWatcher.close();
      console.log('👀 File watching stopped');
    }
  
    // Clear rebuild timeout
    if (this.rebuildTimeout) {
      clearTimeout(this.rebuildTimeout);
    }
  
    // Stop server
    if (this.server) {
      this.server.stop();
      console.log('🛑 HMR Dev Server stopped');
    }
  }
}

// Convenience function to start the HMR server
export async function startBunHMRDevServer(config: BuildConfig) {
  const server = new BunHMRDevServer(config);
  await server.start();
  return server;
}