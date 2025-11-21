import { watch } from 'fs';
import { existsSync } from 'node:fs';
import { join } from 'path';
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
        
        // Handle file deletion
        if (event === 'rename' && !existsSync(fullPath)) {
          console.log(`🗑️  File deleted: ${fullPath}`);
          
          // Remove from dependency graph gracefully
          try {
            removeFileFromGraph(state.dependencyGraph, fullPath);
            console.log(`✅ Removed ${fullPath} from dependency graph`);
          } catch (error) {
            console.warn(`⚠️ Failed to remove ${fullPath} from dependency graph:`, error);
          }
          
          // Still trigger rebuild for files that depended on this one
          onFileChange(fullPath);

          return;
        }
        
        // Handle file creation/modification
        if (existsSync(fullPath)) {
          // Call the callback handler
          onFileChange(fullPath);
          
          // Track dependencies for incremental rebuilds
          // Wrap in try-catch to prevent errors from breaking the file watcher
          try {
            addFileToGraph(state.dependencyGraph, fullPath);
          } catch (error) {
            // Log but don't throw - dependency tracking failures shouldn't break HMR
            console.warn(`⚠️ Failed to track dependencies for ${fullPath}:`, error);
          }
        }
      }
    );
    
    state.watchers.push(watcher);
  }
  
  console.log('✅ Bun native file watching started');
  console.log('👀 Watching directories:', watchPaths);
}