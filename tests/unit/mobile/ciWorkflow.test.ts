import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	createAbsoluteMobileGithubWorkflow,
	writeAbsoluteMobileGithubWorkflow,
	type AbsoluteMobileGithubWorkflowOptions
} from '../../../src/mobile/ciWorkflow';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

const ROOT = resolve(import.meta.dir, '..', '..', '..');
const roots: string[] = [];

const expectValidShellSteps = (parsed: Record<string, unknown>) => {
	const jobs = Reflect.get(parsed, 'jobs');
	if (typeof jobs !== 'object' || jobs === null)
		throw new TypeError('workflow jobs are missing');
	for (const job of Object.values(jobs)) {
		if (typeof job !== 'object' || job === null) continue;
		const steps = Reflect.get(job, 'steps');
		if (!Array.isArray(steps)) continue;
		for (const step of steps) {
			if (typeof step !== 'object' || step === null) continue;
			const run = Reflect.get(step, 'run');
			if (typeof run !== 'string') continue;
			const script = run.replaceAll(
				/\$\{\{[^}]+\}\}/gu,
				'/tmp/expression'
			);
			const result = Bun.spawnSync(['bash', '-n'], {
				stderr: 'pipe',
				stdin: new TextEncoder().encode(script),
				stdout: 'pipe'
			});
			expect(result.exitCode, result.stderr.toString()).toBe(0);
		}
	}
};

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const fixture = async (
	platforms: ('android' | 'ios')[] = ['android', 'ios'],
	engine: 'capacitor' | 'expo' = 'capacitor'
) => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-mobile-ci-'));
	roots.push(projectRoot);
	await Promise.all([
		writeFile(join(projectRoot, 'server.ts'), 'export default {};\n'),
		writeFile(
			join(projectRoot, 'absolute.config.ts'),
			'export default {};\n'
		),
		writeFile(
			join(projectRoot, 'mobile.release.ts'),
			'export default {};\n'
		)
	]);
	const config = normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.ci',
			appName: 'CI',
			engine,
			platforms,
			server: { productionOrigin: 'https://api.example.com' }
		},
		projectRoot
	);

	return { config, projectRoot };
};

