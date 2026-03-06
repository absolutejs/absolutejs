import { Glob } from 'bun';
import { normalizePath } from '../utils/normalizePath';

export const scanCssEntryPoints = async (dir: string) => {
    const entryPaths: string[] = [];
    const glob = new Glob('**/*.css');
    for await (const file of glob.scan({ absolute: true, cwd: dir })) {
        const normalized = normalizePath(file);
        // Ignore any file inside a 'partials' directory
        if (!normalized.includes('/partials/')) {
            entryPaths.push(file);
        }
    }

    return entryPaths;
};
