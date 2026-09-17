type ServiceCommandResult = { exitCode: number; stdout: string };
type ServiceReadinessOptions = {
	adb: string;
	pollMs?: number;
	run: (command: string[]) => Promise<ServiceCommandResult>;
	serial: string;
	timeoutMs?: number;
};

const SERVICE_TIMEOUT_MS = 180_000;
const SERVICE_POLL_MS = 500;

/** Boot-completed can precede telephony registration on a cold emulator. */
export const waitForAbsoluteAndroidNetworkServices = async (
	options: ServiceReadinessOptions
) => {
	const startedAt = performance.now();
	const waitForServices = async (): Promise<void> => {
		const states = await Promise.all(
			['wifi', 'phone'].map(async (service) => {
				const result = await options.run([
					options.adb,
					'-s',
					options.serial,
					'shell',
					'service',
					'check',
					service
				]);

				return {
					ready:
						result.exitCode === 0 &&
						result.stdout.trim() === `Service ${service}: found`,
					service
				};
			})
		);
		const missing = states
			.filter(({ ready }) => !ready)
			.map(({ service }) => service);
		if (missing.length === 0) return;
		if (
			performance.now() - startedAt >=
			(options.timeoutMs ?? SERVICE_TIMEOUT_MS)
		)
			throw new Error(
				`Android network services did not become ready: ${missing.join(', ')}. Finish booting or restart the emulator before installed offline acceptance; no network settings were changed.`
			);
		await Bun.sleep(options.pollMs ?? SERVICE_POLL_MS);

		await waitForServices();
	};

	await waitForServices();
};
