# RAG + Vector Roadmap

## Objective
Make AbsoluteJS the default full-stack framework for RAG and vector-driven products.

That means a serious team should be able to build, tune, operate, and govern a production RAG system inside AbsoluteJS without immediately replacing ingestion, retrieval, evaluation, or operations.

## Current Position
AbsoluteJS is no longer in the "interesting demo" stage.

Core is now strong in:
- backend-agnostic RAG workflow primitives
- retrieval, reranking, citations, streaming, and evaluation
- retrieval diagnostics, trace presentation, and query attribution
- structured retrieval diagnostics for lead location, chunk-boundary reasons, source-aware scope, routing shifts, and media cues
- structure-aware retrieval scoring and aggregation for PDF, Office, and section-local evidence
- first-class retrieval routing and query-transform hooks
- first-class extractor and chunker registries
- durable file-backed job and sync state recovery
- first-class sync reconciliation summaries for stale documents, targeted refreshes, and noop runs
- SQLite-backed retrieval governance, incidents, remediations, handoffs, and policy history stores
- authorization and scoped access-control seams
- first-class `corpusKey` and `corpusGroupKey` support across major governance surfaces
- release control, incidents, remediations, handoffs, and comparison governance
- framework parity across React, Vue, Svelte, Angular, HTML, and HTMX
- example coverage for release-control and corpus/workspace-scoped governance
- package-level public surfaces for `@absolutejs/absolute/ai`, `@absolutejs/absolute/ai/rag/quality`, and `@absolutejs/absolute/ai/rag/ui`

The main bottleneck is no longer release-control depth.

The main remaining question is:
- can a serious team trust AbsoluteJS to ingest hard real-world content, chunk it well, retrieve it well, evaluate it rigorously, and run it safely in production at larger scale?
- and, more importantly, does the product surface now compete with the strongest Python and vector-native ecosystems rather than only other JS frameworks?

## Competitive Reality Check
The current comparison set is not generic "RAG libraries". It is the strongest current public capability surface across:
- LangChain retrieval and RAG workflows
- LangSmith RAG evaluation workflows
- Haystack retrieval and evaluation components
- LlamaIndex ingestion/connectors and document workflows
- Weaviate hybrid search and vector-database operations
- Qdrant hybrid/multi-stage search and reranking
- Milvus filtered and multi-vector search

This matters because the remaining roadmap should be driven by real competitive gaps, not internal optimism.

Cross-library parity status (quick sanity check):
- **Connector breadth**: 42% parity (`partial`)
- **Vector/runtime depth**: 61% parity (`partial`)
- **Query planning/filtering**: 63% parity (`partial`)
- **Evaluation/product tooling**: 48% parity (`partial`)
- **Framework UX and integrations**: 78% parity (`strong`)
- **Document understanding/OCR**: 55% parity (`partial`)

### Competitive win condition
AbsoluteJS does not need to win by having the most connectors.

That is not realistic against LangChain or LlamaIndex in the near term, and chasing that scoreboard first would produce a broader but weaker product.

AbsoluteJS wins if it becomes the best integrated production RAG stack across:
- retrieval quality and runtime behavior
- evaluation, release, and governance operations
- extraction quality on hard real-world content
- full-stack operator and product ergonomics

Connector breadth still matters, but as selective high-value coverage:
- enough first-party connectors that serious teams do not immediately churn to another stack
- reference kits that make the missing long tail cheaper to implement than in competing ecosystems

Leadership rule:
- do not optimize for raw connector count first
- optimize for being hardest to replace once a team starts shipping

### Competitive baseline (JS + Python)
This is an internal feature-audit baseline, not a benchmark leaderboard. It scores whether core, persistence, and operations primitives are present or production-ready in practice.

Reference set:
- JS: LangChain, LangSmith, Haystack, LlamaIndex, Weaviate, Qdrant, Milvus
- Python: LangChain, LangSmith, Haystack, LlamaIndex

Comparative signal:
- **Leading JS+Python stacks** have strong connector ecosystems, broad vector backend depth, and opinionated experiment workflows.
- **AbsoluteJS is strongest where it is now** in retrieval choreography, routing observability, framework parity, and governance persistence.
- **The gap is concentrated** in ecosystem breadth, vector runtime depth at cluster scale, and evaluation product ergonomics.

### Competitive Leadership Scorecard
The percentages below are feature-audit estimates against the strongest public JS/Python stacks listed above.

- **Overall parity**: **58%**
- **Category-leading readiness threshold**: **82%**
- **Current gap to target**: **24 percentage points**

Category scores:
- **Connector breadth**: **42%**
  - Strong: file/sync/http baseline coverage and stable sync surfaces
  - Missing: LangChain/LlamaIndex-level connector ecosystem breadth
- **Vector/runtime depth**: **61%**
  - Strong: SQLite and Postgres operational paths now include parity-critical delete/count APIs in core stores
  - Strong: improved runtime surface alignment for lifecycle operations (query, upsert, count, delete)
  - Missing: vector-native depth from Weaviate/Qdrant/Milvus on planner depth and cluster-scale operations
- **Query planning/filtering**: **63%**
  - Strong: planner visibility and routing hooks now present
  - Missing: global planner/operator breadth and optimizer behaviors across all backends
- **Evaluation/product tooling**: **48%**
  - Strong: suite/run/history/evidence primitives shipped
  - Missing: production-grade experiment lifecycle, dataset ops, and triage workflows
- **Framework UX and integrations**: **78%**
  - Strong: robust parity across major JS frameworks and presentation surfaces
  - Missing: more mature polyglot deployment/operator tooling
- **Document understanding/OCR**: **55%**
  - Strong: first-pass structure-aware extraction for major formats and media
  - Missing: high-end scanned-document/OCR, region traceability, and confidence tuning

As of now:
- AbsoluteJS is already unusually strong for a JS-first stack
- AbsoluteJS is competitive on workflow cohesion, diagnostics, governance, and framework parity
- AbsoluteJS is not yet the leader across JS and Python overall

The largest remaining deltas are:
1. vector-store and large-corpus operational depth
2. evaluation workflow productization and experiment ergonomics
3. OCR/document-understanding depth beyond the current first-pass foundation
4. selective connector and parser ecosystem breadth

Implication:
- the next roadmap should bias toward those deltas first
- more demo polish or local diagnostic depth should not outrank them

