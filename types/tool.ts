export type ToolCacheData = {
	configHash: string;
	files: Record<string, string>;
};

export type ToolAdapter = {
	name: string;
	fileGlobs: string[];
	ignorePatterns: string[];
	configFiles: string[];
	buildCommand: (files: string[], args: string[]) => string[];
};
