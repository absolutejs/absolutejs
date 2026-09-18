type DeviceCommand = (...args: string[]) => Promise<string>;

/** Removing a reverse listener alone does not close its accepted TCP streams. */
export const disconnectAndroidTestBackend = async (device: DeviceCommand) => {
	await device('reverse', '--remove', 'tcp:48443');
	await device('reconnect');
	await device('wait-for-device');
};
