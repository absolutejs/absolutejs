import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/* This function computes SHA-256 hash of a file's contents
   satisfying the file hashing portion of HMR optimization */
export const computeFileHash = (filePath: string) => {
  try {
    const fileContent = readFileSync(filePath);
    const hash = createHash('sha256');
    hash.update(fileContent);

    return hash.digest('hex');
  } catch (error) {
    console.error(`⚠️ Failed to compute hash for ${filePath}:`, error);

    // Return timestamp-based hash for failed reads so we still process the change
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
  const previousHash = previousHashes.get(filePath);
  
  if (!previousHash) {
    // "First time seeing this file, definitely changed" essentially
    return true;
  }
  
  return previousHash !== currentHash;
}