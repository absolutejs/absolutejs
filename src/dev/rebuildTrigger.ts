import { build } from '../core/build';
import type { BuildConfig } from '../types';
import type { HMRState } from './clientManager';
import { detectFramework } from './pathUtils';
import { computeFileHash, hasFileChanged } from './fileHashTracker';
import { broadcastToClients } from './webSocket';
import { getAffectedFiles } from './dependencyGraph';
import { existsSync } from 'node:fs';

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
    
    console.log(`🔥 File changed: ${filePath} (Framework: ${framework})`);
    
    // Get or create queue for this framework
    if (!state.fileChangeQueue.has(framework)) {
      state.fileChangeQueue.set(framework, []);
    }
    
    // Deduplicate: don't add the same file to the queue multiple times
    const queue = state.fileChangeQueue.get(framework)!;
    if (!queue.includes(filePath)) {
      queue.push(filePath);
    }
    
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
      
      console.log('📊 === Dependency Graph Analysis ===');
      
      // Deduplicate files across the entire queue first
      const uniqueFilesByFramework = new Map<string, Set<string>>();
      for (const [framework, filePaths] of state.fileChangeQueue) {
        uniqueFilesByFramework.set(framework, new Set(filePaths));
      }
      
      for (const [framework, filePathSet] of uniqueFilesByFramework) {
        const validFiles: string[] = [];
        const processedFiles = new Set<string>(); // Track files we've already added
        
        for (const filePath of filePathSet) {
          // Skip files that no longer exist (deleted)
          if (!existsSync(filePath)) {
            console.log(`⏭️ Skipping deleted file: ${filePath}`);
            // Remove from hash tracking
            state.fileHashes.delete(filePath);
            // Still need to rebuild files that depended on this deleted file
            try {
              const affectedFiles = getAffectedFiles(state.dependencyGraph, filePath);
              for (const affectedFile of affectedFiles) {
                if (affectedFile !== filePath && !processedFiles.has(affectedFile) && existsSync(affectedFile)) {
                  validFiles.push(affectedFile);
                  processedFiles.add(affectedFile);
                  console.log(`  ✅ Added: ${affectedFile} (depends on deleted file ${filePath})`);
                }
              }
            } catch (error) {
              console.warn(`⚠️ Error getting affected files for deleted file ${filePath}:`, error);
            }
            continue;
          }
          
          // Compute hash at the LAST moment to catch rapid edit/undo
          const currentHash = computeFileHash(filePath);
          const storedHash = state.fileHashes.get(filePath);
          
          // Check if file actually changed since last rebuild
          // This is the critical check that prevents double rebuilds on edit/undo
          if (!storedHash || storedHash !== currentHash) {
            console.log(`\n🎯 Original changed file: ${filePath}`);
            console.log(`   Hash: ${storedHash || 'none'} → ${currentHash}`);
            
            // Add the changed file itself
            if (!processedFiles.has(filePath)) {
              validFiles.push(filePath);
              processedFiles.add(filePath);
              console.log(`  ✅ Added: ${filePath} (directly changed)`);
            }
            
            // Update hash NOW - this prevents the same file from being processed twice
            // if it was queued multiple times (edit then undo)
            state.fileHashes.set(filePath, currentHash);
            
            // Get all files that depend on this changed file
            try {
              const affectedFiles = getAffectedFiles(state.dependencyGraph, filePath);
              
              if (affectedFiles.length > 1) {
                console.log(`  📦 Found ${affectedFiles.length} affected files via dependency graph:`);
                affectedFiles.forEach((affectedFile) => {
                  if (affectedFile !== filePath) {
                    console.log(`    → ${affectedFile} (depends on ${filePath})`);
                  }
                });
              } else {
                console.log(`  ℹ️  No dependent files found for ${filePath}`);
              }
              
              // Add affected files to the rebuild queue
              for (const affectedFile of affectedFiles) {
                if (!processedFiles.has(affectedFile) && affectedFile !== filePath && existsSync(affectedFile)) {
                  validFiles.push(affectedFile);
                  processedFiles.add(affectedFile);
                  console.log(`  ✅ Added: ${affectedFile} (dependent file)`);
                }
              }
            } catch (error) {
              console.warn(`⚠️ Error processing dependencies for ${filePath}:`, error);
              // Still add the file itself even if dependency resolution fails
              if (!processedFiles.has(filePath)) {
                validFiles.push(filePath);
                processedFiles.add(filePath);
              }
            }
          } else {
            console.log(`⏭️ Skipping unchanged file in batch: ${filePath}`);
          }
        }
        
        if (validFiles.length > 0) {
          filesToProcess.set(framework, validFiles);
          console.log(`\n📋 Total files to rebuild for ${framework}: ${validFiles.length}`);
          validFiles.forEach((file, index) => {
            console.log(`  ${index + 1}. ${file}`);
          });
        }
      }
      
      state.fileChangeQueue.clear();
      
      if (filesToProcess.size === 0) {
        console.log('✅ No actual changes detected in queued files');
        return;
      }
      
      const affectedFrameworks = Array.from(filesToProcess.keys());
      console.log(`\n🔄 Processing changes for: ${affectedFrameworks.join(', ')}`);
      console.log('📊 === End Dependency Graph Analysis ===\n');

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