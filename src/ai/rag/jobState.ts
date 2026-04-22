import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
	RAGAdminActionRecord,
	RAGAdminJobRecord,
	RAGIngestJobRecord,
	RAGJobStateStore
} from '../../../types/ai';

const parseJobState = (content: string) => {
	try {
		const parsed = JSON.parse(content) as {
			adminActions?: RAGAdminActionRecord[];
			adminJobs?: RAGAdminJobRecord[];
			ingestJobs?: RAGIngestJobRecord[];
			syncJobs?: RAGAdminJobRecord[];
		};
		return {
			adminActions: Array.isArray(parsed.adminActions)
				? parsed.adminActions
				: [],
			adminJobs: Array.isArray(parsed.adminJobs) ? parsed.adminJobs : [],
			ingestJobs: Array.isArray(parsed.ingestJobs)
				? parsed.ingestJobs
				: [],
			syncJobs: Array.isArray(parsed.syncJobs) ? parsed.syncJobs : []
		};
	} catch {
		return {
			adminActions: [],
			adminJobs: [],
			ingestJobs: [],
			syncJobs: []
		};
	}
};

export const createRAGFileJobStateStore = (path: string): RAGJobStateStore => {
	const resolvedPath = resolve(path);

	return {
		load: async () => {
			try {
				return parseJobState(await readFile(resolvedPath, 'utf8'));
			} catch {
				return {
					adminActions: [],
					adminJobs: [],
					ingestJobs: [],
					syncJobs: []
				};
			}
		},
		save: async (state) => {
			await mkdir(dirname(resolvedPath), { recursive: true });
			await writeFile(
				resolvedPath,
				JSON.stringify(state, null, 2),
				'utf8'
			);
		}
	};
};
