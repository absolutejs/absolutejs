import { createServer } from 'net';

export const getAvailablePort = () =>
	new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.listen(0, () => {
			const addr = server.address();
			if (!addr || typeof addr === 'string') {
				server.close();
				reject(new Error('Could not get port'));

				return;
			}
			const { port } = addr;
			server.close(() => resolve(port));
		});
		server.on('error', reject);
	});
