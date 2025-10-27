import { watch } from 'fs';
import { join } from 'path';
import type { BuildConfig } from '../types';
import type { HMRState } from './clientManager';
import { getWatchPaths, shouldIgnorePath } from './pathUtils';

/* Set up file watching for all configured directories
   This handles the "watch files" problem */
export function startFileWatching(
  state: HMRState,
  config: BuildConfig,
  onFileChange: (filePath: string) => void
): void {
  console.log('👀 Starting file watching with Bun native fs.watch...');
  
  const watchPaths = getWatchPaths(config);
  
  // Set up a watcher for each directory
  for (const path of watchPaths) {
    console.log(`🔥 Setting up Bun watcher for: ${path}`);
    
    const watcher = watch(
      path,
      { recursive: true },
      (event, filename) => {
        // Skip if no filename
        if (!filename) return;
        
        // Skip directory changes
        if (filename === 'compiled' || 
            filename === 'build' || 
            filename === 'indexes' ||
            filename.includes('/compiled') ||
            filename.includes('/build') ||
            filename.includes('/indexes') ||
            filename.endsWith('/')) {
          console.log(`🚫 Ignoring directory/non-file change: ${filename}`);

          return;
        }
        
        // Build the full path
        const fullPath = join(path, filename);
        
        // Apply ignore patterns
        if (shouldIgnorePath(fullPath)) {
          return;
        }
        
        // Call the callback handler
        onFileChange(fullPath);
      }
    );
    
    state.watchers.push(watcher);
  }
  
  console.log('✅ Bun native file watching started');
  console.log('👀 Watching directories:', watchPaths);
}