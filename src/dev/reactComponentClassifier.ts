import { resolve } from 'node:path';

/* Component classification for React Fast Refresh
   Distinguishes between Client Components and Server Components */
export type ComponentType = 'client' | 'server';

/* Classify a React component file as either 'client' or 'server'
   
   Rules:
   - Files in /react/pages/ → 'server' (Server Components - rendered on server)
   - Files in /react/components/ → 'client' (Client Components - client-only)
   - Files in /react/composables/ → 'client' (Client Components - client-only)
   - All other React files → 'client' (default to client for safety)
   
   This classification determines how HMR updates are handled:
   - Server Components: Re-render on server, send flight data, patch DOM
   - Client Components: Hot-replace module, re-render in client tree
*/
export function classifyComponent(filePath: string): ComponentType {
  const normalizedPath = resolve(filePath);
  
  // Server Components: Pages are rendered on the server
  if (normalizedPath.includes('/react/pages/')) {
    return 'server';
  }
  
  // Client Components: Components and composables are client-only
  if (
    normalizedPath.includes('/react/components/') ||
    normalizedPath.includes('/react/composables/')
  ) {
    return 'client';
  }
  
  // Default to 'client' for any other React files
  // This is safer than defaulting to 'server' because client components
  // can always be hot-replaced, but server components require special handling
  return 'client';
}

/* Check if a file path is a React file */
export function isReactFile(filePath: string): boolean {
  const normalizedPath = resolve(filePath);
  return /\.(tsx|jsx)$/.test(normalizedPath) && normalizedPath.includes('/react/');
}

