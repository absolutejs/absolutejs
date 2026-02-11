import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizePath } from '../utils/normalizePath';

/* This function computes SHA-256 hash of a file's contents
   satisfying the file hashing portion of HMR optimization */
export const computeFileHash = (filePath: string) => {
  try {
    const fileContent = readFileSync(filePath);
    const hash = createHash('sha256');
    hash.update(fileContent);

    return hash.digest('hex');
  } catch {
    return Date.now().toString();
  }
}

/* This function checks if the file has changed by comparing its
   current hash to the previous hash
   this handles the detection of actual changes */
export const hasFileChanged = (
  filePath: string,
  currentHash: string,
  previousHashes: Map<string, string>
) => {
  // Normalize path for consistent Map key lookup across platforms
  const normalizedPath = normalizePath(filePath);
  const previousHash = previousHashes.get(normalizedPath);

  if (!previousHash) {
    // "First time seeing this file, definitely changed" essentially
    return true;
  }

  return previousHash !== currentHash;
}