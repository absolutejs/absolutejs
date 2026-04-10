# RAG + Vector Product Plan

## Objective
Make AbsoluteJS the synonymous industry leader for RAG and vector-driven products by owning the full workflow end to end, not just backend connectivity.

The release thesis is:
- AbsoluteJS should make ingestion, retrieval, reranking, citations, retrieval-aware streaming, evaluation, and backend switching feel native.
- The same RAG workflow should feel coherent across React, Vue, Svelte, Angular, HTML, and HTMX.
- Vector stores should be adapters behind a clean workflow surface, not the product identity.
- Every important RAG/vector capability should have a first-class core primitive, a first-class server story, and first-class framework surfaces.
- No hacks, no magic, and nothing bolted on after the fact.

## Current Status
AbsoluteJS now has a real first-class RAG/vector product surface, not just backend demos.

Implemented in core:
- backend-agnostic `ragPlugin(...)` / `createRAGCollection(...)`
- first-class retrieval search, status, documents, chunk preview, index admin, evaluation, reranking, and retrieval-aware streaming
- first-class high-level answer workflow primitives and lower-level stream primitives
- first-class operations/admin primitives for:
  - ingest job history
  - running admin job visibility
  - source sync records
  - source sync job visibility
  - corpus health
  - duplicate and coverage diagnostics
  - stale-index diagnostics
  - extraction/admin failure diagnostics
  - extractor/provider readiness
  - admin capability reporting
  - recent admin action history
  - targeted document reindex
  - targeted source reindex
  - source sync endpoints and client surfaces
- first-class source summaries, citations, citation maps, and evidence presentation primitives
- first-class answer-grounding primitives for:
  - grounded answer parsing
  - citation marker resolution
  - evidence reference mapping
  - metadata-aware context labels for page/sheet/slide/thread/archive evidence
- first-class retrieval quality primitives for:
  - saved evaluation suites
  - evaluation leaderboard building
  - shared evaluation response synthesis
  - reranker comparison helpers
  - retrieval strategy comparison
  - persisted benchmark history
  - benchmark diffs across runs
  - collection-level benchmark execution outside the route layer
- first-class answer-grounding quality primitives for:
  - grounding fidelity evaluation
  - provider grounding comparison
  - persisted grounding run history
  - grounding run diffs and leaderboards
  - hardest-case difficulty leaderboards
  - persisted difficulty history across runs
  - snapshot artifacts for answer text, cited ids, unresolved refs, and citation counts
- first-class file ingestion architecture for:
  - text-like files
  - PDFs
  - office files
  - EPUB
  - email files
  - legacy office/email files
  - images
  - audio
  - video
  - archives
- first-party extractor families for OCR, transcription, archive expansion, and file extraction
 - first-party provider-backed extractor engines for:
 	- OpenAI
 	- OpenAI-compatible APIs
 	- Gemini
 	- Ollama
 	- Anthropic where officially justified
 - richer extraction metadata including page, sheet, slide, archive-entry, and email-thread context
- first-class API naming contract:
  - `createRAGWorkflow` / `useRAGWorkflow` / `RAGWorkflowService` are now the canonical workflow entry points.
  - `createRAGStream` / `useRAGStream` / `RAGStreamService` remain transport/low-level primitives.
  - legacy `createRAGAnswerWorkflow` is no longer part of the public `@absolutejs/absolute` API surfaces (core/client and root exports) to keep workflow naming clean.

Current terminology direction:
- `corpus`: the first-party content inventory represented by searchable documents/chunks/documents in this product area.
- `knowledge base` (or `kb`): operational controls for sources, syncs, indexing health, rebuilds, and admin actions.
- `backend`: storage/runtime implementation family (`sqlite-native`, `sqlite-fallback`, `postgres`) that the corpus is mounted on.

Implemented across frontend/runtime surfaces:
- React hooks
- Vue composables
- Svelte stores/helpers
- Angular services/component flow
- HTML browser/client helpers
- HTMX server-rendered workflow responses

Implemented in the example:
- stuffed cross-format seed corpus
- visible retrieval, streaming, reranking, evaluation, citations, and chunk inspection
- visible upload-driven ingest demos across all six frontend modes
- extractor-backed file upload verification flow
- visible sync operations for:
  - directory
  - URL
  - storage
  - Gmail
  - Microsoft Graph
  - IMAP
- fixture/live account switching through env for storage and email providers
- persisted quality history panels for retrieval, rerankers, provider grounding, and grounding difficulty
- case-level provider grounding comparison
- SQLite native, SQLite fallback, and PostgreSQL parity

