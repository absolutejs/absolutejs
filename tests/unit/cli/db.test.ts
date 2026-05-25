import { describe, expect, test } from 'bun:test';
import {
	chunkRows,
	conflictClause,
	dependencyOrder,
	encodeValue,
	quoteIdent
} from '../../../src/cli/scripts/db';

describe('db quoteIdent', () => {
	test('wraps identifiers and escapes embedded quotes', () => {
		expect(quoteIdent('players')).toBe('"players"');
		expect(quoteIdent('we"ird')).toBe('"we""ird"');
	});
});

describe('db chunkRows', () => {
	test('splits rows into fixed-size chunks', () => {
		expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});

	test('empty input yields no chunks', () => {
		expect(chunkRows([], 500)).toEqual([]);
	});
});

describe('db encodeValue', () => {
	test('null and undefined collapse to null', () => {
		expect(encodeValue({ isJson: false, name: 'x' }, null)).toBeNull();
		expect(encodeValue({ isJson: false, name: 'x' }, undefined)).toBeNull();
	});

	test('json columns are serialized to text', () => {
		expect(encodeValue({ isJson: true, name: 'meta' }, { ok: 1 })).toBe(
			'{"ok":1}'
		);
	});

	test('scalars pass through untouched', () => {
		expect(encodeValue({ isJson: false, name: 'n' }, 7)).toBe(7);
	});
});

describe('db conflictClause', () => {
	test('upserts non-key columns keyed by the primary key', () => {
		const clause = conflictClause({
			columns: [
				{ isJson: false, name: 'id' },
				{ isJson: false, name: 'handle' },
				{ isJson: false, name: 'xp' }
			],
			name: 'players',
			primaryKey: ['id']
		});
		expect(clause).toBe(
			'on conflict ("id") do update set "handle" = excluded."handle", "xp" = excluded."xp"'
		);
	});

	test('a table with no primary key does nothing on conflict', () => {
		const clause = conflictClause({
			columns: [{ isJson: false, name: 'a' }],
			name: 'logline',
			primaryKey: []
		});
		expect(clause).toBe('on conflict do nothing');
	});

	test('a key-only join table does nothing on conflict', () => {
		const clause = conflictClause({
			columns: [
				{ isJson: false, name: 'player_id' },
				{ isJson: false, name: 'achievement_id' }
			],
			name: 'player_achievements',
			primaryKey: ['player_id', 'achievement_id']
		});
		expect(clause).toBe(
			'on conflict ("player_id", "achievement_id") do nothing'
		);
	});
});

describe('db dependencyOrder', () => {
	test('restores parents before the rows that reference them', () => {
		const order = dependencyOrder(
			['player_achievements', 'players', 'achievements'],
			[
				{ from: 'player_achievements', to: 'players' },
				{ from: 'player_achievements', to: 'achievements' }
			]
		);
		expect(order.indexOf('players')).toBeLessThan(
			order.indexOf('player_achievements')
		);
		expect(order.indexOf('achievements')).toBeLessThan(
			order.indexOf('player_achievements')
		);
	});

	test('keeps every table even when foreign keys form a cycle', () => {
		const order = dependencyOrder(
			['alpha', 'beta'],
			[
				{ from: 'alpha', to: 'beta' },
				{ from: 'beta', to: 'alpha' }
			]
		);
		expect([...order].sort()).toEqual(['alpha', 'beta']);
	});
});
