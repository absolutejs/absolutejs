import { expect, test } from 'bun:test';
import type {
	RAGChatPluginConfig,
	RAGFileExtractor
} from '../../../../types/ai';

type HasExtractorSurface = RAGChatPluginConfig extends {
	extractors?: RAGFileExtractor[];
}
	? true
	: false;

const hasExtractorSurface: HasExtractorSurface = true;

test('RAGChatPluginConfig exposes extractors', () => {
	expect(hasExtractorSurface).toBe(true);
});
