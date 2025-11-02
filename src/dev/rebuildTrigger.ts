import { build } from '../core/build';
import type { BuildConfig } from '../types';
import type { HMRState } from './clientManager';
import { detectFramework } from './pathUtils';
import { computeFileHash, hasFileChanged } from './fileHashTracker';
import { broadcastToClients } from './webSocket';

/* Queue a file change for processing
   This handles the "queue changes" problem with debouncing */
   export function queueFileChange(
    state: HMRState,
    filePath: string,
    config: BuildConfig,
    onRebuildComplete: (manifest: Record<string, string>) => void
  ): void {
    const framework = detectFramework(filePath);
    
    if (framework === 'ignored') {
      return;
    }
    
    // Compute current hash
    const currentHash = computeFileHash(filePath);
    
    // Check if file actually changed
    if (!hasFileChanged(filePath, currentHash, state.fileHashes)) {
      console.log(`⏭️ Skipping unchanged file: ${filePath}`);
      return;
    }
    
    // Update hash for future checks
    //state.fileHashes.set(filePath, currentHash);
    
    console.log(`🔥 File changed: ${filePath} (Framework: ${framework})`);
    
    // Get or create queue for this framework
    if (!state.fileChangeQueue.has(framework)) {
      state.fileChangeQueue.set(framework, []);
    }
    
    state.fileChangeQueue.get(framework)!.push(filePath);
    
    // If we're already rebuilding, just queue it and wait
    if (state.isRebuilding) {
      console.log('⏳ Rebuild in progress, queuing changes...');
  
      return;
    }
    
    // Clear any existing rebuild trigger
    if (state.rebuildTimeout) {
      clearTimeout(state.rebuildTimeout);
    }
    
    // EVENT-DRIVEN APPROACH: Wait for a short window to collect all changes
    const DEBOUNCE_MS = config.options?.hmr?.debounceMs ?? 500;
    state.rebuildTimeout = setTimeout((): void => {
    // Re-check hashes at the last moment to catch rapid edit/undo
    const filesToProcess: Map<string, string[]> = new Map(); // framework -> filePaths
    
    for (const [framework, filePaths] of state.fileChangeQueue) {
        const validFiles: string[] = [];
        
        for (const filePath of filePaths) {
        const currentHash = computeFileHash(filePath);
        
        // Check if file actually changed since last rebuild
        if (!state.fileHashes.has(filePath) || state.fileHashes.get(filePath) !== currentHash) {
            validFiles.push(filePath);
            // Update hash now since we're processing it
            state.fileHashes.set(filePath, currentHash);
        } else {
            console.log(`⏭️ Skipping unchanged file in batch: ${filePath}`);
        }
        }
        
        if (validFiles.length > 0) {
        filesToProcess.set(framework, validFiles);
        }
    }
    
    state.fileChangeQueue.clear();
    
    if (filesToProcess.size === 0) {
        console.log('✅ No actual changes detected in queued files');
        return;
    }
    
    const affectedFrameworks = Array.from(filesToProcess.keys());
    console.log(`🔄 Processing changes for: ${affectedFrameworks.join(', ')}`);

    // Add affected frameworks to the rebuild queue
    for (const framework of affectedFrameworks) {
        state.rebuildQueue.add(framework);
    }
    
    // Trigger rebuild - the callback will be called with the manifest
    void triggerRebuild(state, config, onRebuildComplete);
    }, DEBOUNCE_MS);
  }

/* Trigger a rebuild of the project
   This handles the "rebuild when needed" problem */
export async function triggerRebuild(
  state: HMRState,
  config: BuildConfig,
  onRebuildComplete: (manifest: Record<string, string>) => void
): Promise<Record<string, string> | null> {
  if (state.isRebuilding) {
    console.log('⏳ Rebuild already in progress, skipping...');

    return null;
  }

  state.isRebuilding = true;
  const affectedFrameworks = Array.from(state.rebuildQueue);
  state.rebuildQueue.clear();

  console.log(`🔄 Triggering rebuild for: ${affectedFrameworks.join(', ')}`);

  // Notify clients that rebuild is starting
  broadcastToClients(state, {
    data: { affectedFrameworks }, message: 'Rebuild started...', type: 'rebuild-start'
  });

  try {
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

    console.log('✅ Rebuild completed successfully');
    console.log('📋 Updated manifest keys:', Object.keys(manifest));

    // Notify clients of successful rebuild
    broadcastToClients(state, {
      data: { 
        affectedFrameworks, manifest
      }, message: 'Rebuild completed successfully', type: 'rebuild-complete'
    });

    // Send individual framework updates
    for (const framework of affectedFrameworks) {
      broadcastToClients(state, {
        data: { 
          framework,
          manifest
        }, message: `${framework} framework updated`, type: 'framework-update'
      });
    }
    
    // Call the callback with the new manifest
    onRebuildComplete(manifest);
    
    return manifest;

  } catch (error) {
    console.error('❌ Rebuild failed:', error);
    
    // Broadcast error to clients
    broadcastToClients(state, {
      data: { 
        affectedFrameworks, error: error instanceof Error ? error.message : String(error)
      }, message: 'Rebuild failed', type: 'rebuild-error'
    });
    
    return null;
  } finally {
    state.isRebuilding = false;
    // Flush changes accumulated during rebuild
    if (state.fileChangeQueue.size > 0) {
      const pending = Array.from(state.fileChangeQueue.keys());
      state.fileChangeQueue.clear();
      for (const f of pending) state.rebuildQueue.add(f);
      if (state.rebuildTimeout) clearTimeout(state.rebuildTimeout);
      state.rebuildTimeout = setTimeout(() => {
        void triggerRebuild(state, config, onRebuildComplete);
      }, 50);
    }
  }
}