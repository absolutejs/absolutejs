/* Value encoding between a driver's rows, the JSON backup file, and each
   dialect's bind parameters. Pure functions only. */
import type { DbColumnMeta, DbRow } from '../../../../types/db';

const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;
// `2024-01-02T03:04:05.678Z` (or a zero offset) as written by JSON.stringify.
const ISO_UTC_PATTERN =
	/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:Z|[+-]00:?00)$/;

type SerializedBuffer = { data: number[]; type: 'Buffer' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isSerializedBuffer = (value: unknown): value is SerializedBuffer =>
	isRecord(value) &&
	value.type === 'Buffer' &&
	Array.isArray(value.data) &&
	value.data.every((byte) => typeof byte === 'number');

/* Binary values are written with Buffer#toJSON ({"type":"Buffer","data":[…]}),
   the shape PostgreSQL backups have always used for bytea. */
export const decodeBinary = (value: unknown) =>
	isSerializedBuffer(value) ? Buffer.from(value.data) : undefined;

const isStructured = (value: unknown) =>
	Array.isArray(value) ||
	(isRecord(value) && !(value instanceof Date) && !Buffer.isBuffer(value));

/* Engines without a native JSON type (SQLite, libSQL, SQL Server) back JSON
   up as text; restoring that into a JSON column needs the parsed value. */
export const parseJsonText = (value: unknown) => {
	if (typeof value !== 'string') return value;
	try {
		const parsed: unknown = JSON.parse(value);

		return parsed;
	} catch {
		return value;
	}
};

const quotePgArrayElement = (value: unknown) => {
	if (value === null || value === undefined) return 'NULL';
	if (Array.isArray(value)) return pgArrayLiteral(value);
	const text = isRecord(value) ? JSON.stringify(value) : String(value);

	return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

/* PostgreSQL array literal (`{1,2}` / `{"a","b \"q\""}`): Bun binds text
   parameters reliably but not JS arrays. */
export const encodeMssqlValue = (col: DbColumnMeta, value: unknown) => {
	if (value === null || value === undefined) return null;
	const bytes = decodeBinary(value);
	if (bytes !== undefined && !col.isJson) return bytes;
	if (isStructured(value)) return JSON.stringify(value);
	if (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		(value > INT32_MAX || value < INT32_MIN)
	)
		return String(value);
	if (col.kind === 'temporal' && typeof value === 'string')
		return value.replace(/Z$/, '');

	return value;
};
export const encodeMysqlValue = (col: DbColumnMeta, value: unknown) => {
	if (value === null || value === undefined) return null;
	const bytes = decodeBinary(value);
	if (bytes !== undefined && !col.isJson) return bytes;
	if (col.isJson) return JSON.stringify(value);
	if (isStructured(value)) return JSON.stringify(value);
	if (col.kind === 'temporal' && typeof value === 'string')
		return isoToSqlDateTime(value);

	return value;
};
export const encodeSqliteValue = (col: DbColumnMeta, value: unknown) => {
	if (value === null || value === undefined) return null;
	const bytes = decodeBinary(value);
	if (bytes !== undefined && !col.isJson) return new Uint8Array(bytes);
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (isStructured(value)) return JSON.stringify(value);

	return value;
};
export const encodeValue = (col: DbColumnMeta, value: unknown) => {
	if (value === null || value === undefined) return null;
	if (col.isJson) return value;
	const bytes = decodeBinary(value);
	if (bytes !== undefined) return bytes;
	if (Array.isArray(value)) return pgArrayLiteral(value);
	if (isStructured(value)) return JSON.stringify(value);

	return value;
};
export const isoToSqlDateTime = (value: string) =>
	value.replace(ISO_UTC_PATTERN, '$1 $2');
// Annotated as a variable: the literal and its elements recurse into each other.
export const pgArrayLiteral: (values: unknown[]) => string = (values) =>
	`{${values.map(quotePgArrayElement).join(',')}}`;

/* Driver row → JSON-safe row: integers that JS numbers cannot hold become
   strings and every byte container becomes a Buffer (serialized as above). */
const normalizeValue = (value: unknown) => {
	if (typeof value === 'bigint')
		return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
			value >= BigInt(Number.MIN_SAFE_INTEGER)
			? Number(value)
			: value.toString();
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	if (value instanceof Uint8Array && !Buffer.isBuffer(value))
		return Buffer.from(value);

	return value;
};

export const normalizeRow = (row: DbRow) =>
	Object.fromEntries(
		Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])
	);
