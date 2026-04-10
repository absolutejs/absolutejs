import { derived, type Readable } from 'svelte/store';
import type { RAGSource } from '../../../types/ai';
import {
	buildRAGGroundedAnswer,
	buildRAGGroundingReferences
} from '../../ai/rag/presentation';

export const createRAGGrounding = (
	content: Readable<string>,
	sources: Readable<RAGSource[]>
) => {
	const groundedAnswer = derived([content, sources], ([$content, $sources]) =>
		buildRAGGroundedAnswer($content, $sources)
	);
	const references = derived(sources, ($sources) =>
		buildRAGGroundingReferences($sources)
	);
	const hasCitations = derived(
		groundedAnswer,
		($groundedAnswer) => $groundedAnswer.hasCitations
	);
	const hasGrounding = derived(
		references,
		($references) => $references.length > 0
	);
	const coverage = derived(
		groundedAnswer,
		($groundedAnswer) => $groundedAnswer.coverage
	);
	const ungroundedReferenceNumbers = derived(
		groundedAnswer,
		($groundedAnswer) => $groundedAnswer.ungroundedReferenceNumbers
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

export type CreateRAGGroundingResult = ReturnType<typeof createRAGGrounding>;