### Competitive proof standard
The roadmap should be judged by competitive proof, not only by feature-audit parity.

AbsoluteJS is plausibly category-leading only when it can demonstrate all of these against designated benchmark suites and demo workloads:
- retrieval quality holds or improves on exact-phrase, hybrid, multivector, filter-heavy, and source-structure-sensitive cases
- vector backends behave credibly on larger corpora with inspectable planner, latency, filter, and maintenance behavior
- evaluation and release-control surfaces let operators detect, explain, and gate regressions faster than generic library workflows
- extraction quality remains usable on PDFs, Office docs, spreadsheets, transcripts, archives, email, and scanned/OCR-heavy documents without immediate custom replacement

This means every major roadmap branch should eventually produce:
- benchmark cases
- release-gate criteria
- operator-visible diagnostics
- example flows that prove the behavior end to end

## What Has Landed
These are no longer roadmap ideas. They are now part of the current foundation.

### Retrieval depth and routing foundation: shipped
Shipped or materially in place:
- query rewrite/expansion hooks
- per-query retrieval strategy selection
- built-in heuristic routing helpers
- routing and transform provenance in traces and diagnostics
- query-attribution diagnostics
- score-ownership diagnostics
- section survivorship diagnostics
- explicit comparison/history summaries for lead drift, routing shift, chunk-boundary reasons, and source-aware scope
- media-aware reranking for speaker, channel, and continuity-sensitive queries
- quoted speaker/channel attribution cues in reranking and trace presentation

Implication:
- retrieval is no longer the weakest Tier 1 area
- the next retrieval work should be selective and high leverage, not generic plumbing
- the remaining retrieval gaps are more about deeper corpus-specific behavior and evaluation explanation than missing baseline controls

### Extractor and chunker extensibility foundation: shipped
Shipped or materially in place:
- first-class extractor registries
- first-class chunking registries
- registry fallback chains
- registry-aware sync propagation
- registry match provenance in metadata and debug presentation
- registry usage visibility in ops inspection
- conformance-style regression coverage around extractor/chunker selection

Implication:
- the extension story is now credible
- the bigger remaining ingestion gap is extraction quality and chunking quality, not extension hooks

