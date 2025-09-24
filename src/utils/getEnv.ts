import { env } from 'bun';

export const getEnv = (key: string) => {
	const environmentVariable = env[key];
	if (
		typeof environmentVariable !== 'string' ||
		environmentVariable.length === 0
	) {
		throw new Error(`Missing environment variable ${key}`);
	}

	return environmentVariable;
};