Recently fixed:
- `RAGChatPluginConfig.extractors` is now covered by a regression test and verified in the published `@absolutejs/absolute@0.19.0-beta.477` surface
- the example no longer needs a `ragPlugin(...)` type cast

What is not finished yet:
- browser-level automated workflow smoke for uploads/retrieval across all frontend modes
- storage/email sync depth beyond the current first-party adapter baseline
  - delta detection quality
  - deletion reconciliation for remote providers
  - larger-source resume semantics
- deeper answer-grounding productization
  - richer snapshot artifacts surfaced directly in the example
  - case-difficulty trends over time
  - provider artifact inspection without reconstructing from raw runs
- optional higher-depth extraction quality work for especially hard proprietary formats
- workflow/product docs at the end

## Leadership standard
AbsoluteJS should be the framework people name first when they want:
- first-class RAG workflow primitives instead of ad hoc utilities
- complete frontend and server support across multiple rendering models
- backend portability without backend lock-in
- visible retrieval/evidence workflows instead of opaque vector calls
- production-grade ingestion, evaluation, and operations as part of the framework itself

The bar is not "supports RAG".
The bar is:
- complete workflow coverage
- consistent primitives
- explicit architecture
- framework-native ergonomics
- production-readiness without glue code

## Product principles
Every feature in this area should follow these rules:
- first-party before third-party
- workflow-first before backend-first
- adapters behind stable interfaces
- explicit primitives over hidden magic
- same capability story across React, Vue, Svelte, Angular, HTML, and HTMX
- server and client surfaces should compose cleanly
- diagnostics, evidence, and operations should be built in
- local-first development with a credible production path
- fallback paths must exist and stay healthy

For a feature to count as done, it should have:
- a core primitive
- server integration
- framework-native client surfaces where applicable
- HTML support through exported functions
- HTMX support through server-rendered workflow responses
- example coverage
- type-safe ergonomics
- production-safe behavior
- docs and product story coverage

## Product Position
AbsoluteJS should not try to win by claiming it has a vector database.
AbsoluteJS should win by making RAG and vector workflows feel like a first-class framework capability.

That means AbsoluteJS should own:
- framework-native hooks, composables, services, and helpers
- a shared retrieval event model
- ingestion and chunking primitives
- embedding primitives
- reranking primitives
- citation and source primitives
- retrieval-stage streaming
- evaluation primitives
- production operations primitives
- backend-agnostic workflow APIs
- an owned fallback path that always works

The differentiator is:
- full-stack retrieval workflows
- workflow parity across all six frontend modes
- streaming visibility into retrieval stages
- first-class citations and source inspection
- first-class ingest pipelines including files, directories, and PDFs
- first-class evaluation and retrieval quality tooling
- first-class embedding and reranking integration without backend lock-in
- backend pluggability without backend lock-in

## Clean architecture

### Core: `@absolutejs/absolute`
Core owns the product.

Core should own:
- RAG types, protocol, and retrieval event model
- server-side orchestration plugin
- collection/search/ingest abstractions
- chunking and ingestion helpers
- embedding and reranking abstractions
- client hooks/composables/services for each framework
- source and citation primitives
- retrieval-stage streaming primitives
- evaluation and ops primitives
- adapter interfaces
- fallback behavior for development, tests, and baseline portability
- backend capability and status reporting

Core should not own:
- backend-specific install surfaces
- backend-specific release packaging
- backend-specific native binaries

### Scoped backend packages
Scoped packages own concrete backend implementations:
- `@absolutejs/absolute-rag-sqlite`
- `@absolutejs/absolute-rag-postgresql`
- later other backends only if justified

Backend packages should:
- expose the same core store contract
- keep backend complexity out of core
- own backend-specific setup and operational details
- remain implementation details under the shared workflow surface

Backend strategy:
- core-owned fallback is mandatory
- sqlite is the local embedded backend
- sqlite native vec is optional acceleration, not the feature definition
- PostgreSQL is the primary production backend family
- `pgvector` is the first PostgreSQL implementation, not the package identity

### Native platform packages
For backends that need native binaries:
- platform packages own distributed binaries
- the root backend package owns the install surface
- core auto-detects the backend package when present

Current sqlite-native packaging note:
- packaged sqlite-native support exists for macOS arm64/x64, Linux arm64/x64, and Windows x64
- Windows arm64 remains an upstream `sqlite-vec` gap and stays tracked as a backend packaging issue

