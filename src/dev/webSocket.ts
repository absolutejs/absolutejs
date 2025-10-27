import type { HMRState } from './clientManager';

/* Magic pt. 2 - when a browser connects to our WebSocket
   We send them the current manifest so they know what files exist
   Like giving them a menu of all the dishes we can serve */
export function handleClientConnect(
  state: HMRState,
  client: any,
  manifest: Record<string, string>
): void {
  state.connectedClients.add(client);
  
  // Send them the current state of the menu (manifest)
  client.send(JSON.stringify({
    type: 'manifest',
    data: manifest,
    timestamp: Date.now()
  }));
  
  // And confirm they're connected
  client.send(JSON.stringify({
    type: 'connected',
    message: 'HMR client connected successfully',
    timestamp: Date.now()
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
          type: 'pong', 
          timestamp: Date.now() 
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
  
  for (const client of state.connectedClients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(messageStr);
      } catch (error) {
        console.error('❌ Failed to send message to client:', error);
        state.connectedClients.delete(client);
      }
    } else {
      // Remove closed clients
      state.connectedClients.delete(client);
    }
  }
  
  console.log(`📡 Message sent to ${state.connectedClients.size} clients`);
}