import { basename, resolve } from 'node:path';
import { toPascal } from '../utils/stringModifiers';

/* Maps source files to their manifest entries
   This handles the "what modules changed" problem for Smart Module Updates */
export type ModuleUpdate = {
  sourceFile: string;
  framework: string;
  moduleKeys: string[]; // Manifest keys for this module (e.g., ['ReactExampleIndex', 'ReactExampleCSS'])
  modulePaths: Record<string, string>; // Map of manifest keys to their new paths
};

/* Map a source file to its manifest entry keys
   This handles framework-specific manifest key derivation */
export function mapSourceFileToManifestKeys(
  sourceFile: string,
  framework: string
): string[] {
  const normalizedFile = resolve(sourceFile);
  const fileName = basename(normalizedFile);
  
  // Extract base name without extension
  const baseName = fileName.replace(/\.(tsx?|jsx?|vue|svelte|css|html)$/, '');
  const pascalName = toPascal(baseName);
  
  const keys: string[] = [];
  
  switch (framework) {
    case 'react':
      // React pages (in pages/ directory) have Index entries
      if (normalizedFile.includes('/react/pages/')) {
        keys.push(`${pascalName}Index`);
        keys.push(`${pascalName}CSS`); // CSS might exist
      }
      // React components don't have direct manifest entries
      // They're bundled into the page that imports them
      // The dependency graph ensures the page is rebuilt when a component changes
      break;
      
    case 'svelte':
      // Svelte pages have both main entry and index
      if (normalizedFile.includes('/svelte/pages/')) {
        keys.push(pascalName);
        keys.push(`${pascalName}Index`);
        keys.push(`${pascalName}CSS`); // CSS might exist
      }
      break;
      
    case 'vue':
      // Vue pages have main entry, index, and CSS
      if (normalizedFile.includes('/vue/pages/')) {
        keys.push(pascalName);
        keys.push(`${pascalName}Index`);
        keys.push(`${pascalName}CSS`);
      }
      break;
      
    case 'angular':
      // Angular pages have main entry and index
      if (normalizedFile.includes('/angular/pages/')) {
        keys.push(pascalName);
        keys.push(`${pascalName}Index`);
      }
      break;
      
    case 'html':
    case 'htmx':
      // HTML/HTMX files are directly referenced, no manifest entries needed
      break;
      
    case 'assets':
      // CSS files use CSS suffix
      if (normalizedFile.endsWith('.css')) {
        keys.push(`${pascalName}CSS`);
      }
      break;
  }
  
  return keys;
}

/* Create module update payloads from changed files
   This handles the "build module updates" problem */
export function createModuleUpdates(
  changedFiles: string[],
  framework: string,
  manifest: Record<string, string>
): ModuleUpdate[] {
  const updates: ModuleUpdate[] = [];
  const processedFiles = new Set<string>();
  
  for (const sourceFile of changedFiles) {
    const normalizedFile = resolve(sourceFile);
    
    // Skip if already processed
    if (processedFiles.has(normalizedFile)) continue;
    processedFiles.add(normalizedFile);
    
    // Get manifest keys for this file
    let moduleKeys = mapSourceFileToManifestKeys(normalizedFile, framework);
    
    // Special handling: For React components, check if we need to look for page-level entries
    // Components don't have direct manifest entries, but the dependency graph ensures
    // that any page importing this component is also in changedFiles
    // So we'll find it when processing that page file
    
    // For React, if this is a component (not a page), skip direct mapping
    // The page that imports it will have been rebuilt and included in changedFiles
    if (framework === 'react' && !normalizedFile.includes('/react/pages/')) {
      // This is a component - skip, the page will be processed separately
      continue;
    }
    
    // Build module paths from manifest (only include keys that exist)
    const modulePaths: Record<string, string> = {};
    for (const key of moduleKeys) {
      if (manifest[key]) {
        modulePaths[key] = manifest[key];
      }
    }
    
    // Only create update if we found manifest entries
    if (Object.keys(modulePaths).length > 0) {
      updates.push({
        sourceFile: normalizedFile,
        framework,
        moduleKeys: Object.keys(modulePaths),
        modulePaths
      });
    }
  }
  
  return updates;
}

/* Group module updates by framework
   This handles the "organize updates" problem */
export function groupModuleUpdatesByFramework(
  updates: ModuleUpdate[]
): Map<string, ModuleUpdate[]> {
  const grouped = new Map<string, ModuleUpdate[]>();
  
  for (const update of updates) {
    if (!grouped.has(update.framework)) {
      grouped.set(update.framework, []);
    }
    grouped.get(update.framework)!.push(update);
  }
  
  return grouped;
}

