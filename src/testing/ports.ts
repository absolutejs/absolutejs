import { createServer } from 'node:net';

/** A port the OS says is free, by binding zero and reading back what it
 *  chose. Racy by nature — anything could take it before the server
 *  starts — but the alternative, a hard-coded port, fails every time two
 *  test files run at once rather than rarely. */
export const getAvailablePort = () =>
	new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			if (address === null || typeof address === 'string') {
				probe.close();
				reject(new Error('Could not determine a free port'));

				return;
			}
			const { port } = address;
			probe.close(() => resolve(port));
		});
		probe.on('error', reject);
	});