### Extraction and structure quality foundation: materially shipped for the first wave
Shipped or materially in place:
- PDF native block extraction
- repeated PDF chrome suppression
- PDF block-aware source-aware chunking
- stronger HTML main-content extraction and boilerplate removal
- DOCX native office block extraction
- DOCX block-aware source-aware chunking
- first-pass XLSX row/header-aware sheet metadata and row-range chunk metadata
- repeated-header detection and multi-table-aware spreadsheet chunking
- real worksheet row-number preservation for XLSX extraction
- blank-gap table restart detection for changed-span, same-span, sparse-header, and shifted sparse-header cases
- spreadsheet row/header alignment by actual column reference instead of XML order
- spreadsheet table-local presentation and reranking cues
- first-pass PPTX slide title/body/notes metadata and title-aware chunking
- PPTX slide-aware aggregation and diagnostics
- email thread/reply lineage metadata
- archive parent/child lineage metadata
- deeper email thread-chain metadata and attachment locality cues
- attached/forwarded email ancestry metadata for nested `message/rfc822` paths
- authored vs quoted vs forwarded-header segmentation for email message bodies
- HTML-aware email body segmentation that preserves authored text, quoted-history depth, and forwarded-header structure without relying on plain-text fallbacks
- first-class forwarded-header identity metadata on email message docs (sender, recipients, subject, date/timestamp, field map), not only section-level chunk metadata
- multi-forwarded-chain segmentation for emails with more than one forwarded-header block, including ordinal-aware message metadata and chunk metadata
- `n`-depth attached-email ancestry lineage metadata for nested `message/rfc822` chains, without hardcoded level-specific fields
- normalized recipient and participant address metadata across `from/to/cc/bcc/reply-to`
- real fixture-backed mailbox chains combining quoted history, forwarded headers, attached `.eml`, and nested archive descendants
- real fixture-backed HTML-heavy mailbox thread chains combining cross-file reply reconstruction, inline resources, attached `.eml`, forwarded headers, and nested archive descendants
- real fixture-backed HTML-heavy mailbox chains with multiple attached `.eml` sibling branches in one container thread
- real fixture-backed HTML-heavy mailbox chains with multi-forwarded attached `.eml` sibling branches in one container thread
- directory-ingest coverage for sibling attached-email chains where separate `.eml` branches each preserve their own nested attached-message lineage
- nested archive lineage metadata and nested-archive locality cues
- real fixture-backed multi-message email thread reconstruction across `.eml` directories
- retrieval preference for authored email text over quoted history over forwarded-header chains, with query-aware fallback to quoted or forwarded evidence when explicitly requested
- branch-local email reranking cues that use attached-message lineage source paths so authored vs forwarded evidence stays stable under sibling branch collisions
- mailbox directory coverage for sibling attached-email branches where each branch independently preserves inline resources, forwarded-header chains, nested archive descendants, and nested attached-message lineage
- branch-local email reranking across authored, quoted, and forwarded sibling evidence families under the same mailbox query space
- native `.mbox` mailbox-container extraction that fans out one mailbox file into message documents while preserving mailbox-local message index/count metadata and thread reconstruction across emitted messages
- first-pass `pst/ost` mailbox-container extraction that heuristically fans out message-like content into message documents while preserving mailbox-local message index/count metadata and thread reconstruction across emitted messages
- first-pass `pst/ost` mailbox-container folder lineage and state semantics (`family key`, `path segments`, `leaf`, `flagged/read/draft/passed/...`) on emitted messages, reusing the generic mailbox metadata model instead of a container-specific special case
- recoverable `pst/ost` attachment payloads now route back through the shared AbsoluteJS ingestors, so nested archives and attached `.eml` messages emitted from mailbox containers reuse the same deep extraction path as ordinary email attachments
- recoverable `pst/ost` attachment blocks now scale to arbitrary repeated attachments and preserve inline-resource matching plus mailbox-local metadata on emitted attachment documents, instead of stopping at attachment descriptors
- repeated recoverable attachment families across multiple `pst/ost` mailbox messages now preserve mailbox-message scope, descendant mailbox lineage/state, and branch-local retrieval cues instead of collapsing same-named attachment families together
- generated `n`-style coverage now pins arbitrary repeated recovered descendant families across multiple mailbox messages, including mailbox-family/state-aware retrieval on those descendants rather than only on root mailbox messages
- generated `n`-style mailbox coverage now also pins repeated recovered attached-message descendant trees across multiple mailbox messages and descendant families, including nested archive descendants under those attached-message branches
- mailbox-family/state-aware retrieval pressure now covers attached-message descendants directly, not only archive descendants recovered from mailbox containers
- generated `n`-style mailbox coverage now also pins arbitrary nested attached-message depth within repeated recovered mailbox descendant families, so deeper attached-message ancestry is tested without hardcoded child/grandchild ladders
- generated `n`-style mailbox coverage now also pins arbitrary sibling branch width inside repeated recovered mailbox descendant families, so branch-local attached-message ancestry is tested across both depth and sibling fanout without hardcoded branch ladders
- generated `n`-style mailbox coverage now also pins mailbox-state drift and reply-sibling ordinal collisions on recovered attached-message descendants, so first/second/latest reply resolution is exercised inside recovered mailbox branches rather than only on root mailbox messages
- generated `n`-style mailbox coverage now also pins forwarded-chain plus reply-sibling collisions on recovered attached-message descendants, so authored-vs-forwarded selection is exercised inside branch-local first/second/latest recovered reply families
- generated `n`-style mailbox coverage now also pins replicated recovered descendant family names across mailbox branches, so mailbox-family/state routing is exercised even when descendant attachment names and archive paths are identical
- generated `n`-style mailbox coverage now also pins replicated recovered descendant family names across multiple mailbox containers, so container-local routing is exercised even when descendant attachment names, archive paths, and mailbox family names are identical
- generated `n`-style mailbox coverage now also pins replicated descendant family names across arbitrary mailbox container formats (`pst` / `ost` / `mbox` / `emlx` / `maildir`), so mixed-format container routing is exercised even when descendant names and mailbox-family paths are intentionally identical
- generated `n`-style mailbox coverage now also pins mixed-format shared thread collisions across arbitrary mailbox container formats, so graph-based loaded-thread reconstruction and format-aware authored-vs-forwarded retrieval are exercised even when thread topic and mailbox-family paths are intentionally identical
- generated `n`-style mailbox coverage now also pins mixed-format sibling-reply ordinal collisions across arbitrary mailbox container formats, so first/second/third/final reply routing stays correct even when thread topic, mailbox-family path, and section family are intentionally identical
- mailbox-container parsing now also synthesizes sender/recipient/date-style email headers from richer `pst/ost` decorator fields before shared email extraction, so sparse Outlook dumps can still reuse the full AbsoluteJS email pipeline instead of degrading into mailbox-only metadata
- mailbox-container parsing now also preserves richer Outlook-style identity/timestamp fields (`internet-message-id`, `client-submit-time`, `delivery-time`, `creation-time`, `last-modified-time`) and uses them to synthesize core message identity/date metadata before shared email extraction
- mailbox-container parsing now also synthesizes reply-chain headers from Outlook-style decorator fields (`parent-message-id`, `reference-chain`), so sparse `pst/ost` dumps can recover `In-Reply-To` / `References` instead of relying on subject-only grouping
- mailbox reranking now also scores Outlook-style `message class` and `conversation index` metadata directly, so sparse `pst/ost` fallback extraction can still route queries by container-specific semantics instead of only by generic thread/mailbox cues
- sparse Outlook-style mailbox containers continue preserving `conversation-index` through shared email extraction and reranking, so Outlook thread-identity cues are no longer trapped in mailbox-only fallback fields
- sparse Outlook-style mailbox containers now also preserve `thread-index` through shared email extraction and reranking, so Outlook-specific thread index cues can route mailbox queries instead of staying dead fallback metadata
- sparse Outlook-style mailbox containers now also route recovered reply-parent identity through shared reranking (`In-Reply-To` / root-message queries), so parent/root mailbox lookups can use container-recovered reply lineage instead of only generic topic/class/timestamp cues
- sparse Outlook-style mailbox containers now also route recovered thread-root identity through shared reranking (`threadRootMessageId` / root-message queries), so root-thread mailbox lookups can use recovered root lineage instead of only generic topic/class/timestamp cues
- mailbox reranking now also scores Outlook-style timestamp cues (`sent`, `received/delivered`, `created`, `modified`) directly from sparse `pst/ost` fallback metadata, so mailbox-container queries can route on recovered timing semantics instead of only on topic/state/class cues
- mailbox reranking now also scores Outlook-style `internet-message-id` metadata directly from sparse `pst/ost` fallback extraction, so message-id-oriented mailbox queries can route on recovered container identity instead of only on topic/state/class/timestamp cues
- generated `n`-style mixed-format mailbox coverage now also pins multiple nested child families under deep sibling replies across arbitrary mailbox container formats, so branch-local routing is exercised simultaneously across format, branch, nested reply ordinal, deep child family, and authored-vs-forwarded section choice
- generated `n`-style mixed-format mailbox coverage now also pins multi-forwarded-chain deep child families under deep sibling replies across arbitrary mailbox container formats, so forwarded-chain-aware routing is exercised at the deepest branch-local attached-message layer rather than only at shallower reply branches
- generated `n`-style mixed-format mailbox coverage now also pins inline-resource collisions inside those deep child families, so the deepest branch-local email path exercises authored text, multi-forwarded headers, inline `cid:` resources, and nested archive descendants together across arbitrary mailbox container formats
- generated `n`-style mixed-format mailbox coverage now also pins multiple inline-resource families inside those same deep child branches, so explicit first/second inline `cid` routing is exercised without hardcoded attachment ladders and without collapsing sibling inline resources back to ingest order
- generated `n`-style mixed-format mailbox coverage now also pins quoted-history collisions inside those same deep child branches, so the deepest branch-local email path now exercises authored text, quoted history, multi-forwarded headers, inline `cid:` resources, and nested archive descendants together across arbitrary mailbox container formats
- generated `n`-style mixed-format mailbox coverage now also pins quoted-history routing at the same deep child-family branch as authored, forwarded, and inline evidence, so deep branch-local reply retrieval can distinguish current text vs quoted prior thread history instead of collapsing both into one deep child bucket
- mailbox reranking now also prefers deeper quoted-history evidence when the query explicitly asks for older/deeper prior thread context, so quoted-depth drift can be used as a retrieval cue instead of only being preserved as passive metadata
- generated `n`-style mixed-format mailbox coverage now also pins multiple quoted-history families inside those same deep child branches, so recent vs older quoted history stays distinct under the same branch-local authored/forwarded/inline collision instead of remaining one flat quoted bucket
- mailbox reranking now also scores thread-chain ancestry from `replyDepth` and `threadMessageIds`, so older ancestor/lineage mailbox queries can favor richer recovered chain evidence instead of treating root-thread identity as the only thread-local routing cue
- mailbox reranking now also scores `emailReplySiblingParentMessageId` directly, so deep attached-message sibling branches can route on recovered parent identity instead of only on shallower `In-Reply-To` / root-thread cues
- generated `n`-style mixed-format mailbox coverage now also pins reply-parent and root-thread drift across sibling deep child branches, so the deepest branch-local email path can be selected by parent/root lineage metadata even when the content family collisions are otherwise identical
- mailbox reranking now also scores `references` and `replyReferenceCount`, so mailbox queries can route on recovered reference-chain identity instead of only on root/parent lineage cues
- mailbox reranking now groups mailbox descriptor cues (`categories`, `importance`, `sensitivity`) through shared feature-family scoring instead of adding more one-off mailbox-field boosts, so mailbox metadata routing keeps moving toward reusable identity/locality/state/ancestry families
- shared recoverable-`pst` mailbox test helpers now build root mailbox envelopes and attachment blocks from parameterized message specs instead of hand-assembling repeated `Folder/Flags/Attachment/...` ladders across each PST-heavy regression, so deeper mailbox coverage can keep scaling by branch/depth/state parameters rather than local test scaffolding
- generated `n`-style mixed-format mailbox coverage now also pins reference-chain drift across sibling deep child branches, so the deepest branch-local email path can be selected by metadata-only reference ancestry even when child text and section-family collisions are otherwise identical
- mailbox reranking now also scores raw `messageId` alongside Outlook-style `emailInternetMessageId`, so message-id-oriented mailbox queries can route on recoverable message identity across normal email and sparse Outlook fallback paths
- generated `n`-style mixed-format mailbox coverage now also pins message-id drift across sibling deep child branches, so the deepest branch-local email path can be selected by metadata-only message identity even when text, parent/root lineage, and section-family collisions are otherwise identical
- generated `n`-style mixed-format mailbox coverage now also pins conversation-index and thread-index drift across sibling deep child branches, so the deepest branch-local email path can be selected by Outlook-style thread identity cues even when text, message identity, parent/root lineage, and section-family collisions are otherwise identical
- generated `n`-style mixed-format mailbox coverage now also pins mailbox-state-aware selection on non-authored deep child families, so forwarded-header, quoted-history, and inline-resource routing stay correct even when state cues and deep branch identity cues collide at the same mixed-format branch
- sparse Outlook-style mailbox fallback now preserves `conversation-id` through the shared email extraction path and uses it for message metadata, thread-key fallback, and mailbox-aware reranking instead of leaving it trapped as container-only metadata
- generated `n`-style mixed-format mailbox coverage now also pins per-branch mailbox-state drift at the deepest child-family branch, so non-authored families are selected by branch-local state cues instead of only by format-level mailbox state
- generated `n`-style mixed-format mailbox coverage now also pins mailbox leaf/path drift together with branch-local state cues on forwarded, quoted, and inline deep-child families, so mailbox-family locality remains decisive even when non-authored family collisions are already maximally ugly
- sparse Outlook-style mailbox fallback now preserves `normalized-subject` through the shared email extraction path and uses it for subject/thread-topic fallback plus mailbox-aware reranking instead of leaving subject recovery dependent on fully reconstructed message headers
- generated `n`-style mixed-format mailbox coverage now also varies mailbox path depth across sibling deep-child branches, so branch-local non-authored family routing is pinned against both mailbox-state drift and deeper path-segment locality instead of only a leaf-token collision
- mailbox reranking now scores mailbox locality and mailbox identity as reusable feature families instead of only field-by-field mailbox cue branches, so new mailbox identity signals can slot into grouped matching logic without another bespoke score block
- mailbox reranking now also routes mailbox format/provider boosts and ordinal preferences through reusable helpers instead of separate mailbox/attachment/reply ladders, so mailbox scoring is increasingly driven by grouped feature families plus query intent rather than repeated ordinal plumbing
- mailbox reranking now groups thread-root, parent, reference-chain, and lineage-depth routing under a mailbox ancestry family plus bounded depth/count scoring, so thread ancestry behavior no longer grows by one mailbox branch at a time
- the deepest mixed-format mailbox retrieval regression now builds deep-child branch metadata from a shared context generator instead of repeating literal mailbox metadata walls per section family, so adding more branch axes stays data-driven instead of expanding another copy-paste ladder
- mixed-format mailbox adversary specs and source builders now live in one shared test helper used by both ingestion and retrieval coverage, so the deepest mailbox tree is pinned from a single `n`-shaped source of truth instead of two drifting local test definitions
- earlier mixed-format mailbox retrieval regressions now also consume the shared mailbox adversary model, so the full mixed-format mailbox stack from container collisions up through deep child-family collisions is driven by one shared format/path/state source instead of isolated local scaffolds
- recoverable PST retrieval coverage now also consumes shared mailbox-case/state/path builders, so the non-mixed mailbox branch is converging on the same `n`-style helper model as the mixed-format stack instead of re-declaring mailbox metadata per test
- generated `n`-style mixed-format mailbox ingestion coverage now also pins deep-child `messageId`, `references`, `replyReferenceCount`, and `threadIndex` metadata on loaded attached-message descendants and their inline/archive children, so the deepest mixed-format mailbox tree preserves the same identity cues end to end instead of only using them in reranking tests
- generated `n`-style mailbox coverage now also pins mixed-format forwarded-chain sibling-reply collisions across arbitrary mailbox container formats, so forwarded-chain routing stays correct under the same mixed-format sibling thread space
- generated `n`-style mailbox coverage now also pins mixed-format attached-message descendant sibling collisions across arbitrary mailbox container formats, so attached child replies and their nested archive descendants keep the right format, ordinal, and section-local routing under one shared thread
- generated `n`-style mailbox coverage now also pins mixed-format attached-message child branch fanout across arbitrary mailbox container formats, so multiple attached child branches per format stay distinct by branch, ordinal, and section family under one shared mixed-format thread
- generated `n`-style mailbox coverage now also pins mixed-format nested attached-message depth under each child branch across arbitrary mailbox container formats, so format, branch, and deepest-lineage routing are exercised together instead of only at one attached-child level
- generated `n`-style mailbox coverage now also pins nested attached-message sibling-reply ordinals under mixed-format child branches, so first/second reply routing is exercised at deep lineage depth across `pst` / `ost` / `mbox` / `emlx` / `maildir`
- generated `n`-style mailbox coverage now also pins mailbox-state drift on those deep mixed-format nested sibling replies, so unread/flagged routing is exercised at the deepest attached lineage instead of only on root mailbox messages
- native Maildir directory support for extensionless `cur/` and `new/` message files, including normalized folder/key/flag metadata and thread reconstruction across loaded maildir messages
- native `.emlx` Apple Mail export support that strips trailing plist metadata and routes the message through the same deep email extraction path
- mailbox-local email reranking cues that use mailbox container and folder metadata alongside attachment lineage for branch and folder disambiguation
- rich Maildir family coverage where sibling mailbox folders preserve inline resources, forwarded-header chains, nested archive descendants, and attached-message lineage under the same thread space
- mailbox-family-aware retrieval preference across authored and forwarded email evidence when Maildir folders collide on the same thread topic
- `n`-depth Maildir mailbox lineage metadata (`path segments`, `depth`, `leaf`, `family key`) so nested mailbox-family retrieval does not depend on hardcoded folder levels
- normalized Maildir mailbox-state semantics (`unread/read/flagged/replied/draft/trashed/passed`) exposed as first-class ingest metadata instead of raw flag strings alone
- multi-reply sibling ordering metadata for loaded email threads (`count/index/ordinal/parent/source set`) so reply branches are modeled as an ordered family instead of one flat reply bucket
- mailbox-state-aware email reranking so unread/flagged/draft/replied/passed mailbox queries can resolve the right local message without relying on generic text overlap
- sibling-reply-aware email reranking so ordinal queries like first/second/latest reply can resolve inside one mailbox family without hardcoded depth or branch ladders
- retrieval-facing presentation for PDF, Office, spreadsheet, presentation, email, and archive structure cues
- structure-aware retrieval scoring for spreadsheet, presentation, email, and archive metadata
- richer fixture coverage for PDF, HTML, DOCX, spreadsheet, presentation, archive, and email
- source-native media transcript chunking with channel- and speaker-aware grouping
- grouped media provenance labels and reranking signals for segment windows
- speaker alias normalization across case, whitespace, punctuation, and separator drift
- channel alias normalization including center/centre/middle -> `mono`
- media grouping continuity repair for short unknown-speaker/channel gaps without over-bridging long ambiguous runs
- bidirectional media continuity metadata (`mediaSegmentGapFromPreviousMs` and `mediaSegmentGapToNextMs`)

