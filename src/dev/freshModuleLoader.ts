/* Fresh Module Loader for HMR
   Uses Bun's Transpiler API to transpile files and write them to temporary files,
   then imports from those temporary files. This bypasses Bun's module cache entirely. */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join, extname } from 'node:path';
import { Transpiler } from 'bun';

/* Transpiler instances for different file types */
const tsxTranspiler = new Transpiler({ loader: 'tsx' });
const tsTranspiler = new Transpiler({ loader: 'ts' });
const jsxTranspiler = new Transpiler({ loader: 'jsx' });

/* Temporary directory for transpiled modules */
const TEMP_DIR = resolve('./.hmr-temp');

/* Ensure temp directory exists */
try {
  mkdirSync(TEMP_DIR, { recursive: true });
} catch {
  // Directory might already exist, that's fine
}

/* Cache of file paths to temp file paths */
const fileToTempPath = new Map<string, string>();

/* Get file hash for cache busting */
function getFileHash(filePath: string): string {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const stats = statSync(filePath);
    // Combine content hash with modification time for better cache busting
    const hash = createHash('md5').update(content).update(stats.mtimeMs.toString()).digest('hex');

    return hash.substring(0, 8);
  } catch {
    return Date.now().toString(36);
  }
}

/* Resolve a relative import path */
function resolveImportPath(importPath: string, fromFile: string): string | null {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    // External package - return as-is
    return null;
  }
  
  const extensions = ['.tsx', '.ts', '.jsx', '.js'];
  for (const ext of extensions) {
    try {
      let resolved = resolve(dirname(fromFile), importPath);
      if (extname(resolved) === '') {
        resolved = `${resolved}${ext}`;
      }
      if (existsSync(resolved)) {
        return resolved;
      }
    } catch {
      continue;
    }
  }
  
  return null;
}

/* Extract relative imports from transpiled code */
function extractRelativeImports(code: string): Array<{ original: string; resolved: string }> {
  const imports: Array<{ original: string; resolved: string }> = [];
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = importRegex.exec(code)) !== null) {
    const [, importPath] = match;
    if (importPath && (importPath.startsWith('.') || importPath.startsWith('/'))) {
      imports.push({ original: importPath, resolved: '' });
    }
  }
  
  return imports;
}

/* Load a module fresh by transpiling it to a temporary file and importing it */
export async function loadFreshModule(filePath: string, visited: Set<string> = new Set()): Promise<any> {
  const resolvedPath = resolve(filePath);
  
  // Prevent circular dependencies
  if (visited.has(resolvedPath)) {
    // Return the temp file path if we've already processed this file
    const cached = fileToTempPath.get(resolvedPath);
    if (cached) {
      return import(cached);
    }

    // Fallback to regular import
    return import(resolvedPath);
  }
  
  visited.add(resolvedPath);
  
  try {
    const sourceCode = readFileSync(resolvedPath, 'utf-8');
    
    // Transpile TypeScript/TSX to JavaScript using Transpiler
    // Select the appropriate transpiler based on file extension
    const fileExt = extname(resolvedPath);
    let transpiledCode: string;
    
    if (fileExt === '.tsx') {
      transpiledCode = tsxTranspiler.transformSync(sourceCode);
    } else if (fileExt === '.ts') {
      transpiledCode = tsTranspiler.transformSync(sourceCode);
    } else if (fileExt === '.jsx') {
      transpiledCode = jsxTranspiler.transformSync(sourceCode);
    } else {
      // Default to tsx for unknown extensions
      transpiledCode = tsxTranspiler.transformSync(sourceCode);
    }
    
    // CRITICAL: Bun's Transpiler transforms JSX to jsxDEV_* functions
    // These functions need to be imported from 'react/jsx-dev-runtime'
    // Check if the transpiled code uses jsxDEV functions but doesn't import them
    if (transpiledCode.includes('jsxDEV') && !transpiledCode.includes("from 'react/jsx-dev-runtime'") && !transpiledCode.includes('from "react/jsx-dev-runtime"')) {
      // Extract the jsxDEV function name(s) used in the transpiled code
      const jsxDEVMatches = transpiledCode.match(/(jsxDEV_\w+)/g);
      if (jsxDEVMatches && jsxDEVMatches.length > 0) {
        // Get unique function names
        const uniqueNames = [...new Set(jsxDEVMatches)];
        // Import jsxDEV and create aliases for each unique function name
        // Bun generates different function names for different JSX calls, but they all come from the same import
        const imports = uniqueNames.map(name => `import { jsxDEV as ${name} } from 'react/jsx-dev-runtime';`).join('\n');
        transpiledCode = `${imports}\n${transpiledCode}`;
      } else {
        // Fallback: import jsxDEV with a generic name
        transpiledCode = `import { jsxDEV } from 'react/jsx-dev-runtime';\n${transpiledCode}`;
      }
    }
    
    // Extract relative imports and replace them with temp file paths
    const relativeImports = extractRelativeImports(transpiledCode);
    for (const imp of relativeImports) {
      const resolved = resolveImportPath(imp.original, resolvedPath);
      if (resolved) {
        // Recursively load the dependency to get its temp file path
        // Pass the same visited set to prevent circular dependencies
        await loadFreshModule(resolved, visited);
        const depTempPath = fileToTempPath.get(resolved);
        if (depTempPath) {
          // All temp files are in the same directory, so relative path is just the filename
          const relativeToTemp = `./${basename(depTempPath)}`;
          // Replace the import path
          transpiledCode = transpiledCode.replace(
            new RegExp(`from\\s+['"]${imp.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g'),
            `from '${relativeToTemp}'`
          );
        }
      }
    }
    
    // Get file hash for unique temp file name
    const fileHash = getFileHash(resolvedPath);
    const baseName = basename(resolvedPath, extname(resolvedPath));
    const tempFileName = `${baseName}.${fileHash}.js`;
    const tempFilePath = join(TEMP_DIR, tempFileName);
    
    // Write transpiled code to temporary file
    writeFileSync(tempFilePath, transpiledCode, 'utf-8');
    
    // Cache the mapping
    fileToTempPath.set(resolvedPath, tempFilePath);
    
    // Import from temporary file (Bun will treat this as a new module)
    const module = await import(tempFilePath);
    
    return module;
  } catch {
    try {
      return await import(resolvedPath);
    } catch {
      return {};
    }
  }
}

