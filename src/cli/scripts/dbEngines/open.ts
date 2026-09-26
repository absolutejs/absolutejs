import type { DbTarget } from '../../../../types/db';
import { sqlitePath } from './detect';
import { openMssql } from './mssql';
import { openMysql } from './mysql';
import { openPostgres } from './postgres';
import { bunSqliteExecutor, libsqlExecutor, openSqlite } from './sqlite';

export const openConnection = async (target: DbTarget, cwd: string) => {
	if (target.family === 'postgres') return openPostgres(target.url);
	if (target.family === 'mysql') return openMysql(target.url);
	if (target.family === 'mssql') return openMssql(target.url);
	if (target.family === 'libsql')
		return openSqlite(await libsqlExecutor(target.url), 'libsql');

	return openSqlite(bunSqliteExecutor(sqlitePath(target.url, cwd)), 'sqlite');
};
