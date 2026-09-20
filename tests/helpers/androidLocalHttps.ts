import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	writeFile
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { inspectAbsoluteMobileToolchain } from '../../src/mobile/emulatorDoctor';
import { matchesAndroidAvdIdentity } from './androidAvdIdentity';
import { androidTestGraphicsArgs } from './androidTestGraphics';
import { requireAndroidUiReadiness } from './androidUiReadiness';
import { readAndroidUiSnapshot } from './androidUiSnapshot';
import { saveAndroidDiagnostic } from './androidDiagnostic';
import { requireAndroidCpuSettled } from './androidCpuSettling';

export const createLocalHttpsEmulator = async (
	root: string,
	output: string
) => {
	const graphics = androidTestGraphicsArgs(
		process.env.ABSOLUTE_TEST_RELEASE_GPU,
		process.env.ABSOLUTE_TEST_RELEASE_DISABLE_VULKAN
	);
	await mkdir(output, { mode: 0o700, recursive: true });
	const checks = await inspectAbsoluteMobileToolchain();
	const tool = (id: string) => {
		const check = checks.find((item) => item.id === id);
		if (!check?.path || check.status === 'fail')
			throw new Error(check?.remediation ?? `Missing ${id}`);

		return check.path;
	};
	const adb = tool('android.adb');
	const emulator = tool('android.emulator');
	const java = tool('android.java');
	const windows = emulator.endsWith('.exe');
	const wsl = windows && process.platform !== 'win32';
	const run = async (
		args: string[],
		cwd = root,
		env = process.env,
		timeout = 60_000
	) => (await nativeCapture(args, cwd, env, timeout)).toString().trim();
	const toolPath = async (path: string) =>
		wsl ? run(['wslpath', '-w', path]) : path;
	const hostPath = async (path: string) =>
		wsl ? run(['wslpath', '-u', path]) : path;
	const serial = 'emulator-5580';
	if ((await run([adb, 'devices'])).includes(serial))
		throw new Error(`${serial} is occupied; refusing to touch it.`);
	const device = (...args: string[]) => run([adb, '-s', serial, ...args]);
	const home = windows
		? await hostPath(await run(['cmd.exe', '/c', 'echo %USERPROFILE%']))
		: homedir();
	const temporary = windows
		? await hostPath(await run(['cmd.exe', '/c', 'echo %TEMP%']))
		: tmpdir();
	const reuse = process.env.ABSOLUTE_TEST_RELEASE_REUSE_RUN;
	const resolveAvdHome = async () => {
		if (!reuse) return mkdtemp(join(temporary, 'absolute-release-data-'));
		const previous = await realpath(resolve(root, reuse));
		if (
			dirname(previous) !== (await realpath(dirname(output))) ||
			!/^[a-f0-9-]{36}$/u.test(basename(previous))
		)
			throw new Error(
				'Reuse requires an existing release-data run directory'
			);
		const candidate = await realpath(
			(
				await readFile(join(previous, 'temporary-avd-path.txt'), 'utf8')
			).trim()
		);
		if (
			dirname(candidate) !== (await realpath(temporary)) ||
			!/^absolute-release-data-[A-Za-z0-9]+$/u.test(basename(candidate))
		)
			throw new Error('Refusing to reuse a non-test AVD directory');
		const ini = await readFile(
			join(candidate, 'AbsoluteJS_Release_Data_Proof.ini'),
			'utf8'
		);
		if (
			(await realpath(
				join(candidate, 'AbsoluteJS_Release_Data_Proof.avd')
			)) !== join(candidate, 'AbsoluteJS_Release_Data_Proof.avd')
		)
			throw new Error('Refusing redirected test AVD userdata');
		if (
			!ini.includes(
				`path=${await toolPath(join(candidate, 'AbsoluteJS_Release_Data_Proof.avd'))}\n`
			)
		)
			throw new Error('Reusable AVD identity mismatch');

		return candidate;
	};
	const avdHome = await resolveAvdHome();
	const avdName = 'AbsoluteJS_Release_Data_Proof';
	const avd = join(avdHome, `${avdName}.avd`);
	await mkdir(avd, { recursive: true });
	const template =
		process.env.ABSOLUTE_TEST_RELEASE_AVD_CONFIG ??
		join(home, '.android/avd/AbsoluteJS_API_36.avd/config.ini');
	const config = await readFile(template, 'utf8');
	if (
		!/image.sysdir.1=system-images[\\/]android-36[\\/]google_apis[\\/]x86_64/u.test(
			config
		)
	)
		throw new Error(
			'Local trust acceptance requires the managed API 36 Google APIs x86_64 image.'
		);
	await writeFile(
		join(avd, 'config.ini'),
		config.replace(
			/^disk.dataPartition.size=.*$/mu,
			'disk.dataPartition.size=4G'
		)
	);
	await writeFile(
		join(avdHome, `${avdName}.ini`),
		`avd.ini.encoding=UTF-8\npath=${await toolPath(avd)}\ntarget=android-36\n`
	);
	await writeFile(join(output, 'temporary-avd-path.txt'), avdHome);
	await writeFile(
		join(output, 'emulator-options.json'),
		JSON.stringify(
			{
				cores: 4,
				graphics:
					process.env.ABSOLUTE_TEST_RELEASE_GPU ?? 'avd-default',
				memoryMb: 3072,
				serial,
				vulkan:
					process.env.ABSOLUTE_TEST_RELEASE_DISABLE_VULKAN === '1'
						? 'disabled'
						: 'default'
			},
			null,
			2
		)
	);
	const ca = await mkdtemp(join(output, 'ca-'));
	const certEnv: NodeJS.ProcessEnv = { ...process.env, CAROOT: ca };
	// Reuse AbsoluteJS's HTTPS certificate generation; never invoke mkcert -install.
	await run(
		[
			process.execPath,
			'-e',
			`const {ensureDevCert}=await import(${JSON.stringify(join(root, 'src/dev/devCert.ts'))}); if(!ensureDevCert()) process.exit(1)`
		],
		ca,
		certEnv
	);
	const authority = join(ca, 'rootCA.pem');
	await readFile(authority); // Fail closed: this harness requires an isolated mkcert CA.
	const cert = join(ca, '.absolutejs/cert.pem');
	const key = join(ca, '.absolutejs/key.pem');
	const hash = await run([
		'openssl',
		'x509',
		'-in',
		authority,
		'-subject_hash_old',
		'-noout'
	]);
	if (!/^[a-f0-9]{8}$/u.test(hash))
		throw new Error('Invalid certificate hash');
	const child = Bun.spawn(
		[
			emulator,
			'-avd',
			avdName,
			'-no-snapshot',
			'-no-window',
			'-no-audio',
			'-port',
			'5580',
			'-memory',
			'3072',
			'-cores',
			'4',
			...graphics
		],
		{
			cwd: avdHome,
			env: {
				...process.env,
				ANDROID_AVD_HOME: await toolPath(avdHome),
				WSLENV: [process.env.WSLENV, 'ANDROID_AVD_HOME']
					.filter(Boolean)
					.join(':')
			},
			stderr: Bun.file(join(output, 'emulator.stderr.log')),
			stdin: 'ignore',
			stdout: Bun.file(join(output, 'emulator.stdout.log'))
		}
	);
	const close = async () => {
		if (child.exitCode === null) {
			const name = await device('emu', 'avd', 'name').catch(() => '');
			if (matchesAndroidAvdIdentity(name, avdName))
				await device('emu', 'kill').catch(() => child.kill());
			else child.kill();
		}
		await child.exited;
	};
	try {
		await pollNative(
			async () => {
				if (child.exitCode !== null)
					throw new Error(`Emulator exited: ${child.exitCode}`);

				return (
					(await device('shell', 'getprop', 'sys.boot_completed')) ===
					'1'
				);
			},
			'isolated emulator boot',
			10 * 60 * 1000
		);
		if (
			!matchesAndroidAvdIdentity(
				await device('emu', 'avd', 'name'),
				avdName
			)
		)
			throw new Error('Emulator ownership mismatch');
		await device('root');
		await pollNative(
			async () => (await device('shell', 'id', '-u')) === '0',
			'test emulator root'
		);
		await device('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
		await device('shell', 'wm', 'dismiss-keyguard');
		await device('shell', 'input', 'keyevent', 'KEYCODE_HOME');
		let sample = 0;
		try {
			let pressureSample = 0;
			await requireAndroidCpuSettled(async () => {
				const pressure = await device(
					'shell',
					'cat',
					'/proc/pressure/cpu'
				);
				await writeFile(
					join(output, `boot-cpu-${pressureSample++}.txt`),
					pressure
				);

				return pressure;
			});
			await requireAndroidUiReadiness(async () => {
				const xml = await readAndroidUiSnapshot(device, {
					onAttempt: async ({ attempt, output: diagnostic }) => {
						await writeFile(
							join(
								output,
								`readiness-capture-${sample}-${attempt}.log`
							),
							diagnostic
						);
					}
				});
				await writeFile(join(output, `readiness-${sample++}.xml`), xml);

				return xml;
			});
		} catch (error) {
			await saveAndroidDiagnostic(
				join(output, 'readiness-failed.png'),
				() =>
					nativeCapture(
						[adb, '-s', serial, 'exec-out', 'screencap', '-p'],
						root
					)
			);
			await saveAndroidDiagnostic(
				join(output, 'readiness-logcat.txt'),
				() => device('logcat', '-d', '-t', '2500')
			);
			throw error;
		}
		const trust = async () => {
			const target = '/apex/com.android.conscrypt/cacerts';
			const stage = `/data/local/tmp/absolute-release-data-cacerts-${hash}`;
			await device(
				'shell',
				`mkdir -p ${stage} && cp ${target}/* ${stage}/`
			);
			await device(
				'push',
				await toolPath(authority),
				`${stage}/${hash}.0`
			);
			await device(
				'shell',
				`chmod 755 ${stage} && chmod 644 ${stage}/* && chcon -R u:object_r:system_file:s0 ${stage}`
			);
			await device('shell', 'mount', '--bind', stage, target);
			const pids = (await device('shell', 'pidof', 'zygote64')).split(
				/\s+/u
			);
			for (const pid of pids) {
				if (!/^\d+$/u.test(pid)) throw new Error('Invalid zygote PID');
				await device(
					'shell',
					'nsenter',
					`--mount=/proc/${pid}/ns/mnt`,
					'--',
					'mount',
					'--bind',
					stage,
					target
				);
			}
		};

		return {
			adb,
			cert,
			close,
			device,
			java,
			key,
			keytool: join(dirname(java), windows ? 'keytool.exe' : 'keytool'),
			run,
			serial,
			toolPath,
			trust
		};
	} catch (error) {
		await close();
		throw error;
	}
};
export const nativeCapture = async (
	command: string[],
	cwd: string,
	env = process.env,
	timeout = 60_000
) => {
	const child = Bun.spawn(command, {
		cwd,
		env,
		signal: AbortSignal.timeout(timeout),
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});
	const [code, bytes, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).arrayBuffer(),
		new Response(child.stderr).text()
	]);
	if (code !== 0)
		throw new Error(
			`${command[0]} failed (${code}): ${Buffer.from(bytes).toString()}\n${stderr}`
		);

	return Buffer.from(bytes);
};
export const pollNative = async (
	read: () => Promise<boolean>,
	label: string,
	timeout = 90_000
) => {
	const start = Date.now();
	let lastError: unknown;
	while (Date.now() - start < timeout) {
		try {
			if (await read()) return;
		} catch (error) {
			lastError = error;
		}
		await Bun.sleep(1000);
	}
	throw new Error(`Timed out: ${label}`, { cause: lastError });
};