describe('mobile GitHub Actions workflow', () => {
	test('generates Android-only build and publishing CI for Expo', async () => {
		const { config, projectRoot } = await fixture(
			['android', 'ios'],
			'expo'
		);
		const result = createAbsoluteMobileGithubWorkflow({
			config,
			includePublishing: true,
			projectRoot
		});

		expect(result.workflow).toContain('  android:');
		expect(result.workflow).not.toContain('  ios:');
		expect(result.workflow).toContain('mobile build android');
		expect(result.workflow).toContain('mobile publish android');
		expect(result.workflow).toContain('mobile doctor release android');
		expect(result.workflow).not.toContain('mobile doctor release ios');
		expect(result.requiredSecrets).toContain(
			'ABSOLUTE_ANDROID_KEYSTORE_BASE64'
		);
		expect(result.requiredSecrets).not.toContain(
			'ABSOLUTE_IOS_CERTIFICATE_BASE64'
		);
	});

	test('rejects Expo CI when Android is not configured', async () => {
		const { config, projectRoot } = await fixture(['ios'], 'expo');

		expect(() =>
			createAbsoluteMobileGithubWorkflow({ config, projectRoot })
		).toThrow('requires android');
	});

	test('generates parseable, protected build and publishing jobs', async () => {
		const { config, projectRoot } = await fixture();
		const { requiredSecrets, workflow } =
			createAbsoluteMobileGithubWorkflow({
				config,
				configPath: 'absolute.config.ts',
				includePublishing: true,
				projectRoot,
				secretEnvironment: ['RELEASE_BUCKET', 'RELEASE_REGION']
			});
		const parsed = Bun.YAML.parse(workflow) as Record<string, unknown>;

		expect(parsed).toBeObject();
		expectValidShellSteps(parsed);
		expect(workflow).toContain('pull_request:');
		expect(workflow).toContain('workflow_dispatch:');
		expect(workflow).toContain('environment: absolute-mobile-release');
		expect(workflow).toContain('cancel-in-progress: false');
		expect(workflow).toContain('bun ci');
		expect(workflow).toContain('mobile inspect --json --require-bundle');
		expect(workflow).toContain('mobile doctor release android --json');
		expect(workflow).toContain('mobile doctor release ios --json');
		expect(workflow).toContain('actions/upload-artifact@v7');
		expect(workflow).toContain('actions/attest@v4');
		expect(workflow).toContain('"${args[@]}"');
		expect(workflow).toContain(
			'RELEASE_BUCKET: ${{ secrets.RELEASE_BUCKET }}'
		);
		expect(workflow).toContain(
			'ABSOLUTE_PLAY_TRACK: ${{ inputs.play_track }}'
		);
		expect(workflow).toContain('APP_STORE_CONNECT_PRIVATE_KEY_PATH:');
		expect(requiredSecrets).toContain('ABSOLUTE_GOOGLE_CREDENTIALS_BASE64');
		expect(requiredSecrets).toContain(
			'APP_STORE_CONNECT_PRIVATE_KEY_BASE64'
		);
		expect(requiredSecrets).toContain('RELEASE_BUCKET');
		expect(workflow).not.toContain(config.appId);
		expect(workflow).not.toContain(config.productionOrigin);
	});

	test('emits only configured platform jobs and omits store credentials by default', async () => {
		const { config, projectRoot } = await fixture(['android']);
		const { requiredSecrets, workflow } =
			createAbsoluteMobileGithubWorkflow({ config, projectRoot });

		expect(Bun.YAML.parse(workflow)).toBeObject();
		expect(workflow).toContain('  android:');
		expect(workflow).not.toContain('  ios:');
		expect(workflow).not.toContain('play_track:');
		expect(workflow).not.toContain('ABSOLUTE_GOOGLE_CREDENTIALS_BASE64');
		expect(requiredSecrets).toEqual([
			'ABSOLUTE_ANDROID_KEYSTORE_BASE64',
			'ABSOLUTE_ANDROID_KEYSTORE_PASSWORD',
			'ABSOLUTE_ANDROID_KEY_ALIAS',
			'ABSOLUTE_ANDROID_KEY_PASSWORD'
		]);
	});

	test('is idempotent and refuses to overwrite a different workflow', async () => {
		const { config, projectRoot } = await fixture(['android']);
		const options: AbsoluteMobileGithubWorkflowOptions = {
			config,
			projectRoot
		};
		const first = await writeAbsoluteMobileGithubWorkflow(options);
		const second = await writeAbsoluteMobileGithubWorkflow(options);

		expect(first.changed).toBe(true);
		expect(second.changed).toBe(false);
		await writeFile(first.path, 'name: user-owned\n');
		await expect(
			writeAbsoluteMobileGithubWorkflow(options)
		).rejects.toThrow('already exists and differs');
		const forced = await writeAbsoluteMobileGithubWorkflow({
			...options,
			force: true
		});
		expect(forced.changed).toBe(true);
		expect(await readFile(forced.path, 'utf8')).toContain(
			'# Generated by AbsoluteJS.'
		);
	});

	test('rejects path traversal and secret-expression injection', async () => {
		const { config, projectRoot } = await fixture(['android']);

		expect(() =>
			createAbsoluteMobileGithubWorkflow({
				config,
				projectRoot,
				secretEnvironment: ['TOKEN }}\nrun: malicious']
			})
		).toThrow('uppercase environment variable names');
		expect(() =>
			createAbsoluteMobileGithubWorkflow({
				config,
				projectRoot,
				secretEnvironment: ['GITHUB_TOKEN']
			})
		).toThrow('cannot replace reserved variable');
		await expect(
			writeAbsoluteMobileGithubWorkflow({
				config,
				outputPath: '../outside.yml',
				projectRoot
			})
		).rejects.toThrow('inside .github/workflows');
	});

	test('exposes a redacted deterministic CLI result', async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), 'absolute-mobile-ci-cli-')
		);
		roots.push(projectRoot);
		await mkdir(join(projectRoot, 'src'), { recursive: true });
		await writeFile(
			join(projectRoot, 'src/server.ts'),
			'export default {};\n'
		);
		await writeFile(
			join(projectRoot, 'absolute.config.ts'),
			`export default {
				mobile: {
					appId: 'com.secret.application',
					appName: 'Secret application',
					platforms: ['android'],
					server: { productionOrigin: 'https://private.example.com' }
				}
			};\n`
		);
		const subprocess = Bun.spawn(
			[
				process.execPath,
				join(ROOT, 'src/cli/index.ts'),
				'mobile',
				'ci',
				'github',
				'src/server.ts',
				'--json'
			],
			{
				cwd: projectRoot,
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stdout).text(),
			new Response(subprocess.stderr).text()
		]);
		const result = JSON.parse(stdout);

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');
		expect(result).toMatchObject({
			changed: true,
			format: 1,
			path: '.github/workflows/absolute-mobile.yml',
			platforms: ['android'],
			publishing: false
		});
		expect(stdout).not.toContain('com.secret.application');
		expect(stdout).not.toContain('private.example.com');
		expect(
			await readFile(
				join(projectRoot, '.github/workflows/absolute-mobile.yml'),
				'utf8'
			)
		).toContain("ABSOLUTE_SERVER_ENTRY: 'src/server.ts'");
	});
});
