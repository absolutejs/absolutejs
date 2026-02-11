import { watch } from 'fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'path';
import type { BuildConfig } from '../types';
import type { HMRState } from './clientManager';
import { addFileToGraph, removeFileFromGraph } from './dependencyGraph';
import { getWatchPaths, shouldIgnorePath } from './pathUtils';

/* Set up file watching for all configured directories
   This handles the "watch files" problem */
export function startFileWatching(
  state: HMRState,
  config: BuildConfig,
  onFileChange: (filePath: string) => void
): void {
  const watchPaths = getWatchPaths(config, state.resolvedPaths);
  
  // Set up a watcher for each directory
  for (const path of watchPaths) {
    // Resolve to absolute path for existsSync check (normalize to forward slashes for cross-platform)
    const absolutePath = resolve(path).replace(/\\/g, '/');
    
    if (!existsSync(absolutePath)) {
      continue;
    }
    
    const watcher = watch(
      absolutePath,
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
          return;
        }
        
        // Build the full path (normalize to forward slashes for cross-platform compatibility)
        const fullPath = join(absolutePath, filename).replace(/\\/g, '/');
        
        // Apply ignore patterns
        if (shouldIgnorePath(fullPath)) {
          return;
        }
        
        // Handle file deletion
        if (event === 'rename' && !existsSync(fullPath)) {
          try {
            removeFileFromGraph(state.dependencyGraph, fullPath);
          } catch {
          }
          
          // Still trigger rebuild for files that depended on this one
          onFileChange(fullPath);

          return;
        }
        
        // Handle file creation/modification
        if (existsSync(fullPath)) {
          // Call the callback handler
          onFileChange(fullPath);
          
          try {
            addFileToGraph(state.dependencyGraph, fullPath);
          } catch {
          }
        }
      }
    );
    
    state.watchers.push(watcher);
  }
  
}