## The real wedge
Supporting vector search is necessary, but it is not enough to make AbsoluteJS a must-choose option.

The must-choose features are:
- framework-native RAG hooks/composables/services
- retrieval-stage UI streaming
- first-class citations and source inspection
- ingestion as a visible workflow, not just a backend operation
- source-aware chunking and chunk debugging
- first-class file, directory, upload, and PDF ingestion
- first-class reranking and evaluation
- first-class production diagnostics and operations
- backend-agnostic workflow APIs

If AbsoluteJS does those well, users choose it because the workflow is better, not because it packaged a specific backend.

## Next Wedges
The next work should strengthen the reasons teams choose AbsoluteJS over another framework for RAG/vector products.

Execution priority this cycle:
- [Highest] keep API naming and semantics unambiguous across all framework surfaces:
  - `*Stream` = low-level transport/event surface.
  - `*Workflow` = high-level orchestration surface and first-class answer-workflow surface.
  - `createRAGWorkflow` / `useRAGWorkflow` / `RAGWorkflowService` are now canonical workflow entry points.
- [Highest] enforce parity by route and framework through executable checks in `absolutejs-rag-vector-example`.
- [High] expand source sync/incremental semantics and evidence-heavy source validation without regressing workflow framing.
- [High] finalize grounding artifact ergonomics and difficulty-trend visibility.

Highest-value next steps:
- API clarity lock (no mixed mental models):
  - keep stream/workflow naming explicit across all frontends:
    - `*Stream` = transport/event layer and canonical stream state.
    - `*Workflow` = orchestration convenience over stream state.
  - lock the stream/workflow naming contract before release:
    - `*Stream` APIs are transport-level with workflow snapshots only.
    - `*Workflow` APIs are the canonical high-level orchestration entry points.
- parity-first proof pass across all six modes:
  - each framework page must expose the same proof surfaces for:
    - corpus governance and admin visibility
    - retrieval quality and reranker deltas
    - grounding artifacts and citation traceability
    - streaming observability and back-pressure behavior
- deeper grounding quality platform work
  - persist richer provider answer artifacts
  - difficulty trends across runs
  - tighter case triage and inspection primitives
- storage/email sync depth
  - stronger remote delta detection
  - better reconciliation semantics
  - larger-source resume behavior
- deeper operations primitives where justified
  - more granular rebuild scopes
  - long-running workflow control if needed
- ingestion expansion where justified
  - deeper handling for especially hard proprietary formats
  - richer archive and attachment traversal
- automated browser-level product smoke
  - prove upload, retrieval, evaluation, grounding, and streaming flows across all frontend modes
  - keep regressions out of published betas, not just source
- workflow-grade documentation last
  - explain the full ingestion -> retrieval -> rerank -> ground -> evaluate -> stream -> cite story
  - document backend portability without making adapters the headline

## API direction

### Server
Core should expose a high-level server model:

```ts
const collection = createRAGCollection({
  store,
  embedding,
  chunking,
});

app.use(
  ragPlugin({
    path: "/rag",
    collection,
  }),
);
```

Key server primitives:
- `createRAGCollection(...)`
- `ragPlugin(...)`
- `ingestRAGDocuments(...)`
- `searchDocuments(...)`
- `prepareRAGDocument(...)`
- `prepareRAGDocumentFile(...)`
- `prepareRAGDirectoryDocuments(...)`
- `prepareRAGPDFDocument(...)`
- `createRAGEmbeddingProvider(...)`
- `createRAGReranker(...)`
- `createHeuristicRAGReranker(...)`
- retrieval evaluation helpers
- retrieval-aware streaming helpers

### Client workflow primitives
Each frontend should get framework-native RAG primitives so users do not need to think about request plumbing.

Target release surface:
- React
  - `useRAGSearch(...)`
  - `useRAGStatus(...)`
  - `useRAGIngest(...)`
  - `useRAGStream(...)`
  - `useRAGWorkflow(...)` (high-level convenience over stream state)
- Vue
  - `useRAGSearch(...)`
  - `useRAGStatus(...)`
  - `useRAGIngest(...)`
  - `useRAGStream(...)`
  - `useRAGWorkflow(...)` (high-level convenience over stream state)
- Svelte
  - `createRAGSearch(...)`
  - `createRAGStatus(...)`
  - `createRAGIngest(...)`
  - `createRAGStream(...)`
  - `createRAGWorkflow(...)` (high-level convenience over stream state)
