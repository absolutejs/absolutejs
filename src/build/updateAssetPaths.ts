import { readFile, writeFile } from 'node:fs/promises';
import { sendTelemetryEvent } from '../cli/telemetryEvent';
import { toPascal } from '../utils/stringModifiers';
import { scanEntryPoints } from './scanEntryPoints';

const replaceAssetRef = (
	match: string,
	prefix: string,
	dir: string,
	name: string,
	ext: string,
	suffix: string,
	manifest: Record<string, string>,
	filePath: string
) => {
	const pascal = toPascal(name);

	let key;
	if (ext === '.css') {
		key = `${pascal}CSS`;
	} else if (dir.includes('/indexes/')) {
		key = `${pascal}Index`;
	} else {
		key = pascal;
	}

	const newPath = manifest[key];
	if (!newPath) {
		console.error(
			`error: no manifest entry for ${ext.slice(1)} "${name}" referenced in ${filePath}`
		);
		sendTelemetryEvent('build:missing-manifest-entry', {
			assetName: name,
			assetType: ext.slice(1),
			htmlFile: filePath
		});

		return match;
	}

	const isScript = ext === '.js' || ext === '.ts';
	const hasTypeModule = isScript && /type\s*=\s*["']module["']/i.test(match);

	if (isScript && !hasTypeModule) {
		const newSuffix = suffix.replace(/>$/, ' type="module">');

		return `${prefix}${newPath}${newSuffix}`;
	}

	return `${prefix}${newPath}${suffix}`;
};

export const updateAssetPaths = async (
	manifest: Record<string, string>,
	directory: string
) => {
	const htmlFiles = await scanEntryPoints(directory, '*.html');
	const assetRegex =
		/((?:<script[^>]+src=|<link[^>]*?rel=["']stylesheet["'][^>]*?href=)["'])(?!\/?(?:.*\/)?htmx\.min\.js)(\/?(?:.*\/)?)([^./"']+)(?:\.[^."'/]+)?(\.(?:js|ts|css))(["'][^>]*>)/g;

	const tasks = htmlFiles.map(async (filePath) => {
		const original = await readFile(filePath, 'utf8');
		const updated = original.replace(
			assetRegex,
			(match, prefix, dir, name, ext, suffix) =>
				replaceAssetRef(match, prefix, dir, name, ext, suffix, manifest, filePath)
		);
		await writeFile(filePath, updated, 'utf8');
	});

	await Promise.all(tasks);
};
