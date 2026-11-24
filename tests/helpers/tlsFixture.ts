import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Self-signed certificates for tests, made when the test runs. Not
 * checked in: a private key in the repository is a finding for every
 * secret scanner that reads it, however harmless this one would be. */

const VALID_DAYS = 30;

const openssl = (args: string[]) => {
	const result = Bun.spawnSync(['openssl', ...args], {
		stderr: 'pipe',
		stdout: 'pipe'
	});
	if (result.exitCode !== 0)
		throw new Error(
			`openssl ${args[0]} failed; these tests need openssl on PATH.\n${result.stderr.toString()}`
		);
};

export const createTlsFixture = async () => {
	const directory = await mkdtemp(join(tmpdir(), 'absolute-tls-'));
	const pair = (name: string, days = VALID_DAYS) => {
		const cert = join(directory, `${name}.crt`);
		const key = join(directory, `${name}.key`);
		openssl([
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-keyout',
			key,
			'-out',
			cert,
			'-days',
			String(days),
			'-subj',
			`/CN=${name}.localhost`,
			'-addext',
			'subjectAltName=DNS:localhost,IP:127.0.0.1'
		]);

		return { cert, key };
	};

	return {
		directory,
		pair,
		remove: () => rm(directory, { force: true, recursive: true })
	};
};
