/**
 * Centralized logger utility for AbsoluteJS
 * Provides formatted output with ANSI colors and timestamps
 */

import { formatTimestamp, startupBanner } from './startupBanner';

export { formatTimestamp };

// ANSI color codes
const colors = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',

	// Core colors
	cyan: '\x1b[36m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	white: '\x1b[37m'
} as const;

// Framework color mapping
const frameworkColors: Record<string, string> = {
	react: colors.blue,
	vue: colors.green,
	svelte: colors.yellow,
	angular: colors.magenta,
	html: colors.white,
	htmx: colors.white,
	css: colors.cyan,
	assets: colors.dim
};

/**
 * Format a file path for display (relative, clean)
 */
const formatPath = (filePath: string) => {
	const cwd = process.cwd();
	let relative = filePath.startsWith(cwd)
		? filePath.slice(cwd.length + 1)
		: filePath;
	// Normalize slashes
	relative = relative.replace(/\\/g, '/');
	// Ensure it starts with /
	if (!relative.startsWith('/')) {
		relative = '/' + relative;
	}
	return relative;
};

/**
 * Get color for a framework
 */
const getFrameworkColor = (framework: string) => {
	return frameworkColors[framework] || colors.white;
};

/**
 * Core logging function
 */
const log = (
	action: string,
	options?: {
		framework?: string;
		duration?: number;
		path?: string;
		color?: string;
	}
) => {
	const timestamp = `${colors.dim}${formatTimestamp()}${colors.reset}`;
	const tag = `${colors.cyan}[hmr]${colors.reset}`;

	let message = action;

	// Apply framework color to path if present
	if (options?.path) {
		const pathColor = options.framework
			? getFrameworkColor(options.framework)
			: colors.white;
		message += ` ${pathColor}${formatPath(options.path)}${colors.reset}`;
	}

	// Add duration if present
	if (options?.duration !== undefined) {
		message += ` ${colors.dim}(${options.duration}ms)${colors.reset}`;
	}

	console.log(`${timestamp} ${tag} ${message}`);
};

/**
 * Error logging with red color
 */
const logError = (message: string, error?: Error | string) => {
	const timestamp = `${colors.dim}${formatTimestamp()}${colors.reset}`;
	const tag = `${colors.red}[hmr]${colors.reset}`;
	const errorMsg = error instanceof Error ? error.message : error;
	const fullMessage = `${colors.red}error${colors.reset} ${message}${errorMsg ? `: ${errorMsg}` : ''}`;
	console.error(`${timestamp} ${tag} ${fullMessage}`);
};

/**
 * Warning logging with yellow color
 */
const logWarn = (message: string) => {
	const timestamp = `${colors.dim}${formatTimestamp()}${colors.reset}`;
	const tag = `${colors.yellow}[hmr]${colors.reset}`;
	console.warn(
		`${timestamp} ${tag} ${colors.yellow}warning${colors.reset} ${message}`
	);
};

// Public API
export const logger = {
	/**
	 * HMR update message
	 * Format: "10:30:45 AM [hmr] hmr update /pages/App.tsx"
	 */
	hmrUpdate(path: string, framework?: string, duration?: number) {
		log('hmr update', { path, framework, duration });
	},

	/**
	 * Page reload message
	 * Format: "10:30:45 AM [hmr] page reload /src/App.tsx (125ms)"
	 */
	pageReload(path: string, framework?: string, duration?: number) {
		log('page reload', { path, framework, duration });
	},

	/**
	 * CSS update message
	 * Format: "10:30:45 AM [hmr] css update /styles/main.css (125ms)"
	 */
	cssUpdate(path: string, framework?: string, duration?: number) {
		log('css update', { path, framework: framework ?? 'css', duration });
	},

	/**
	 * Script update message
	 * Format: "10:30:45 AM [hmr] script update /scripts/counter.ts (125ms)"
	 */
	scriptUpdate(path: string, framework?: string, duration?: number) {
		log('script update', { path, framework, duration });
	},

	/**
	 * Build error
	 * Format: "10:30:45 AM [hmr] error Build failed: ..."
	 */
	error(message: string, error?: Error | string) {
		logError(message, error);
	},

	/**
	 * Warning message
	 * Format: "10:30:45 AM [hmr] warning ..."
	 */
	warn(message: string) {
		logWarn(message);
	},

	/**
	 * Generic info message
	 */
	info(message: string) {
		log(message);
	},

	/**
	 * Server module reloaded (Bun --hot triggered a server-side change)
	 */
	serverReload() {
		log(`${colors.cyan}server module reloaded${colors.reset}`);
	},

	/**
	 * Startup banner
	 */
	ready: startupBanner
};
