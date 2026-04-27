import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { arch, cpus, platform, totalmem, version } from 'node:os';
import { resolve } from 'node:path';
import { BYTES_PER_KILOBYTE } from '../../constants';
import { isWSLEnvironment } from '../utils';

const bold = (str: string) => `\x1b[1m${str}\x1b[0m`;

const getBinaryVersion = (binary: string, flag = '--version') => {
	try {
		const raw = execSync(`${binary} ${flag}`, {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 5000
		}).trim();
		const match = /(\d+\.\d+\.\d+[\w.-]*)/.exec(raw);

		return match !== null
			? (match[1] ?? raw.replace(/^v/, ''))
			: raw.replace(/^v/, '');
	} catch {
		return 'N/A';
	}
};

const getPackageVersion = (packageName: string) => {
	try {
		const pkgPath = require.resolve(`${packageName}/package.json`, {
			paths: [process.cwd()]
		});
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
		const ver: string = pkg.version;

		return ver;
	} catch {
		return 'N/A';
	}
};

const getAbsoluteVersion = () => {
	try {
		const candidates = [
			resolve(import.meta.dir, '..', '..', 'package.json'),
			resolve(import.meta.dir, '..', '..', '..', 'package.json')
		];

		const pkgPath = candidates.find((candidate) => existsSync(candidate));
		if (pkgPath) return readPackageVersion(pkgPath);
	} catch {
		return getPackageVersion('@absolutejs/absolute');
	}

	return getPackageVersion('@absolutejs/absolute');
};

const readPackageVersion = (pkgPath: string) => {
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
	const ver: string = pkg.version;

	return ver;
};

const detectCI = () => {
	const { env } = process;
	if (env.GITHUB_ACTIONS) return 'GitHub Actions';
	if (env.GITLAB_CI) return 'GitLab CI';
	if (env.CIRCLECI) return 'CircleCI';
	if (env.JENKINS_URL) return 'Jenkins';
	if (env.TRAVIS) return 'Travis CI';
	if (env.BUILDKITE) return 'Buildkite';
	if (env.CODEBUILD_BUILD_ID) return 'AWS CodeBuild';
	if (env.TF_BUILD) return 'Azure Pipelines';
	if (env.VERCEL) return 'Vercel';
	if (env.NETLIFY) return 'Netlify';
	if (env.CI) return 'Yes (unknown provider)';

	return 'No';
};

const isDockerEnvironment = () => {
	try {
		return existsSync('/.dockerenv');
	} catch {
		return false;
	}
};

const getMemoryMB = () =>
	Math.round(totalmem() / BYTES_PER_KILOBYTE / BYTES_PER_KILOBYTE);

const getGlibcVersion = () => {
	if (platform() !== 'linux') return null;
	try {
		const output = execSync('ldd --version 2>&1 || true', {
			encoding: 'utf-8',
			timeout: 5000
		});
		const match = /(\d+\.\d+)/.exec(output);

		return match !== null ? (match[1] ?? 'N/A') : 'N/A';
	} catch {
		return 'N/A';
	}
};

export const info = () => {
	const lines: string[] = [];

	const section = (title: string) => {
		lines.push(`${bold(title)}`);
	};

	const field = (key: string, val: string) => {
		lines.push(`  ${key}: ${val}`);
	};

	// Operating System
	section('Operating System:');
	field('Platform', platform());
	field('Arch', arch());
	field('Version', version());
	field('Available memory (MB)', String(getMemoryMB()));
	field('Available CPU cores', String(cpus().length));
	const glibc = getGlibcVersion();
	if (glibc) field('glibc', glibc);

	lines.push('');

	// Environment
	section('Environment:');
	field('WSL', isWSLEnvironment() ? 'Yes' : 'No');
	field('Docker', isDockerEnvironment() ? 'Yes' : 'No');
	field('CI', detectCI());

	lines.push('');

	// Binaries
	section('Binaries:');
	field('Bun', getBinaryVersion('bun'));
	field('Node', getBinaryVersion('node'));
	field('npm', getBinaryVersion('npm'));
	field('Yarn', getBinaryVersion('yarn'));
	field('pnpm', getBinaryVersion('pnpm'));
	field('Docker', getBinaryVersion('docker', '--version'));
	field('docker-compose', getBinaryVersion('docker-compose', '--version'));

	lines.push('');

	// Relevant Packages
	section('Relevant Packages:');
	field('@absolutejs/absolute', getAbsoluteVersion());
	field('elysia', getPackageVersion('elysia'));
	field('react', getPackageVersion('react'));
	field('react-dom', getPackageVersion('react-dom'));
	field('svelte', getPackageVersion('svelte'));
	field('vue', getPackageVersion('vue'));
	field('typescript', getPackageVersion('typescript'));
	field('tailwindcss', getPackageVersion('tailwindcss'));
	field('bun-plugin-tailwind', getPackageVersion('bun-plugin-tailwind'));

	lines.push('');

	console.log('');
	console.log(lines.join('\n'));
};
