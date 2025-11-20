import type { HMRState } from './clientManager';
import { serializeModuleVersions } from './moduleVersionTracker';

/* Magic pt. 2 - when a browser connects to our WebSocket
   We send them the current manifest so they know what files exist
   Like giving them a menu of all the dishes we can serve */
export function handleClientConnect(
  state: HMRState,
  client: any,
  manifest: Record<string, string>
): void {
  state.connectedClients.add(client);
  
  // Send them the current state of the menu (manifest) and module versions
  const serverVersions = serializeModuleVersions(state.moduleVersions);
  client.send(JSON.stringify({
    data: {
      manifest,
      serverVersions
    },
    timestamp: Date.now(),
    type: 'manifest'
  }));
  
  // And confirm they're connected
  client.send(JSON.stringify({
    message: 'HMR client connected successfully', timestamp: Date.now(), type: 'connected'
  }));
}

/* When a client disconnects, remove them from our tracking
   This prevents memory leaks and keeps our client list clean */
export function handleClientDisconnect(state: HMRState, client: any): void {
  state.connectedClients.delete(client);
}

/* Handle messages from clients - they might ping us or request rebuilds
   We need to handle different message types because WebSocket is just a pipe/stream */
export function handleHMRMessage(state: HMRState, client: any, message: any): void {
  try {
    /* WebSocket messages can come in different formats
       sometimes they're strings, sometimes they're Buffers, sometimes they're objects...
       we need to handle all of them because JavaScript is weird like that */
    let data;
    
    if (typeof message === 'string') {
      data = JSON.parse(message);
    } else if (message instanceof Buffer) {
      data = JSON.parse(message.toString());
    } else if (message instanceof ArrayBuffer) {
      data = JSON.parse(new TextDecoder().decode(new Uint8Array(message)));
    } else if (ArrayBuffer.isView(message)) {
      data = JSON.parse(new TextDecoder().decode(message as Uint8Array));
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
        // Client is checking if we're alive - respond with pong
        client.send(JSON.stringify({ 
          timestamp: Date.now(), type: 'pong' 
        }));
        break;
        
      case 'request-rebuild':
        // Client wants us to rebuild everything - useful for debugging
        console.log('🔄 Client requested rebuild');
        // Note: triggerRebuild would be called from outside
        break;
        
      case 'ready':
        // Client is ready to receive updates - just log it
        console.log('✅ Client ready for HMR updates');
        break;
        
      case 'hydration-error':
        // Client reported a hydration error - log it for debugging
        if (data.data) {
          console.group('⚠️ Hydration Error Reported by Client');
          console.error('Component:', data.data.componentName);
          if (data.data.componentPath) {
            console.error('File:', data.data.componentPath);
          }
          console.error('Error:', data.data.error);
          console.groupEnd();
        }
        break;
        
      default:
        console.log('🤷 Unknown HMR message type:', data.type);
    }
  } catch (error) {
    console.error('❌ Error parsing HMR message:', error);
    console.log('📨 Raw message:', message);
  }
}

/* Send messages to all connected WebSocket clients
   this is how we notify browsers when files change */
export function broadcastToClients(state: HMRState, message: any): void {
  console.log('📢 Broadcasting to clients:', message.type);
  
  const messageStr = JSON.stringify({
    ...message,
    timestamp: Date.now()
  });
  
  const OPEN = (globalThis as any).WebSocket?.OPEN ?? 1;
  let sentCount = 0;
  const clientsToRemove: any[] = [];
  
  for (const client of state.connectedClients) {
    if (client.readyState === OPEN) { // WebSocket.OPEN
      try {
        client.send(messageStr);
        sentCount++;
      } catch (error) {
        console.error('❌ Failed to send message to client:', error);
        clientsToRemove.push(client);
      }
    } else {
      // Mark closed clients for removal
      clientsToRemove.push(client);
    }
  }
  
  // Remove closed/failed clients
  for (const client of clientsToRemove) {
    state.connectedClients.delete(client);
  }
  
  console.log(`📡 Message sent to ${sentCount} client(s) (${state.connectedClients.size} total connected)`);
}