Implication:
- PDF, HTML, DOCX, XLSX, PPTX, email, and archive now have a credible first-pass extraction-to-retrieval story
- archive/email relationship depth is no longer the top missing extraction branch
- the next extraction branch should focus on OCR depth and the spreadsheet/media cases that still need stronger semantic reconstruction

### Corpus operations and sync foundation: materially shipped for the first wave
Shipped or materially in place:
- file-backed sync state recovery and interrupted-run recovery
- deletion reconciliation for managed sync documents
- first-class stale-document detection during managed source reconciliation
- targeted-refresh summaries with refreshed, stale, and unchanged sync keys
- noop reconciliation summaries for unchanged source runs
- sync-managed document version lineage with stable lineage ids, predecessor linkage, and monotonic version numbers
- duplicate sync-key visibility and lineage conflict detection in managed source reconciliation
- conservative conflict resolution helpers for safe single-latest duplicate cleanup
- deterministic highest-version conflict cleanup for resolvable multi-latest cases
- resumable paged storage/email sync with persisted cursors and deletion-safe partial runs
- consistent reconciliation state persisted on sync source records instead of only ad hoc source metadata
- derived sync diagnostics with source-specific resume warnings, conflict visibility, targeted/noop reconciliation cues, and primary retry guidance
- per-item sync extraction failure analytics with source-type attribution and remediation hints for skipped files, URLs, storage objects, and email attachments
- first-pass extraction recovery previews that group skipped items into concrete OCR/extractor/inspection recovery actions
- first-pass extraction recovery orchestration that runs grouped OCR/extractor/inspection actions through explicit recovery handlers

