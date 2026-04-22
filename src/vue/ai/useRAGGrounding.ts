import { computed, type Ref } from 'vue';
import type { RAGSource } from '../../../types/ai';
import {
	buildRAGGroundedAnswer,
	buildRAGGroundingReferences
} from '../../ai/rag/ui';

export const useRAGGrounding = (
	content: Ref<string>,
	sources: Ref<RAGSource[]>
) => {
	const groundedAnswer = computed(() =>
		buildRAGGroundedAnswer(content.value, sources.value)
	);
	const references = computed(() =>
		buildRAGGroundingReferences(sources.value)
	);
	const hasCitations = computed(() => groundedAnswer.value.hasCitations);
	const hasGrounding = computed(() => references.value.length > 0);
	const coverage = computed(() => groundedAnswer.value.coverage);
	const ungroundedReferenceNumbers = computed(
		() => groundedAnswer.value.ungroundedReferenceNumbers
	);

	return {
		coverage,
		groundedAnswer,
		hasCitations,
		hasGrounding,
		references,
		ungroundedReferenceNumbers
	};
};

export type UseRAGGroundingResult = ReturnType<typeof useRAGGrounding>;
