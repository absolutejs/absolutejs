import { computed, ref } from 'vue';
import type { RAGDocumentChunkPreview } from '../../../types/ai';
import { createRAGClient } from '../../ai/client/ragClient';
import {
	buildRAGSectionRetrievalDiagnostics,
	buildRAGChunkPreviewNavigation,
	buildRAGChunkPreviewGraph
} from '../../ai/rag/ui';

export const useRAGChunkPreview = (path: string) => {
	const client = createRAGClient({ path });
	const preview = ref<RAGDocumentChunkPreview | null>(null);
	const activeChunkId = ref<string | null>(null);
	const error = ref<string | null>(null);
	const isLoading = ref(false);
	const chunkGraph = computed(() =>
		preview.value ? buildRAGChunkPreviewGraph(preview.value) : null
	);
	const navigation = computed(() =>
		preview.value
			? buildRAGChunkPreviewNavigation(
					preview.value,
					activeChunkId.value ?? undefined
				)
			: null
	);
	const previewSources = computed(() =>
		preview.value
			? preview.value.chunks.map((chunk, index) => ({
					chunkId: chunk.chunkId,
					labels: chunk.labels,
					metadata: chunk.metadata,
					score: Math.max(0, preview.value!.chunks.length - index),
					source: chunk.source ?? preview.value!.document.source,
					structure: chunk.structure,
					text: chunk.text,
					title: chunk.title ?? preview.value!.document.title
				}))
			: []
	);
	const sectionDiagnostics = computed(() =>
		buildRAGSectionRetrievalDiagnostics(previewSources.value)
	);
	const activeSectionDiagnostic = computed(() => {
		const sectionKey = navigation.value?.section?.path?.join(' > ');
		return sectionKey
			? (sectionDiagnostics.value.find(
					(diagnostic) => diagnostic.key === sectionKey
				) ?? null)
			: null;
	});

	const inspect = async (id: string) => {
		isLoading.value = true;
		error.value = null;

		try {
			const response = await client.documentChunks(id);
			if (!response.ok) {
				throw new Error(response.error);
			}

			preview.value = response;
			activeChunkId.value = response.chunks[0]?.chunkId ?? null;

			return response;
		} catch (caught) {
			error.value =
				caught instanceof Error ? caught.message : String(caught);
			throw caught;
		} finally {
			isLoading.value = false;
		}
	};

	const clear = () => {
		error.value = null;
		isLoading.value = false;
		activeChunkId.value = null;
		preview.value = null;
	};

	const selectChunk = (id: string | null) => {
		activeChunkId.value = id;
	};
	const selectParentSection = () => {
		const leadChunkId = navigation.value?.parentSection?.leadChunkId;
		if (leadChunkId) {
			activeChunkId.value = leadChunkId;
		}
	};
	const selectChildSection = (sectionId: string) => {
		const leadChunkId = navigation.value?.childSections.find(
			(section) => section.id === sectionId
		)?.leadChunkId;
		if (leadChunkId) {
			activeChunkId.value = leadChunkId;
		}
	};
	const selectSiblingSection = (sectionId: string) => {
		const leadChunkId = navigation.value?.siblingSections.find(
			(section) => section.id === sectionId
		)?.leadChunkId;
		if (leadChunkId) {
			activeChunkId.value = leadChunkId;
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