Implication:
- sync is no longer just fire-and-forget ingestion
- higher-level ops surfaces can consume durable reconciliation, lineage, conflict, retry, and extraction-remediation semantics without re-diffing documents
- the remaining sync gap is more about deeper end-to-end recovery automation, higher-end source coordination, and stronger delta/extraction-depth behavior than baseline stale/refresh detection

### Governance and operations persistence foundation: materially shipped
Shipped or materially in place:
- SQLite stores for search traces, comparison history, baselines, release decisions, release incidents, handoff decisions, handoff incidents, handoff incident history, remediation decisions, remediation execution history, and policy history
- migration-safe SQLite column backfill for evolved governance schemas
- shared SQLite migration inspection/apply helpers for the currently evolved governance store schemas
- SQLite governance store bundle helper for runtime wiring
- example-server wiring to the real SQLite governance bundle instead of ad hoc in-memory state
- persisted governance admin/status surfaces with HTMX mutation controls and fragment refresh
- restart-persistence and browser-level mutation smoke coverage for the example governance path

Implication:
- governance persistence is no longer a roadmap-only promise
- the remaining operations gap is less about basic storage and more about broader production backends, scaling, and operational analytics

### Example and package parity foundation: materially shipped
Shipped or materially in place:
- one-page-per-framework parity across the main RAG example surfaces
- shared formatter-driven parity updates for lead evidence, routing, and media cue diagnostics
- package-wired beta examples validating the public AI, quality, and UI subpaths
- public-surface coverage proving the new diagnostics can be consumed without source-level imports

