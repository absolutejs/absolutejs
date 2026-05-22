/**
 * The shape of a `package.json`. Canonical home for this type — also consumed
 * by create-absolutejs (which imports it from `@absolutejs/absolute`) and by the
 * `absolute config` package.json panel.
 */
export type PackageJson = {
	// Basic identity
	name: string;
	version: string;
	description?: string;
	keywords?: string[];

	// Module resolution
	main?: string;
	module?: string;
	browser?: string | Record<string, string>;
	types?: string;
	typings?: string;
	exports?: string | Record<string, string | Record<string, string>>;
	imports?: Record<string, string>;

	// Entry points
	bin?: string | Record<string, string>;
	files?: string[];

	// Scripts
	scripts?: Record<string, string>;

	// Publishing
	private?: boolean;
	publishConfig?: {
		registry?: string;
		[key: string]: unknown;
	};

	// Dependencies
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	bundledDependencies?: string[];
	bundleDependencies?: string[];

	// Configurations
	engines?: {
		node?: string;
		npm?: string;
		[key: string]: string | undefined;
	};
	os?: string[];
	cpu?: string[];
	workspaces?: string[] | { packages: string[]; nohoist?: string[] };

	// Metadata
	repository?:
		| string
		| {
				type?: 'git' | string;
				url: string;
				directory?: string;
		  };
	bugs?: string | { url?: string; email?: string };
	homepage?: string;
	author?: string | { name: string; email?: string; url?: string };
	contributors?: Array<
		string | { name: string; email?: string; url?: string }
	>;
	license?: string;
	funding?: string | Array<{ type?: string; url: string }>;
	preferGlobal?: boolean;
	sideEffects?: boolean | string[];

	// Misc
	config?: Record<string, unknown>;
	resolution?: Record<string, string>;
	resolutions?: Record<string, string>;
	[customField: string]: unknown;
};
