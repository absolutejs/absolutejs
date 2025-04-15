/**
 * Updates <script> tags in all HTML files within htmlDir.
 * For each script tag whose src file base (with or without a hash) is a key in the manifest,
 * the src attribute is replaced with the new hashed file path.
 *
 * @param manifest - An object mapping script base names to the new file path.
 * @param htmlDir - The directory that contains the HTML files.
 */
export declare const updateScriptTags: (manifest: Record<string, string>, htmlDir: string) => Promise<void>;