Implication:
- the example story is no longer the weak point
- future example work should stay constrained to parity updates on existing pages, not route proliferation

### Production durability baseline: shipped
Shipped or materially in place:
- file-backed job state store
- persisted ingest/admin/sync job history
- persisted admin action history
- crash recovery for interrupted running jobs
- crash recovery for interrupted sync runtime state
- bounded retention for persisted histories
- corruption-tolerant file-store recovery tests

Implication:
- durability is much stronger than before
- the remaining production gap is not "do we persist anything?"
- the remaining gap is richer persistence backends, migrations, and larger-scale operations

### Access control and scope foundation: shipped
Shipped or materially in place:
- `authorizeRAGAction(...)`
- `resolveRAGAccessScope(...)`
- composed access bridge via `createRAGAccessControl(...)`
- route-level authorization for mutating RAG and retrieval-governance paths
- scoped reads and mutations for documents, search, sync, evaluation, and comparison surfaces
- first-class `corpusKey` visibility
- first-class `corpusGroupKey` across the major retrieval governance surfaces
- scoped release-incident synchronization for ops status (incident summaries and recent incident lists now respect allowed comparison groups)

Implication:
- the platform now has a real auth/access seam
- the remaining work is deeper consistency, not inventing the model

## What Is Still Missing
The remaining roadmap is best understood in three tiers:
- must-have before calling AbsoluteJS the default choice
- strong differentiators that make the product obviously better
- later depth work

## Tier 1: Must-have

### 1. Vector-store and large-corpus operational depth
This is the biggest remaining gap versus vector-native systems.

Why it matters:
- Weaviate, Qdrant, and Milvus win on search infrastructure depth, not just API aesthetics
- leadership requires more than "has a vector adapter"
- larger corpora expose planning, filtering, recall, latency, and operational weaknesses quickly

Must-have work:
- stronger Postgres vector-store depth beyond the newly landed core adapter and first-pass pushdown
- richer prefilter/query planning across backends, not just SQLite-first planner observability
- larger-corpus candidate management and backfill strategy controls
- broader metadata pushdown depth where safe
- stronger backend status and planning introspection across all real backends
- corpus-scale operational ergonomics
  - index health
  - storage pressure
  - tenant/corpus isolation
  - retention and cleanup on durable backends

Target outcome:
- AbsoluteJS feels credible not only as a workflow framework, but as a serious retrieval runtime over larger corpora

### 2. Evaluation and experiment productization
This is the biggest remaining gap versus LangSmith and Haystack.

Why it matters:
- evaluation is no longer missing in AbsoluteJS
- the gap is now workflow and product feel
- serious teams need repeatable experiment operations, not just raw helpers

Must-have work:
- experiment management beyond current suite/run/history primitives
- more operable comparison workflows across retrieval, reranking, prompting, and backend variants
- clearer benchmark inspection and triage flows
- more dataset lifecycle ergonomics
  - curation
  - promotion
  - review
  - drift inspection
- stronger integration between failure classes, entity rollups, and release decisions

Target outcome:
- evaluation in AbsoluteJS becomes something teams adopt as a working system, not just a capability surface

### 3. Extraction quality and document understanding
This remains high leverage, but it is no longer the only top priority.

Why it matters:
- weak extraction still poisons downstream stages
- extractor registries do not help if the default extractors are not good enough
- this is still where many production RAG systems quietly fail

Must-have work:
- deeper Office extraction
  - XLSX sheet/table/cell extraction with still stronger merged-cell, formula/value, and sparse-layout semantics
  - stronger column-range and table-shape detection within sheets where semantic inference is still weak
  - stronger slide body/notes segmentation only if first-pass slide-aware retrieval proves insufficient
- stronger OCR-backed extraction
  - scanned PDFs and images
  - confidence metadata
  - region/page traceability
- better archive and email relationship modeling
  - embedded-resource linkage
  - richer attachment linkage where message-locality still matters
  - stronger cross-message relationship modeling when simple thread chains are not enough
- better media extraction
  - transcript segmentation with timestamps under messier real-world ASR output
  - speaker/channel metadata where available
  - grouped transcript windows by consecutive speaker/channel now in place
  - richer timestamp/locality cues for grounding and answer-time navigation

Target outcome:
- extracted output is useful for RAG before custom app logic touches it

### 4. Connector and ingestion ecosystem breadth
This is still important, but it should not be mistaken for the main victory condition.

Why it matters:
- LlamaIndex and LangChain still win by sheer breadth of loaders, readers, and source adapters
- teams often choose a platform because their data source is already supported
- extension hooks are good, but a category leader also needs more first-party source coverage
- the right goal is high-value coverage plus strong connector kits, not a connector-count race

Must-have work:
- first-party connectors beyond the current local/source/sync baseline
  - docs/wiki platforms
  - SaaS knowledge systems
  - team communication systems
  - cloud storage/workspace sources
- stronger website ingestion breadth
  - current feed/sitemap/site-discovery work is good, but broader crawling/import ergonomics still lag
- parser breadth for common structured operational formats where coverage is still thin
- reference connector kits so teams can implement new sources without reverse-engineering core

Target outcome:
- serious teams do not immediately reach for LangChain/LlamaIndex solely because their source systems are missing
- teams can fill long-tail gaps without treating AbsoluteJS as hostile to extension

### 5. Smarter chunking and chunk intelligence
Chunking is still the second major gap.

Why it matters:
- chunking quality directly controls recall, reranking, grounding, and citation quality
- teams will replace chunking quickly if it behaves like generic text splitting

Must-have work:
- heading-aware hierarchical chunking
- section-aware chunk boundaries
- table-aware chunking
- code-aware chunking for developer docs and source files
- transcript-aware chunking with timestamp windows
- stronger parent/child chunk relationships
- overlap strategies better than fixed overlap alone
- excerpt reconstruction from chunk relationships
- richer chunk-debug metadata beyond the newly landed chunk-boundary reasons and source-aware scope labels

Target outcome:
- default chunking is good enough that serious teams do not immediately replace it

### 6. Production persistence beyond file-backed durability
The durability baseline is good, but the production story is still incomplete.

Must-have work:
- broader SQLite/Postgres-backed persistence for release/eval/ops histories beyond the current governance-heavy path
- migration-safe persistence story for larger corpora and longer-lived deployments
- retention and cleanup policies for non-file stores too
- resumable long-running ingest/admin/sync jobs across durable backends
- stronger source sync durability under larger sources and repeated restarts