- Angular
  - `RAGClientService`
  - `RAGIngestService`
  - `RAGWorkflowService`
- HTML
  - exported browser/client primitives for search, ingest, status, documents, chunk preview, index admin, and streaming
- HTMX
  - server-rendered workflow fragments through `ragPlugin({ htmx: ... })`
  - no client-side TS requirement
- Evaluation
  - `POST /rag/evaluate`
  - React `useRAGEvaluate(...)`
  - Vue `useRAGEvaluate(...)`
  - Svelte `createRAGEvaluate(...)`
  - Angular `RAGClientService.evaluate(...)`
  - HTML `createRAGClient(...).evaluate(...)`
  - HTMX `workflowRender.evaluateResult(...)`

These should feel as obvious and reusable as the existing AI primitives.

Naming decision implemented in current milestone:
- Low-level streaming primitives are explicit (`*Stream`) and are the canonical stream for retrieval answer workflows.
- `*Workflow` APIs are high-level convenience wrappers over stream state.

### Completion rule
AbsoluteJS should not ship feature gaps hidden behind raw fetches, example-only hacks, or "bring your own glue" instructions.

A workflow is only complete when:
- core exposes the primitive cleanly
- server routes/plugin support it directly
- React has hooks
- Vue has composables
- Svelte has stores/helpers
- Angular has services/signals integration
- HTML has exported TS/browser functions
- HTMX has server-rendered workflow support
- the example demonstrates it visibly
- the docs explain when and why to use it

### HTML and HTMX split
`HTML` and `HTMX` should not be forced into the same client model.

- `HTML`
  - should use exported browser/client primitives
  - examples:
    - `createRAGClient(...)`
    - `createRAGWorkflow(...)`
  - this keeps plain HTML first-class without requiring a framework

- `HTMX`
  - should remain server-driven
  - should not depend on client-side TS helpers
  - should use `ragPlugin({ htmx: ... })` with HTMX-specific render config
  - should return server-rendered fragments for workflow routes when `HX-Request: true`

Core rule:
- HTMX behavior must be opt-in and isolated
- HTMX config must not affect React/Vue/Svelte/Angular/HTML behavior

### Proposed HTMX workflow layer
Keep `ragPlugin` single-backend in core and add HTMX-specific workflow rendering on top of the same routes.

Normal requests:
- JSON responses

HTMX requests:
- rendered HTML fragments

Primary routes:
- `GET /rag/status`
- `POST /rag/search`
- `GET /rag/documents`
- `POST /rag/documents`
- `GET /rag/documents/:id/chunks`
- `DELETE /rag/documents/:id`
- `POST /rag/reseed`
- `POST /rag/reset`

Target HTMX workflow render config:
- `status`
- `searchResults`
- `searchResultItem`
- `documents`
- `documentItem`
- `chunkPreview`
- `evaluateResult`
- `mutationResult`
- `emptyState`
- `error`

This should live alongside the existing AI chat HTMX renderer pattern, but remain conceptually separate from streaming/chat renderers.

### Citation and source primitives
AbsoluteJS should make citations first-class.

### PDF ingest as a first-class requirement
PDF support is required for the product direction and should not remain a tentative follow-up.

Target PDF story:
- ingest by file path
- ingest by uploaded file
- extracted text with page-aware metadata
- page/source-aware chunking
- chunk preview with page traceability
- citations that can point back to file and page ranges
- the same workflow across all supported frontend modes
- backend-agnostic behavior through core ingestion primitives

Target primitives:
- `useRAGSources(...)`
- `buildCitationGroups(...)`
- `dedupeCitations(...)`
- helpers for excerpt extraction and source grouping

Optional UI primitives if they stay composable:
- `RAGResults`
- `RAGSources`
- `RAGIndexStatus`
- `RAGChunkPreview`
- `RAGCitationList`

### Shared event model
The protocol should explicitly model workflow stages:
- ingest started
- ingest progress
- ingest complete
- retrieval started
- retrieval hits available
- reranking complete
- answer streaming started
- citations attached
- completion

This is a much stronger product than hiding retrieval behind one final response blob.

## Core workflow features users will expect

### Ingestion
AbsoluteJS should support:
- raw text ingest
- markdown ingest
- HTML ingest
- file ingest
- directory ingest
- URL ingest
- upload-oriented ingest helpers
- later PDF ingest if justified

Ingestion should support:
- progress reporting
- replace/update/delete flows
- rebuild/reindex controls
- source metadata
- deterministic chunk id generation

