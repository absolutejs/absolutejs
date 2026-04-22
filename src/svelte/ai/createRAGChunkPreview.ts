import { derived, writable } from 'svelte/store';
import type { RAGDocumentChunkPreview } from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';
import {
	buildRAGSectionRetrievalDiagnostics,
	buildRAGChunkPreviewNavigation,
	buildRAGChunkPreviewGraph
} from '../../ai/rag/ui';

export const createRAGChunkPreview = (path: string) => {
	const client = createRAGClient({ path });
	const preview = writable<RAGDocumentChunkPreview | null>(null);
	const activeChunkId = writable<string | null>(null);
	const error = writable<string | null>(null);
	const isLoading = writable(false);
	const chunkGraph = derived(preview, ($preview) =>
		$preview ? buildRAGChunkPreviewGraph($preview) : null
	);
	const navigationWithSelection = derived(
		[preview, activeChunkId],
		([$preview, $activeChunkId]) =>
			$preview
				? buildRAGChunkPreviewNavigation(
						$preview,
						$activeChunkId ?? undefined
					)
				: null
	);
	const previewSources = derived(preview, ($preview) =>
		$preview
			? $preview.chunks.map((chunk, index) => ({
					chunkId: chunk.chunkId,
					labels: chunk.labels,
					metadata: chunk.metadata,
					score: Math.max(0, $preview.chunks.length - index),
					source: chunk.source ?? $preview.document.source,
					structure: chunk.structure,
					text: chunk.text,
					title: chunk.title ?? $preview.document.title
				}))
			: []
	);
	const sectionDiagnostics = derived(previewSources, ($previewSources) =>
		buildRAGSectionRetrievalDiagnostics($previewSources)
	);
	const activeSectionDiagnostic = derived(
		[navigationWithSelection, sectionDiagnostics],
		([$navigation, $sectionDiagnostics]) => {
			const sectionKey = $navigation?.section?.path?.join(' > ');
			return sectionKey
				? ($sectionDiagnostics.find(
						(diagnostic) => diagnostic.key === sectionKey
					) ?? null)
				: null;
		}
	);

	const inspect = async (id: string) => {
		isLoading.set(true);
		error.set(null);

		try {
			const response = await client.documentChunks(id);
			if (!response.ok) {
				throw new Error(response.error);
			}

			preview.set(response);
			activeChunkId.set(response.chunks[0]?.chunkId ?? null);

			return response;
		} catch (caught) {
			error.set(
				caught instanceof Error ? caught.message : String(caught)
			);
			throw caught;
		} finally {
			isLoading.set(false);
		}
	};

	const clear = () => {
		error.set(null);
		isLoading.set(false);
		activeChunkId.set(null);
		preview.set(null);
	};

	const selectChunk = (id: string | null) => {
		activeChunkId.set(id);
	};
	const selectParentSection = () => {
		let leadChunkId: string | undefined;
		const unsubscribe = navigationWithSelection.subscribe(($navigation) => {
			leadChunkId = $navigation?.parentSection?.leadChunkId;
		});
		unsubscribe();
		if (leadChunkId) {
			activeChunkId.set(leadChunkId);
		}
	};
	const selectChildSection = (sectionId: string) => {
		let leadChunkId: string | undefined;
		const unsubscribe = navigationWithSelection.subscribe(($navigation) => {
			leadChunkId = $navigation?.childSections.find(
				(section) => section.id === sectionId
			)?.leadChunkId;
		});
		unsubscribe();
		if (leadChunkId) {
			activeChunkId.set(leadChunkId);
		}
	};
	const selectSiblingSection = (sectionId: string) => {
		let leadChunkId: string | undefined;
		const unsubscribe = navigationWithSelection.subscribe(($navigation) => {
			leadChunkId = $navigation?.siblingSections.find(
				(section) => section.id === sectionId
			)?.leadChunkId;
		});
		unsubscribe();
		if (leadChunkId) {
			activeChunkId.set(leadChunkId);
		}
	};

	return {
		activeChunkId,
		activeSectionDiagnostic,
		clear,
		chunkGraph,
		error,
		inspect,
		isLoading,
		navigation: navigationWithSelection,
		preview,
		sectionDiagnostics,
		selectChildSection,
		selectChunk,
		selectParentSection,
		selectSiblingSection
	};
};

export type CreateRAGChunkPreviewResult = ReturnType<
	typeof createRAGChunkPreview
>;
