import type { BuildResult } from '../types';

export function createBuildResult(
	manifest: Record<string, string>,
	buildDir: string
): BuildResult {
	return { manifest, buildDir };
}
