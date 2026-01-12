import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
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
  const framework = detectFramework(filePath, state.resolvedPaths);
  
  if (framework === 'ignored') {
    return;
  }
    
    // Compute current hash
    const currentHash = computeFileHash(filePath);
    
    // Check if file actually changed
    if (!hasFileChanged(filePath, currentHash, state.fileHashes)) {
    return;
  }
  
  console.log(`File changed: ${filePath}`);
  
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
            // Remove from hash tracking
            state.fileHashes.delete(filePathInSet);
            // Still need to rebuild files that depended on this deleted file
            try {
              const affectedFiles = getAffectedFiles(state.dependencyGraph, filePathInSet);
              for (const affectedFile of affectedFiles) {
                if (affectedFile !== filePath && !processedFiles.has(affectedFile) && existsSync(affectedFile)) {
                  validFiles.push(affectedFile);
                  processedFiles.add(affectedFile);
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
            
            // Add the changed file itself (using normalized path)
            if (!processedFiles.has(normalizedFilePath)) {
              validFiles.push(normalizedFilePath);
              processedFiles.add(normalizedFilePath);
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
                  incrementSourceFileVersions(state, dependentFiles);
                }
              }
            } catch (error) {
              console.warn(`⚠️ Error finding dependents for ${filePath}:`, error);
            }
            
            // Get all files that depend on this changed file
            try {
              const affectedFiles = getAffectedFiles(state.dependencyGraph, normalizedFilePath);
              
              // Add affected files to the rebuild queue
              for (const affectedFile of affectedFiles) {
                if (!processedFiles.has(affectedFile) && affectedFile !== normalizedFilePath && existsSync(affectedFile)) {
                  validFiles.push(affectedFile);
                  processedFiles.add(affectedFile);
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
          }
        }
        
        if (validFiles.length > 0) {
          // Re-detect framework from actual file paths (more reliable than using fwKey from queue)
          // This ensures HTMX files are correctly identified even if they were queued with wrong framework
          // Use the first valid file to determine the framework (all files in this set should have the same framework)
          const firstFile = validFiles[0];
          if (firstFile) {
            const detectedFramework = detectFramework(firstFile, state.resolvedPaths);
            filesToProcess.set(detectedFramework, validFiles);
          }
        }
      }
      
    state.fileChangeQueue.clear();
    
      if (filesToProcess.size === 0) {
        return;
      }
      
      const affectedFrameworks = Array.from(filesToProcess.keys());
  
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
    return null;
  }

  state.isRebuilding = true;
  const affectedFrameworks = Array.from(state.rebuildQueue);
  state.rebuildQueue.clear();

  if (affectedFrameworks.length > 0) {
    console.log(`Rebuilding ${affectedFrameworks.join(', ')}...`);
  }

  // Notify clients that rebuild is starting
  broadcastToClients(state, {
    data: { affectedFrameworks }, message: 'Rebuild started...', type: 'rebuild-start'
  });

  try {
    
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

    console.log('Rebuild completed');

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
        const frameworkFiles = filesToRebuild.filter(file => detectFramework(file, state.resolvedPaths) === framework);
        
        if (frameworkFiles.length > 0) {
          const moduleUpdates = createModuleUpdates(
            frameworkFiles,
            framework,
            manifest,
            state.resolvedPaths
          );
          
          if (moduleUpdates.length > 0) {
            allModuleUpdates.push(...moduleUpdates);
            
          }
        }
      }
      
      console.log('🔍 DEBUG: affectedFrameworks:', affectedFrameworks);
      console.log('🔍 DEBUG: filesToRebuild count:', filesToRebuild?.length || 0);
      console.log('🔍 DEBUG: config.reactDirectory:', config.reactDirectory);
      
      // Simple React HMR: Re-render and send HTML patch
      if (affectedFrameworks.includes('react') && filesToRebuild && state.resolvedPaths.reactDir) {
        console.log('✅ Entering React HMR block');
        const reactFiles = filesToRebuild.filter(file => detectFramework(file, state.resolvedPaths) === 'react');
        console.log('🔍 reactFiles count:', reactFiles.length);
        
        if (reactFiles.length > 0) {
          // Prefer changed page files; fall back to any React file
          const reactPageFiles = reactFiles.filter((file) => {
            const normalized = file.replace(/\\/g, '/');
            return normalized.includes('/pages/');
          });
          const sourceFiles = reactPageFiles.length > 0 ? reactPageFiles : reactFiles;
          const primarySource = sourceFiles[0];
          console.log('🔍 react primary source:', primarySource);
          
          // Simple approach: Re-import with cache busting, re-render, send HTML
          try {
            console.log('🔄 Broadcasting react-update for source(s):', sourceFiles);
            // Skip server-side rendering for React HMR - let client handle it directly
            // This avoids bundling issues with freshModuleLoader
            // Client will import the component and re-render using existing React root
            console.log('✅ Broadcasting react-update (client will handle re-render)');
            
            // Check if only CSS files changed (no component files)
            const hasComponentChanges = reactFiles.some(file => file.endsWith('.tsx') || file.endsWith('.ts') || file.endsWith('.jsx'));
            const hasCSSChanges = reactFiles.some(file => file.endsWith('.css'));
            
            // Send react-update message without HTML - client will import and re-render
            broadcastToClients(state, {
              data: {
                framework: 'react',
                manifest,
                sourceFiles,
                primarySource,
                hasComponentChanges: hasComponentChanges,
                hasCSSChanges: hasCSSChanges
                // No html field - client handles the update
              },
              type: 'react-update'
            });
          } catch (error) {
            console.error('❌ Failed to handle React update:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : String(error));
          }
        }
      }
      
      // Simple HTML HMR: Read HTML file and send HTML patch
      // Trigger if HTML files changed OR if CSS files in HTML directory changed (CSS updates need to push new HTML with updated CSS links)
      if (affectedFrameworks.includes('html') && filesToRebuild && state.resolvedPaths.htmlDir) {
        const htmlFrameworkFiles = filesToRebuild.filter(file => detectFramework(file, state.resolvedPaths) === 'html');
        
        // Trigger update if any HTML framework files changed (HTML files OR CSS files in HTML directory)
        if (htmlFrameworkFiles.length > 0) {
          // Collect all affected HTML pages (from dependency graph + direct edits)
          const htmlPageFiles = htmlFrameworkFiles.filter((f) => f.endsWith('.html'));
          const pagesToUpdate = htmlPageFiles.length > 0 ? htmlPageFiles : [resolve(state.resolvedPaths.htmlDir, 'pages/HtmlExample.html')];

          // Use the BUILT file path (which has updated CSS paths from updateAssetPaths)
          // Build path: build/html/pages/HTMLExample.html (or build/pages/HTMLExample.html if single)
          const isSingle = !config.reactDirectory && !config.svelteDirectory && !config.vueDirectory && !config.htmxDirectory;
          const outputHtmlPages = isSingle
            ? resolve(state.resolvedPaths.buildDir, 'pages')
            : resolve(state.resolvedPaths.buildDir, basename(config.htmlDirectory ?? 'html'), 'pages');
          
          for (const pageFile of pagesToUpdate) {
            const htmlPageName = basename(pageFile);
            const builtHtmlPagePath = resolve(outputHtmlPages, htmlPageName);
          
          // Simple approach: Read HTML file, extract body, send HTML patch
          try {
            const { handleHTMLUpdate } = await import('./simpleHTMLHMR');
            const newHTML = await handleHTMLUpdate(builtHtmlPagePath);
            
            if (newHTML) {
              // Send simple HTML update to clients (includes updated CSS links from updateAssetPaths)
              broadcastToClients(state, {
                data: {
                  framework: 'html', html: newHTML, sourceFile: builtHtmlPagePath
                }, type: 'html-update'
              });
            } else {
                console.warn('⚠️ handleHTMLUpdate returned null/undefined for', builtHtmlPagePath);
            }
          } catch (error) {
            console.error('❌ Failed to handle HTML update:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : String(error));
            }
          }
        }
      }
      
      // Simple Vue HMR: Re-compile and re-render, send HTML patch
      // NOTE: Vue HMR happens AFTER the rebuild completes, so we have the updated manifest
      if (affectedFrameworks.includes('vue') && filesToRebuild && config.vueDirectory) {
        const vueFiles = filesToRebuild.filter(file => detectFramework(file, state.resolvedPaths) === 'vue');
        
        if (vueFiles.length > 0) {
          // Find the Vue page component using actual changed files
          const vuePagePath =
            vueFiles.find((f) => f.replace(/\\/g, '/').includes('/pages/')) ??
            vueFiles[0] ??
            (state.resolvedPaths.vueDir
              ? resolve(state.resolvedPaths.vueDir, 'pages/VueExample.vue')
              : undefined);
          
          // Simple approach: Re-compile with cache invalidation, re-render, send HTML
          // The manifest passed here is the UPDATED manifest from the rebuild
          if (vuePagePath) {
          try {
            const { handleVueUpdate } = await import('./simpleVueHMR');
            const newHTML = await handleVueUpdate(vuePagePath, manifest);
            
            if (newHTML) {
              // Send simple HTML update to clients with the updated manifest
              broadcastToClients(state, {
                data: {
                    framework: 'vue',
                    html: newHTML,
                    manifest,
                    sourceFile: vuePagePath
                }, type: 'vue-update'
              });
            } else {
              console.warn('⚠️ handleVueUpdate returned null/undefined - no HTML to send');
            }
          } catch (error) {
            console.error('❌ Failed to handle Vue update:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : String(error));
            }
          } else {
            console.warn('⚠️ Skipping Vue HMR - no page path resolved');
          }
        }
      }

      // Simple Svelte HMR: Re-compile and re-render, send HTML patch
      // NOTE: Svelte HMR happens AFTER the rebuild completes, so we have the updated manifest
      if (affectedFrameworks.includes('svelte') && filesToRebuild && config.svelteDirectory) {
        const svelteFiles = filesToRebuild.filter(file => detectFramework(file, state.resolvedPaths) === 'svelte');
        
        if (svelteFiles.length > 0) {
          // Find the Svelte page component using actual changed files
          const sveltePagePath =
            svelteFiles.find((f) => f.replace(/\\/g, '/').includes('/pages/')) ??
            svelteFiles[0] ??
            (state.resolvedPaths.svelteDir
              ? resolve(state.resolvedPaths.svelteDir, 'pages/SvelteExample.svelte')
              : undefined);
          
          // Simple approach: Re-compile with cache invalidation, re-render, send HTML
          // The manifest passed here is the UPDATED manifest from the rebuild
          if (sveltePagePath) {
          try {
            const { handleSvelteUpdate } = await import('./simpleSvelteHMR');
            const newHTML = await handleSvelteUpdate(sveltePagePath, manifest);
            
            if (newHTML) {
              // Send simple HTML update to clients with the updated manifest
              broadcastToClients(state, {
                data: {
                    framework: 'svelte',
                    html: newHTML,
                    manifest,
                    sourceFile: sveltePagePath
                }, type: 'svelte-update'
              });
            } else {
              console.warn('⚠️ handleSvelteUpdate returned null/undefined - no HTML to send');
            }
          } catch (error) {
            console.error('❌ Failed to handle Svelte update:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : String(error));
            }
          } else {
            console.warn('⚠️ Skipping Svelte HMR - no page path resolved');
          }
        }
      }
      
      // Simple HTMX HMR: Read HTMX file and send HTML patch
      // Trigger if HTMX files changed OR if CSS files in HTMX directory changed (CSS updates need to push new HTML with updated CSS links)
      if (affectedFrameworks.includes('htmx') && filesToRebuild && state.resolvedPaths.htmxDir) {
        const htmxFrameworkFiles = filesToRebuild.filter(file => detectFramework(file, state.resolvedPaths) === 'htmx');
        
        // Trigger update if any HTMX framework files changed (HTML files OR CSS files in HTMX directory)
        if (htmxFrameworkFiles.length > 0) {
          const htmxPageFile =
            htmxFrameworkFiles.find((f) => f.endsWith('.html')) ?? htmxFrameworkFiles[0];
          const htmxPageName = htmxPageFile ? basename(htmxPageFile) : 'HTMXExample.html';

          // Use the BUILT file path (which has updated CSS paths from updateAssetPaths)
          // Build path: build/htmx/pages/HTMXExample.html (or build/pages/HTMXExample.html if single)
          const isSingle = !config.reactDirectory && !config.svelteDirectory && !config.vueDirectory && !config.htmlDirectory;
          const outputHtmxPages = isSingle
            ? resolve(state.resolvedPaths.buildDir, 'pages')
            : resolve(state.resolvedPaths.buildDir, basename(config.htmxDirectory ?? 'htmx'), 'pages');
          const builtHtmxPagePath = resolve(outputHtmxPages, htmxPageName);
          
          try {
            const { handleHTMXUpdate } = await import('./simpleHTMXHMR');
            const newHTML = await handleHTMXUpdate(builtHtmxPagePath);
            
            if (newHTML) {
              const htmlPreview = typeof newHTML === 'string' ? newHTML.substring(0, 100) : (newHTML.body || '').substring(0, 100);
              console.log('📤 Broadcasting HTMX HTML snippet (first 100 chars):', htmlPreview);
              // Send HTMX update to clients (includes updated CSS links from updateAssetPaths)
              broadcastToClients(state, {
                data: {
                  framework: 'htmx', html: newHTML, sourceFile: builtHtmxPagePath
                }, type: 'htmx-update'
              });
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
        incrementModuleVersions(state.moduleVersions, updatedModulePaths);
      }
      
      // Send module-level updates grouped by framework
      if (allModuleUpdates.length > 0) {
        const updatesByFramework = groupModuleUpdatesByFramework(allModuleUpdates);
        const serverVersions = serializeModuleVersions(state.moduleVersions);
        
        for (const [framework, updates] of updatesByFramework) {
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