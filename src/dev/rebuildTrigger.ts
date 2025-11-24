import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from '../core/build';
import type { BuildConfig } from '../types';
import type { HMRState } from './clientManager';
import { incrementSourceFileVersions } from './clientManager';
import { getAffectedFiles } from './dependencyGraph';
import { computeFileHash, hasFileChanged } from './fileHashTracker';
import { createModuleUpdates, groupModuleUpdatesByFramework } from './moduleMapper';
import { incrementModuleVersions, serializeModuleVersions } from './moduleVersionTracker';
import { detectFramework } from './pathUtils';
import { broadcastToClients } from './webSocket';
// Note: Removed serverComponentRenderer and ssrCache imports - React HMR is now simplified

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
      for (const [fwKey, filePaths] of state.fileChangeQueue) {
        uniqueFilesByFramework.set(fwKey, new Set(filePaths));
      }
      
      for (const [fwKey, filePathSet] of uniqueFilesByFramework) {
        const validFiles: string[] = [];
        const processedFiles = new Set<string>(); // Track files we've already added
        
        for (const filePathInSet of filePathSet) {
          // Skip files that no longer exist (deleted)
          if (!existsSync(filePathInSet)) {
            console.log(`⏭️ Skipping deleted file: ${filePathInSet}`);
            // Remove from hash tracking
            state.fileHashes.delete(filePathInSet);
            // Still need to rebuild files that depended on this deleted file
            try {
              const affectedFiles = getAffectedFiles(state.dependencyGraph, filePathInSet);
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
          const fileHash = computeFileHash(filePathInSet);
          const storedHash = state.fileHashes.get(filePathInSet);
          
          // Check if file actually changed since last rebuild
          // This is the critical check that prevents double rebuilds on edit/undo
          if (!storedHash || storedHash !== fileHash) {
            // Normalize filePath to absolute path for consistent comparison
            // getAffectedFiles returns absolute paths, so we need to normalize here too
            const normalizedFilePath = resolve(filePathInSet);
            
            console.log(`\n🎯 Original changed file: ${filePath}`);
            console.log(`   Hash: ${storedHash || 'none'} → ${currentHash}`);
            
            // Add the changed file itself (using normalized path)
            if (!processedFiles.has(normalizedFilePath)) {
              validFiles.push(normalizedFilePath);
              processedFiles.add(normalizedFilePath);
              console.log(`  ✅ Added: ${normalizedFilePath} (directly changed)`);
            }
            
            // Update hash NOW - this prevents the same file from being processed twice
            // if it was queued multiple times (edit then undo)
            // Store hash using original relative path for consistency with file watcher
            state.fileHashes.set(filePath, currentHash);
            
            // Increment source file version to force Bun to treat it as a new module
            // This bypasses Bun's module cache by appending version to import path
            incrementSourceFileVersions(state, [normalizedFilePath]);
            
            // CRITICAL: Also increment versions of files that import this file
            // When App.tsx changes, ReactExample.tsx needs a new version too
            // This forces ReactExample.tsx to re-import App.tsx fresh (bypassing cache)
            try {
              const dependents = state.dependencyGraph.dependents.get(normalizedFilePath);
              if (dependents && dependents.size > 0) {
                const dependentFiles = Array.from(dependents).filter(f => existsSync(f));
                if (dependentFiles.length > 0) {
                  console.log(`  🔄 Incrementing versions for ${dependentFiles.length} dependent file(s) to force fresh imports`);
                  incrementSourceFileVersions(state, dependentFiles);
                }
              }
            } catch (error) {
              console.warn(`⚠️ Error finding dependents for ${filePath}:`, error);
            }
            
            // Get all files that depend on this changed file
            try {
              const affectedFiles = getAffectedFiles(state.dependencyGraph, normalizedFilePath);
              
              if (affectedFiles.length > 1) {
                console.log(`  📦 Found ${affectedFiles.length} affected files via dependency graph:`);
                affectedFiles.forEach((affectedFile) => {
                  if (affectedFile !== normalizedFilePath) {
                    console.log(`    → ${affectedFile} (depends on ${normalizedFilePath})`);
                  }
                });
              } else {
                console.log(`  ℹ️  No dependent files found for ${normalizedFilePath}`);
              }
              
              // Add affected files to the rebuild queue
              for (const affectedFile of affectedFiles) {
                if (!processedFiles.has(affectedFile) && affectedFile !== normalizedFilePath && existsSync(affectedFile)) {
                  validFiles.push(affectedFile);
                  processedFiles.add(affectedFile);
                  console.log(`  ✅ Added: ${affectedFile} (dependent file)`);
                }
              }
            } catch (error) {
              console.warn(`⚠️ Error processing dependencies for ${filePath}:`, error);
              // Still add the file itself even if dependency resolution fails
              if (!processedFiles.has(normalizedFilePath)) {
                validFiles.push(normalizedFilePath);
                processedFiles.add(normalizedFilePath);
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
    for (const frameworkKey of affectedFrameworks) {
      state.rebuildQueue.add(frameworkKey);
    }
    
      // Collect all files to rebuild
      const filesToRebuild: string[] = [];
      for (const [, filePaths] of filesToProcess) {
        filesToRebuild.push(...filePaths);
      }
      
      // Trigger rebuild - the callback will be called with the manifest
      void triggerRebuild(state, config, onRebuildComplete, filesToRebuild);
    }, DEBOUNCE_MS);
}

/* Trigger a rebuild of the project
   This handles the "rebuild when needed" problem */
export async function triggerRebuild(
  state: HMRState,
  config: BuildConfig,
  onRebuildComplete: (manifest: Record<string, string>) => void,
  filesToRebuild?: string[]
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
    if (filesToRebuild && filesToRebuild.length > 0) {
      console.log(`🚀 Starting incremental build for ${filesToRebuild.length} file(s)`);
    } else {
      console.log('🚀 Starting full build');
    }
    
    const manifest = await build({
      ...config,
      incrementalFiles: filesToRebuild && filesToRebuild.length > 0 ? filesToRebuild : undefined,
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

    // Create smart module updates from changed files
    if (filesToRebuild && filesToRebuild.length > 0) {
      const allModuleUpdates: Array<{ sourceFile: string; framework: string; moduleKeys: string[]; modulePaths: Record<string, string>; componentType?: 'client' | 'server' }> = [];
      
      // Group changed files by framework and create module updates
      for (const framework of affectedFrameworks) {
        const frameworkFiles = filesToRebuild.filter(file => detectFramework(file) === framework);
        
        if (frameworkFiles.length > 0) {
          const moduleUpdates = createModuleUpdates(frameworkFiles, framework, manifest);
          
          if (moduleUpdates.length > 0) {
            allModuleUpdates.push(...moduleUpdates);
            
            // Log component types for React updates
            if (framework === 'react') {
              const serverComponents = moduleUpdates.filter(u => u.componentType === 'server').length;
              const clientComponents = moduleUpdates.filter(u => u.componentType === 'client').length;
              if (serverComponents > 0 || clientComponents > 0) {
                console.log(`📦 Found ${moduleUpdates.length} module update(s) for ${framework} (${serverComponents} server, ${clientComponents} client)`);
              } else {
                console.log(`📦 Found ${moduleUpdates.length} module update(s) for ${framework}`);
              }
            } else {
              console.log(`📦 Found ${moduleUpdates.length} module update(s) for ${framework}`);
            }
          } else {
            // For files without direct manifest entries (like React components),
            // the dependency graph ensures dependent pages are in filesToRebuild
            // Those pages will have module updates created above
            console.log(`ℹ️  ${frameworkFiles.length} ${framework} file(s) changed, but no direct manifest entries (likely components)`);
          }
        }
      }
      
      // Simple React HMR: Re-render and send HTML patch
      if (affectedFrameworks.includes('react') && filesToRebuild) {
        const reactFiles = filesToRebuild.filter(file => detectFramework(file) === 'react');
        
        if (reactFiles.length > 0) {
          console.log(`🔄 React file(s) changed, re-rendering...`);
          
          // Find the React page component (ReactExample.tsx)
          const reactPagePath = reactFiles.find(f => f.includes('/react/pages/ReactExample.tsx')) 
            || resolve('./example/react/pages/ReactExample.tsx');
          
          // Simple approach: Re-import with cache busting, re-render, send HTML
          try {
            const { handleReactUpdate } = await import('./simpleReactHMR');
            console.log('📦 Calling handleReactUpdate for:', reactPagePath);
            const newHTML = await handleReactUpdate(reactPagePath, manifest);
            
            if (newHTML) {
              console.log('✅ Got HTML from handleReactUpdate, length:', newHTML.length);
              // Send simple HTML update to clients
              broadcastToClients(state, {
                data: {
                  framework: 'react', html: newHTML, manifest, sourceFile: reactPagePath
                }, type: 'react-update'
    });
              console.log('✅ React update sent to clients');
            } else {
              console.warn('⚠️ handleReactUpdate returned null/undefined - no HTML to send');
            }
          } catch (error) {
            console.error('❌ Failed to handle React update:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : String(error));
          }
        }
      }
      
      // Simple HTML HMR: Read HTML file and send HTML patch
      if (affectedFrameworks.includes('html') && filesToRebuild) {
        const htmlFiles = filesToRebuild.filter(file => detectFramework(file) === 'html');
        
        if (htmlFiles.length > 0) {
          console.log(`🔄 HTML file(s) changed, reading...`);
          
          // Find the HTML page file (HtmlExample.html)
          const htmlPagePath = htmlFiles.find(f => f.includes('/html/pages/HtmlExample.html')) 
            || resolve('./example/html/pages/HtmlExample.html');
          
          // Simple approach: Read HTML file, extract body, send HTML patch
          try {
            const { handleHTMLUpdate } = await import('./simpleHTMLHMR');
            console.log('📦 Calling handleHTMLUpdate for:', htmlPagePath);
            const newHTML = await handleHTMLUpdate(htmlPagePath);
            
            if (newHTML) {
              console.log('✅ Got HTML from handleHTMLUpdate, length:', newHTML.length);
              // Send simple HTML update to clients
              broadcastToClients(state, {
                data: {
                  framework: 'html', html: newHTML, sourceFile: htmlPagePath
                }, type: 'html-update'
              });
              console.log('✅ HTML update sent to clients');
            } else {
              console.warn('⚠️ handleHTMLUpdate returned null/undefined - no HTML to send');
            }
          } catch (error) {
            console.error('❌ Failed to handle HTML update:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : String(error));
          }
        }
      }
      
      // Simple Vue HMR: Re-compile and re-render, send HTML patch
      // NOTE: Vue HMR happens AFTER the rebuild completes, so we have the updated manifest
      if (affectedFrameworks.includes('vue') && filesToRebuild) {
        const vueFiles = filesToRebuild.filter(file => detectFramework(file) === 'vue');
        
        if (vueFiles.length > 0) {
          console.log(`🔄 Vue file(s) changed, re-compiling...`);
          
          // Find the Vue page component (VueExample.vue)
          const vuePagePath = vueFiles.find(f => f.includes('/vue/pages/VueExample.vue')) 
            || resolve('./example/vue/pages/VueExample.vue');
          
          // Simple approach: Re-compile with cache invalidation, re-render, send HTML
          // The manifest passed here is the UPDATED manifest from the rebuild
          try {
            const { handleVueUpdate } = await import('./simpleVueHMR');
            console.log('📦 Calling handleVueUpdate for:', vuePagePath);
            const newHTML = await handleVueUpdate(vuePagePath, manifest);
            
            if (newHTML) {
              console.log('✅ Got HTML from handleVueUpdate, length:', newHTML.length);
              // Send simple HTML update to clients with the updated manifest
              broadcastToClients(state, {
                data: {
                  framework: 'vue', html: newHTML, manifest
// This is the updated manifest from the rebuild, sourceFile: vuePagePath // This is the updated manifest from the rebuild
                }, type: 'vue-update'
              });
              console.log('✅ Vue update sent to clients');
            } else {
              console.warn('⚠️ handleVueUpdate returned null/undefined - no HTML to send');
            }
          } catch (error) {
            console.error('❌ Failed to handle Vue update:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : String(error));
          }
        }
      }

      // Simple Svelte HMR: Re-compile and re-render, send HTML patch
      // NOTE: Svelte HMR happens AFTER the rebuild completes, so we have the updated manifest
      if (affectedFrameworks.includes('svelte') && filesToRebuild) {
        const svelteFiles = filesToRebuild.filter(file => detectFramework(file) === 'svelte');
        
        if (svelteFiles.length > 0) {
          console.log(`🔄 Svelte file(s) changed, re-compiling...`);
          
          // Find the Svelte page component (SvelteExample.svelte)
          const sveltePagePath = svelteFiles.find(f => f.includes('/svelte/pages/SvelteExample.svelte')) 
            || resolve('./example/svelte/pages/SvelteExample.svelte');
          
          // Simple approach: Re-compile with cache invalidation, re-render, send HTML
          // The manifest passed here is the UPDATED manifest from the rebuild
          try {
            const { handleSvelteUpdate } = await import('./simpleSvelteHMR');
            console.log('📦 Calling handleSvelteUpdate for:', sveltePagePath);
            const newHTML = await handleSvelteUpdate(sveltePagePath, manifest);
            
            if (newHTML) {
              console.log('✅ Got HTML from handleSvelteUpdate, length:', newHTML.length);
              // Send simple HTML update to clients with the updated manifest
              broadcastToClients(state, {
                data: {
                  framework: 'svelte', html: newHTML, manifest
// This is the updated manifest from the rebuild, sourceFile: sveltePagePath // This is the updated manifest from the rebuild
                }, type: 'svelte-update'
              });
              console.log('✅ Svelte update sent to clients');
            } else {
              console.warn('⚠️ handleSvelteUpdate returned null/undefined - no HTML to send');
            }
          } catch (error) {
            console.error('❌ Failed to handle Svelte update:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : String(error));
          }
        }
      }
      
      // Simple HTMX HMR: Read HTMX file and send HTML patch
      if (affectedFrameworks.includes('htmx') && filesToRebuild) {
        const htmxFiles = filesToRebuild.filter(file => detectFramework(file) === 'htmx');
        
        if (htmxFiles.length > 0) {
          console.log(`🔄 HTMX file(s) changed, reading...`);
          
          // Find the HTMX page file (HTMXExample.html)
          const htmxPagePath = htmxFiles.find(f => f.includes('/htmx/pages/HTMXExample.html')) 
            || resolve('./example/htmx/pages/HTMXExample.html');
          
          try {
            const { handleHTMXUpdate } = await import('./simpleHTMXHMR');
            console.log('📦 Calling handleHTMXUpdate for:', htmxPagePath);
            const newHTML = await handleHTMXUpdate(htmxPagePath);
            
            if (newHTML) {
              console.log('✅ Got HTML from handleHTMXUpdate, length:', newHTML.length);
              broadcastToClients(state, {
                data: {
                  framework: 'htmx', html: newHTML, sourceFile: htmxPagePath
                }, type: 'htmx-update'
              });
              console.log('✅ HTMX update sent to clients');
            } else {
              console.warn('⚠️ handleHTMXUpdate returned null/undefined - no HTML to send');
            }
          } catch (error) {
            console.error('❌ Failed to handle HTMX update:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : String(error));
          }
        }
      }
      
      // Increment module versions for all updated modules
      const updatedModulePaths: string[] = [];
      for (const update of allModuleUpdates) {
        // Add source file path
        updatedModulePaths.push(update.sourceFile);
        // Add all manifest module paths
        for (const modulePath of Object.values(update.modulePaths)) {
          updatedModulePaths.push(modulePath);
        }
      }
      
      if (updatedModulePaths.length > 0) {
        const versionUpdates = incrementModuleVersions(state.moduleVersions, updatedModulePaths);
        console.log(`📌 Updated versions for ${versionUpdates.size} module(s)`);
      }
      
      // Send module-level updates grouped by framework
      if (allModuleUpdates.length > 0) {
        const updatesByFramework = groupModuleUpdatesByFramework(allModuleUpdates);
        const serverVersions = serializeModuleVersions(state.moduleVersions);
        
        for (const [framework, updates] of updatesByFramework) {
          console.log(`📤 Broadcasting ${updates.length} module update(s) for ${framework}`);
          
          // Get versions for updated modules
          const moduleVersions: Record<string, number> = {};
          for (const update of updates) {
            const sourceVersion = state.moduleVersions.get(update.sourceFile);
            if (sourceVersion !== undefined) {
              moduleVersions[update.sourceFile] = sourceVersion;
            }
            for (const [, path] of Object.entries(update.modulePaths)) {
              const pathVersion = state.moduleVersions.get(path);
              if (pathVersion !== undefined) {
                moduleVersions[path] = pathVersion;
              }
            }
          }
          
          broadcastToClients(state, {
            data: {
              framework, manifest, modules: updates.map(update => ({
                componentType: update.componentType, moduleKeys: update.moduleKeys, modulePaths: update.modulePaths, sourceFile: update.sourceFile, // Include component type for React Fast Refresh
version: state.moduleVersions.get(update.sourceFile)
// Include version // Include version
              })), // Include full manifest for reference
moduleVersions: moduleVersions, // Include versions for updated modules
serverVersions: serverVersions
// Include all server versions for sync check // Include all server versions for sync check
            },
            message: `${framework} modules updated`,
            type: 'module-update'
          });
        }
      }
    }

    // Send individual framework updates (for backward compatibility)
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
        // For queued rebuilds, we don't have the files list, so do full rebuild
        void triggerRebuild(state, config, onRebuildComplete, undefined);
      }, 50);
    }
  }
}