Target outcome:
- the operational control plane feels credible for production use beyond local or small deployments

### 7. Retrieval quality refinement, not generic retrieval plumbing
The retrieval foundation is strong enough that the next retrieval work should be selective.

Must-have work:
- better default hybrid presets based on real corpus/query shapes
- deeper metadata-aware ranking and boosting depth across more source types, not just the now-improved section/spreadsheet/media path
- parent-document and section-graph aware retrieval behavior
- stronger reranker composition and post-retrieval control
- better retrieval evaluation around routing decisions and source-specific failures

Target outcome:
- teams can tune retrieval deeply without replacing the retrieval layer

### 8. Access-control and governance consistency cleanup
The model exists. The remaining work is consistency and operability.

Must-have work:
- sweep remaining governance/reporting surfaces for `corpusGroupKey` consistency
- make scoped governance visibility uniform across admin/reporting routes
- fixed release incident sync ordering so `/status/release` and `/status/release/incidents` reflect handoff-stale incidents from handoff-readiness state
- add regression coverage for stale handoff incident visibility in `tests/unit/ai/rag/chatEvaluate.test.ts`
- tighten operator audit visibility around denied and scoped actions
- provide clearer integration guidance for multi-corpus server deployments

Target outcome:
- multi-corpus governance feels uniform instead of partly explicit and partly inferred

## Tier 2: Strong differentiators

### 9. Corpus operations depth
Corpus operations can still become stronger than most competing frameworks.

High-value work:
- deduplication actions beyond the current safe single-latest resolution baseline
- partial reindex depth beyond the current targeted-refresh baseline
- stale-document workflows beyond the current reconciliation baseline
- source conflict handling
- attachment/embedded-resource linkage
- deeper extraction recovery automation beyond the current analytics/remediation/recovery-handler baseline

### 10. Better source sync depth
The current sync baseline is useful, but not yet a moat.

High-value work:
- better delta detection beyond the current stale/refresh baseline
- richer resume coordination for larger sources beyond the current cursor baseline
- sync conflict handling beyond the current detection + safe single-latest/deterministic highest-version resolution baseline
- source-specific deeper recovery automation beyond the current sync diagnostics, remediation, recovery-preview, and recovery-handler baseline

### 11. Evaluation and dataset tooling depth
Evaluation is already useful. The remaining gain is turning it into a clear competitive advantage.

High-value work:
- dataset authoring and management primitives beyond the current immutable suite helpers
- golden-set workflows beyond the current first-class case tagging
- hard-negative management beyond the current first-class case tagging and mutation helpers
- synthetic eval generation from corpora beyond the current deterministic document-derived bootstrap helpers
- failure classification for retrieval and grounding beyond the current first-pass explicit taxonomy
- per-source and per-document quality views beyond the current first-pass source/document failure rollups
- clearer regression explanations beyond the current run-to-run entity hotspot summaries and failure-class drift
- experiment comparison across retrieval/reranker/prompt variants
- more explicit source-specific explanations for why media/spreadsheet/section evidence won or lost across runs

## Current Scorecard
This is the honest state of the project right now, benchmarked against the strongest current public capability surfaces across LangChain, LangSmith, Haystack, LlamaIndex, Weaviate, Qdrant, and Milvus.

### Coverage: strong, but not yet category-leading overall
Current coverage by category:
- Connector breadth: 42%
- Vector/runtime depth: 61%
- Query planning/filtering: 63%
- Evaluation/product tooling: 48%
- Framework UX/integrations: 78%
- Document understanding/OCR: 55%

Leadership target: no category should stay below 75%, and overall should be above 82%.

Strong today:
- retrieval, reranking, evaluation, and diagnostics
- governance, release control, and persistent operational history
- framework parity and public-surface packaging
- first-pass extraction across the major document families
- meaningful spreadsheet and media semantics instead of flat text-only ingestion
- growing vector backend depth with SQLite planner surfaces and a real core Postgres adapter, now including parity-critical count/delete lifecycle operations

Still behind the best current ecosystems in:
- connector breadth and source ecosystem scale
- vector-database-native operational depth
- eval workflow productization and experiment ergonomics
- OCR/document-understanding depth at the high end

### Extensibility: strong and increasingly credible
Extensibility coverage estimate:
- Extension registry coverage: 78%
- Production connector kits/readiness: 52%
- Reference implementations (connectors/persistence/controls): 44%

Strong today:
- extractor registry
- chunker registry
- routing hooks
- transform hooks
- reranking seams
- access-control seams
- UI/presentation surfaces exposed as package imports
- backend adapter depth now living in core rather than package sprawl

Still missing to be clearly category-leading:
- stronger connector kits and reference implementations
- more production-grade persistence adapters across all history/control surfaces
- deeper source-specific extension kits and reference implementations
- broader backend parity beyond SQLite-first depth

## Prioritized Next 10
This is the current execution order, biased toward the shortest path to actual category leadership rather than internal completeness.

1. Postgres vector depth
- extend safe metadata pushdown and planner depth
- bring Postgres closer to SQLite planner introspection parity and beyond

2. Larger-corpus backend planning
- candidate budgeting, prefilter strategy, backend health, and query planning depth
- reduce the gap versus Weaviate, Qdrant, and Milvus

3. Evaluation productization
- experiment management, comparison ergonomics, and benchmark triage flows
- reduce the gap versus LangSmith and Haystack

4. OCR and scanned-document depth
- strengthen scanned PDF and image extraction
- improve confidence, page/region traceability, and reading-order quality further

5. Connector breadth expansion
- add first-party high-value connectors and source kits
- close the highest-value ecosystem gaps versus LangChain and LlamaIndex without turning connector count into the main score

6. Richer chunk intelligence
- hierarchical parent/child chunk relationships
- better excerpt reconstruction from related chunks
- stronger debug metadata for why a chunk won, not just where it came from

7. Corpus operations depth
- stronger lineage, dedup, partial reindex, and recovery workflows
- make the corpus layer feel more platform-grade

8. Better source sync depth
- stronger delta detection
- larger-source coordination and resume semantics
- deeper recovery automation

9. Broader durable persistence
- extend SQLite/Postgres-backed persistence beyond the current governance-heavy surface and the new eval/dataset histories
- make migrations and retention policies more uniform

