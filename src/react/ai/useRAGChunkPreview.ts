import { useCallback, useMemo, useState } from 'react';
import type { RAGDocumentChunkPreview } from '../../../types/ai';
import { createRAGClient } from '../../ai/client';
import {
	buildRAGSectionRetrievalDiagnostics,
	buildRAGChunkPreviewNavigation,
	buildRAGChunkPreviewGraph
} from '../../ai/rag/ui';

export const useRAGChunkPreview = (path: string) => {
	const client = useMemo(() => createRAGClient({ path }), [path]);
	const [preview, setPreview] = useState<RAGDocumentChunkPreview | null>(
		null
	);
	const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const inspect = useCallback(
		async (id: string) => {
			setIsLoading(true);
			setError(null);

			try {
				const response = await client.documentChunks(id);
				if (!response.ok) {
					throw new Error(response.error);
				}

				setPreview(response);
				setActiveChunkId(response.chunks[0]?.chunkId ?? null);

				return response;
			} catch (err) {
				const message =
					err instanceof Error
						? err.message
						: 'Failed to load RAG chunk preview';
				setError(message);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[client]
	);

	const clear = useCallback(() => {
		setPreview(null);
		setActiveChunkId(null);
		setError(null);
		setIsLoading(false);
	}, []);

	const chunkGraph = useMemo(
		() => (preview ? buildRAGChunkPreviewGraph(preview) : null),
		[preview]
	);
	const navigation = useMemo(
		() =>
			preview
				? buildRAGChunkPreviewNavigation(
						preview,
						activeChunkId ?? undefined
					)
				: null,
		[activeChunkId, preview]
	);
	const previewSources = useMemo(
		() =>
			preview
				? preview.chunks.map((chunk, index) => ({
						chunkId: chunk.chunkId,
						labels: chunk.labels,
						metadata: chunk.metadata,
						score: Math.max(0, preview.chunks.length - index),
						source: chunk.source ?? preview.document.source,
						structure: chunk.structure,
						text: chunk.text,
						title: chunk.title ?? preview.document.title
					}))
				: [],
		[preview]
	);
	const sectionDiagnostics = useMemo(
		() => buildRAGSectionRetrievalDiagnostics(previewSources),
		[previewSources]
	);
	const activeSectionDiagnostic = useMemo(() => {
		const sectionKey = navigation?.section?.path?.join(' > ');
		return sectionKey
			? (sectionDiagnostics.find(
					(diagnostic) => diagnostic.key === sectionKey
				) ?? null)
			: null;
	}, [navigation, sectionDiagnostics]);
	const selectChunk = useCallback((id: string | null) => {
		setActiveChunkId(id);
	}, []);
	const selectParentSection = useCallback(() => {
		const leadChunkId = navigation?.parentSection?.leadChunkId;
		if (leadChunkId) {
			setActiveChunkId(leadChunkId);
		}
	}, [navigation]);
	const selectChildSection = useCallback(
		(sectionId: string) => {
			const leadChunkId = navigation?.childSections.find(
				(section) => section.id === sectionId
			)?.leadChunkId;
			if (leadChunkId) {
				setActiveChunkId(leadChunkId);
			}
		},
		[navigation]
	);
	const selectSiblingSection = useCallback(
		(sectionId: string) => {
			const leadChunkId = navigation?.siblingSections.find(
				(section) => section.id === sectionId
			)?.leadChunkId;
			if (leadChunkId) {
				setActiveChunkId(leadChunkId);
			}
		},
		[navigation]
	);

	return {
		activeChunkId,
		activeSectionDiagnostic,
		chunkGraph,
		clear,
		error,
		inspect,
		isLoading,
		navigation,
		preview,
		sectionDiagnostics,
		selectChildSection,
		selectChunk,
		selectParentSection,
		selectSiblingSection
	};
};

export type UseRAGChunkPreviewResult = ReturnType<typeof useRAGChunkPreview>;