### Chunking
AbsoluteJS should support:
- `source_aware`
- `paragraphs`
- `sentences`
- `fixed`

And it should evolve toward:
- heading-aware markdown chunking
- selector-aware HTML chunking
- per-source chunking overrides
- chunk overlap tuning
- chunk preview/debugging
- chunk quality validation helpers

### Retrieval
AbsoluteJS should support:
- `topK`
- score threshold
- metadata filters
- source filters
- document-id filters
- reranking hooks
- later hybrid retrieval only if justified

### Embeddings
AbsoluteJS still needs a cleaner embedding story.

Target direction:
- first-class embedding provider abstraction
- easy OpenAI embeddings
- easy local/custom embeddings
- provider-dimension validation
- explicit custom embedding function support

This is required for the feature area to feel complete.

### Streaming
AbsoluteJS should make retrieval-stage streaming visible and easy to render.

Target direction:
- `useRAGStream(...)`
- backend-agnostic retrieval event stream
- hooks/services for live stage updates
- easy rendering of:
  - retrieval started
  - chunks found
  - citations attached
  - answer generation in progress

This is likely the strongest unique product differentiator.

### Evaluation and operations
Serious users will want:
- diagnostics and capability reporting
- index health information
- migration and rebuild helpers
- benchmarking guidance
- evaluation helpers for retrieval quality
- persisted benchmark history
- run-to-run regression and improvement diffs
- docs on when to use sqlite vs PostgreSQL

Current status:
- first-class retrieval/reranker comparison primitives are implemented in core
- benchmark history persistence is implemented in core
- the example now renders persisted benchmark history and latest-vs-previous diffs on the existing quality panels

## Release phases

### Phase 1: Core workflow surface
Ship the smallest coherent workflow in core:
- stable RAG types and protocol
- collection/search/ingest abstractions
- retrieval-first server orchestration
- fallback store
- `useRAGSearch` / `useRAGStatus` parity

Acceptance criteria:
- one coherent workflow mental model across all frontend modes
- backend-agnostic search and status UX
- example proves retrieval clearly without relying on backend internals

### Phase 2: Full workflow primitives
Push the client surface to first-class parity:
- `useRAGIngest`
- `useRAGStream`
- source/citation helpers
- framework parity across React/Vue/Svelte/Angular
- HTML browser/client parity
- HTMX server-rendered workflow parity

Acceptance criteria:
- users no longer need to hand-roll fetch wrappers for normal RAG work
- ingestion, retrieval, and citations all have native-feeling frontend primitives

### Phase 3: Workflow-first example
The example should prove the product story:
- ingest docs
- inspect chunking
- retrieve with filters
- compare backends
- inspect citations and sources
- stream retrieval stages visibly

Acceptance criteria:
- the example leads with workflow
- backend diagnostics are secondary
- all six frontend modes prove the same workflow primitives

### Phase 4: Backend packages
Keep backend work supporting the workflow story:
- `absolute-rag-sqlite`
- `absolute-rag-postgresql`
- native sqlite packaging
- PostgreSQL implementation with `pgvector`
- fallback always supported

Acceptance criteria:
- users install one backend package
- core detects backend packages automatically
- no raw binary path setup in the normal path

### Phase 5: Production polish
After the workflow API is strong:
- embedding provider abstraction
- reranking hooks
- evaluation helpers
- operational docs
- upstream follow-up for Windows arm64 sqlite-native packaging

## Cleanup policy
This is a first-release feature area. No legacy framing should survive.

That means:
- do not lead with backend internals
- do not center sqlite as the product story
- do not expose temporary setup steps as the normal path
- keep diagnostics, but position them as secondary
- keep backend packages scoped and replaceable

## Current state

### Done
- Phase 1 is complete.
  - Core RAG has stable collection, search, ingest, status, document, chunk-preview, and index-admin primitives.
  - Core fallback behavior exists and the workflow is backend-agnostic.
- Phase 2 is largely complete.
  - React has a full first-class hook surface:
    - `useRAGSearch(...)`
    - `useRAGStatus(...)`
    - `useRAGIngest(...)`
    - `useRAGStream(...)`
    - `useRAGEvaluate(...)`
    - `useRAGSources(...)`
    - `useRAGCitations(...)`
    - `useRAGDocuments(...)`
    - `useRAGChunkPreview(...)`
    - `useRAGIndexAdmin(...)`
    - `useRAG(...)`
  - Vue has parity composables.
  - Svelte has parity stores/helpers.
  - Angular has parity through the RAG service surface.
  - HTML has first-class browser/client primitives.
  - HTMX has first-class server-rendered workflow support through `ragPlugin({ htmx: ... })`.
  - Evaluation helpers now exist across all workflow surfaces:
    - JSON route support through `POST /rag/evaluate`
    - React/Vue/Svelte helpers
    - Angular service method
    - HTML client method
    - HTMX evaluation fragment rendering
  - Citation and source presentation primitives are now stronger:
    - source summaries with excerpts and grouped citation numbers
    - citation reference maps for stable `[1]`, `[2]` style rendering
    - framework-native access through the existing RAG stream/source surfaces
