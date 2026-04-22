import { readFixtureTree, createStoredZip, withTempFixtureFile } from './tests/unit/ai/rag/fixtureHelpers';
import { loadRAGDocumentFile, prepareRAGDocument } from './src/ai/rag/ingestion';
const docx = createStoredZip(readFixtureTree('office/docx_scope_slices'));
const loaded = await withTempFixtureFile('fixtures/scope-slices.docx', docx, (path) => loadRAGDocumentFile({ path }));
const prepared = prepareRAGDocument({
  ...loaded,
  chunking: { maxChunkLength: 120, minChunkLength: 1, strategy: 'source_aware' }
});
const rows = prepared.chunks
  .filter((chunk) => chunk.metadata?.officeBlockKind === 'table' && Array.isArray(chunk.metadata?.sectionPath) && chunk.metadata.sectionPath.join(' > ').includes('Review Notes (2) > Closure Notes'))
  .map((chunk) => ({
    path: chunk.metadata.sectionPath.join(' > '),
    title: chunk.metadata.sectionTitle,
    context: chunk.metadata.officeTableContextText,
    follow: chunk.metadata.officeTableFollowUpText
  }));
console.log(JSON.stringify({ sectionCount: loaded.metadata?.sectionCount, rows }, null, 2));
