import { InjectionToken } from '@angular/core';

const DEFAULT_DETERMINISTIC_SEED = 'absolute-angular';
const DEFAULT_DETERMINISTIC_NOW = 0;
const HASH_MULTIPLIER = 31;
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const XORSHIFT_LEFT_1 = 13;
const XORSHIFT_LEFT_2 = 5;
const XORSHIFT_RIGHT = 17;
const UINT32_MAX = 0x100000000;

export type DeterministicRandom = () => number;

export type DeterministicEnvOptions = {
	now?: Date | number | string;
	seed?: number | string;
};

export const DETERMINISTIC_NOW = new InjectionToken<number>(
	'DETERMINISTIC_NOW'
);
export const DETERMINISTIC_RANDOM = new InjectionToken<DeterministicRandom>(
	'DETERMINISTIC_RANDOM'
);
export const DETERMINISTIC_SEED = new InjectionToken<string>(
	'DETERMINISTIC_SEED'
);

const hashSeed = (seed: number | string) => {
	const seedText = String(seed);
	let hash = FNV_OFFSET_BASIS;

	for (const char of seedText) {
		hash = Math.imul(hash ^ char.charCodeAt(0), FNV_PRIME);
	}

	return hash >>> 0 || HASH_MULTIPLIER;
};

export const createDeterministicRandom = (
	seed: number | string = DEFAULT_DETERMINISTIC_SEED
) => {
	let state = hashSeed(seed);

	return () => {
		state ^= state << XORSHIFT_LEFT_1;
		state ^= state >>> XORSHIFT_RIGHT;
		state ^= state << XORSHIFT_LEFT_2;

		return (state >>> 0) / UINT32_MAX;
	};
};

const normalizeNow = (now: Date | number | string | undefined) => {
	if (now instanceof Date) return now.getTime();
	if (typeof now === 'string') return new Date(now).getTime();
	if (typeof now === 'number') return now;

	return DEFAULT_DETERMINISTIC_NOW;
};

export const provideDeterministicEnv = (
	options: DeterministicEnvOptions = {}
) => {
	const seed = String(options.seed ?? DEFAULT_DETERMINISTIC_SEED);
	const now = normalizeNow(options.now);

	return [
		{ provide: DETERMINISTIC_SEED, useValue: seed },
		{ provide: DETERMINISTIC_NOW, useValue: now },
		{
			deps: [DETERMINISTIC_SEED],
			provide: DETERMINISTIC_RANDOM,
			useFactory: createDeterministicRandom
		}
	];
};