10. Extension kits and reference implementations
- provide stronger first-party extension examples for connectors, extractors, chunkers, routing, backends, and persistence
- make the extensibility story easier to adopt than Python competitors, not just technically possible

### 9. Better answer-grounding productization
Grounding primitives are good and can get better in product feel.

High-value work:
- richer artifact inspection
- better difficulty trends
- easier provider comparison inspection
- clearer source-to-answer traceability in workflow surfaces

## Tier 3: Later depth work

### 10. More file types where justified
Add more file types only when they improve real ingestion coverage.

Rule:
- do not expand the matrix just to expand the matrix
- add formats when they improve actual RAG usability

### 11. More release-control policy depth
Release control is already strong enough to stop being the primary roadmap driver.

Only continue here when a real usage gap appears.

## Immediate Next Steps
Current execution constraint:
- do not spend cycles on benchmark productization until explicitly requested
- do not spend cycles on docs until explicitly requested
- do not spend cycles on example-only work until explicitly requested
- stay focused on core ingest, extraction, and retrieval features that raise real competitive quality

The strongest next branch is:

1. OCR and scanned-document depth
   - strengthen scanned PDF and image extraction
   - improve confidence, page/region traceability, and reading-order quality further

2. deeper XLSX table/header semantics
   - merged-cell, sparse-header, and shifted-span workbook semantics
   - stronger sheet/table/column reconstruction under uglier real workbooks

3. any remaining email/mailbox realism only where retrieval still weakens
   - multi-folder state collisions
   - nastier mailbox-family overlap
   - deeper native `pst/ost` parsing if the parser path is worth owning beyond the new first-pass mailbox fanout, folder lineage, and state semantics

4. deeper PPTX/media extraction only where retrieval still weakens
   - richer slide body/notes structure where title-aware retrieval is still insufficient
   - deeper transcript locality only where current grouped media windows still miss

Recommendation:
- do not default back to benchmark, docs, or example work first
- the best path to leadership right now is extraction quality, OCR depth, archive/email relationship modeling, and then selective backend/runtime depth

### 12. More example polish
The demo should keep improving, but core product work should not be blocked on endless presentation work.

## Prioritized Implementation Order

### Phase 1: Ecosystem and backend competitiveness
1. Postgres vector depth
2. larger-corpus planner and backend operations depth
3. evaluation workflow productization
4. selective connector breadth

### Phase 2: Extraction quality foundation
1. OCR and scanned-document depth
2. deeper XLSX table/header semantics
3. any remaining email/mailbox realism where current extraction still weakens retrieval materially
4. any deeper PPTX/media work only where current extraction still weakens retrieval materially

### Phase 3: Chunking intelligence
1. section-aware chunking
2. heading-aware chunking
3. code-aware chunking
4. table-aware chunking
5. transcript-aware chunking
6. parent/child chunk graph and excerpt reconstruction
7. chunk-debug metadata improvements

### Phase 4: Production persistence hardening
1. SQLite/Postgres-backed persistence for ops/release/eval histories
2. retention and cleanup policies across durable stores
3. resumable durable jobs
4. stronger sync durability under restart and large-source pressure
5. migration-safe persistence guidance

### Phase 5: Retrieval quality refinement
1. stronger hybrid defaults and presets
2. metadata-aware ranking and boosting
3. parent-document and section-graph retrieval depth
4. stronger reranker composition
5. retrieval-evaluation depth for routing and source-specific regressions

### Phase 6: Governance and access consistency
1. sweep remaining governance/reporting holdouts for `corpusGroupKey`
2. tighten scoped audit and denied-action visibility
3. improve multi-corpus integration guidance and helpers

### Phase 7: Evaluation advantage
1. dataset management
2. hard-negative workflows
3. synthetic eval generation
4. regression classification and source-level quality analytics

## Decision Rule For New Work
A new feature should only be prioritized if it does one of these:
- materially improves extraction quality
- materially improves chunking quality
- materially improves retrieval quality
- materially improves production safety
- materially improves evaluation, release, or regression-control speed
- materially reduces the chance a serious team needs to replace part of the stack

A feature should not be prioritized just because it is visible, easy to demo, or adds another governance surface.

## Competitive Proof Gates
Before claiming category leadership, AbsoluteJS should be able to show all of these on designated internal benchmark suites and example workloads:

1. Retrieval and ranking quality
- exact-phrase, hybrid, multivector, and filter-heavy cases do not regress
- source-structure-sensitive cases remain explainable in traces and comparisons
- default routing and reranking choices beat or match the previous stable baseline on the tracked suites

2. Backend and runtime depth
- SQLite, SQLite native, and Postgres pass shared retrieval parity suites
- larger-corpus workloads have inspectable planner behavior, maintenance status, and stable operational controls
- backend health and maintenance signals are visible enough to support release gates

3. Evaluation and release operations
- experiment comparisons can identify winners, regressions, and blocker classes without raw JSON inspection
- multivector, general, and backend/runtime regressions are visible in release-control surfaces
- release gates can fail on quality regressions, not only on generic status rules

4. Extraction quality
- PDFs, Office docs, spreadsheets, transcripts, email, archives, and OCR-heavy inputs remain usable without immediate custom extractor replacement
- extraction failures surface explicit recovery cues rather than silent quality drops

5. Example proof
- the external parity example demonstrates the winning behaviors across all supported page surfaces
- example regressions are guarded by route-level tests, not just helper-state checks

## Current Recommendation
If choosing the next major build area right now:
1. vector-store and larger-corpus backend depth
2. evaluation workflow productization
3. extraction quality
4. selective connector breadth and source ecosystem depth
5. chunking intelligence

That is the path most likely to make AbsoluteJS the framework teams choose by default instead of merely the framework they find impressive.

## What “Done Enough” Looks Like
AbsoluteJS is close to default-choice status when these are true:
- teams trust the built-in extraction layer for real-world source material
- teams trust the built-in chunking layer for real retrieval quality
- teams can extend extractors/chunkers without forking core
- teams can tune retrieval without replacing the retrieval stack
- teams can run the ops/release/eval surfaces with durable persistence and sane access boundaries
- teams can host multiple corpora on one server with explicit, inspectable scope and governance boundaries

Until those are true, there is still meaningful product work left.
