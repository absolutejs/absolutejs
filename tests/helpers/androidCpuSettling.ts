/** A test-only startup-load guard; the subsequent real UI checks remain required. */
export const requireAndroidCpuSettled = async (
	read: () => Promise<string>,
	wait: () => Promise<void> = () => Bun.sleep(5000)
) => {
	let consecutive = 0;
	for (let attempt = 0; attempt < 36; attempt++) {
		const pressure = await read();
		const value = /^some avg10=(\d+(?:\.\d+)?)\s/u.exec(pressure)?.[1];
		if (value === undefined || Number(value) > 100)
			throw new Error(
				'Android CPU pressure sample is missing or invalid'
			);
		consecutive = Number(value) <= 20 ? consecutive + 1 : 0;
		if (consecutive === 3) return;
		if (attempt < 35) await wait();
	}
	throw new Error('Android CPU pressure did not settle before UI automation');
};