- Phase 3 is mostly complete.
  - retrieval-stage streaming is now visible in the example across all six frontend modes.
  - evaluation helpers are now demonstrated in the example across all six frontend modes.
  - The example now proves the workflow across all six frontend modes.
  - The example supports:
    - sqlite native
    - sqlite fallback
    - PostgreSQL
    - file-backed seed corpus
    - source-aware chunking
    - chunk preview/debugging
    - benchmark-style retrieval evaluation
    - retrieval-stage streaming
    - backend comparison without raw workflow glue
  - The example benchmark flow now includes:
    - shared benchmark presets
    - expected/retrieved/missing source visibility
    - PostgreSQL parity coverage through `bun run dev:docker`
  - The example retrieval flow now highlights:
    - evidence source summaries instead of raw source-group dumps
    - citation trails across the framework demos
  - Diagnostics are secondary to the workflow and the example is routed per backend/framework page instead of using a runtime backend picker.
- Phase 4 is complete for first-release scope.
  - `@absolutejs/absolute-rag-sqlite` exists and is published.
  - sqlite-native packaging exists for supported targets.
  - `@absolutejs/absolute-rag-postgresql` exists and is published.
  - PostgreSQL + `pgvector` implementation, schema planning, migrations, and smoke coverage exist.
- Core HTMX workflow parity now includes the same document summary row as the framework pages.
- The example is now cleanly split between:
  - core single-backend workflow APIs
  - example-only backend comparison/navigation

### Still not done
- Phase 3 still has product-story polish left:
  - the example still leans on diagnostics more than ideal in the first visible viewport.
- Phase 5 is still largely open.
  - embedding provider abstraction is now in place
  - first-party embedding providers now exist for OpenAI, OpenAI-compatible APIs, Gemini, and Ollama
  - provider/dimension validation now exists at the collection layer
  - explicit custom embedding-function ergonomics now exist through `createRAGEmbeddingProvider(...)`
  - reranking hooks are now present in core through first-party provider-style reranker primitives
  - the example now demonstrates reranking across all six frontend modes
  - evaluation helpers are now present in core and demonstrated in the example, but docs are still missing
  - operational docs are not present
- Ingestion source expansion is still incomplete.
  - PDF ingest is not finished
- Chunking still has forward-looking work left.
  - selector-aware HTML chunking is not finished
  - per-source chunking overrides are not finished
  - chunk quality validation helpers are not finished
- Windows arm64 sqlite-native packaging remains an upstream `sqlite-vec` gap.

## Immediate next steps
1. Run and enforce smoke parity for active modes and all framework surfaces (engineering-only).  
  - execute `bun run rag:smoke` in `absolutejs-rag-vector-example` before every release cut.
  - this smoke suite is an internal parity gate for us to keep the endpoint/framework matrix stable.
  - this is now green for route/framework coverage for sqlite-native + sqlite-fallback in current example build.
  - end state: migrate this check surface into the UX workflow so users validate by operating the demo UI itself (uploads/retrieval/evaluation/streaming), then clean up/replace this smoke check.
  - treat any regression in page routes, core JSON routes, or quality route payloads as a blocking release item.
2. Expand ingest source depth only once parity is green.
  - strengthen local/remote sync reconciliation and delete-delta behavior
  - continue PDF and archive edge-case validation
  - improve multi-source evidence integrity in operations surfaces
3. Keep workflow-first presentation in the example as the default visual posture.
  - keep citations, grounding evidence, and stream observability in the primary viewport
  - keep diagnostics and ops panels visible but secondary
4. Continue grounding quality platform work:
  - case-level inspection surfaces
  - explicit difficulty trend + regression diagnostics
  - artifact snapshot diff tooling
5. Keep backend package work in maintenance mode unless a concrete issue appears.
   - keep sqlite/postgresql healthy
   - track Windows arm64 sqlite-native upstream status
   - do not add new backends unless there is a real product reason
