# Extraction Fixture Pack

## Purpose
This fixture pack exists to keep extraction work tied to RAG utility instead of raw extractor output size.

The goal is not to prove that AbsoluteJS can read a file at all.
The goal is to prove that extracted output is structured enough to support:
- chunking
- retrieval
- citations
- grounding
- operator inspection

## Current Coverage

### File-backed fixtures
- `sample.md`
  - baseline markdown structure and plain-text normalization
- `sample.html`
  - main-content extraction
  - boilerplate removal
  - link-context preservation
- `evidence.pdf`
  - baseline PDF text extraction
  - page count metadata
- `layout.pdf`
  - simple line-order preservation
- `table.pdf`
  - simple table-row reconstruction from native PDF operators
- `message.eml`
  - email message metadata
  - thread reference metadata
- `notes.rtf`
  - baseline RTF extraction

### Synthetic office archive fixtures
- `office/docx`
  - heading and section preservation
- `office/xlsx`
  - sheet names
  - row/header context
- `office/pptx`
  - slide text
  - speaker notes

## What This Pack Proves Today
The current pack is good enough to guard:
- baseline extractor selection
- basic HTML boilerplate removal
- simple PDF line-order preservation
- simple PDF table-row preservation
- basic Office structure extraction
- email metadata extraction
- office archive scorecard matching

## What Is Still Missing
The current pack is still too shallow for the next extraction phase.

### PDF gaps
Missing fixtures for:
- multi-column reading order
- mixed paragraph and table regions on the same page
- figure/caption association
- repeated headers/footers that should not dominate extraction
- citation-grade page/region metadata expectations

### HTML gaps
Missing fixtures for:
- article pages with heavier nav/footer/aside boilerplate
- heading hierarchy preservation expectations
- HTML pages with embedded code or table sections
- HTML pages with noisy link clusters that should not leak into retrieval text

### OCR gaps
Missing fixtures for:
- scanned PDF fallback
- image OCR with confidence expectations
- low-confidence spans that should remain inspectable

### Office gaps
Missing fixtures for:
- DOCX list nesting and table boundaries
- PPTX slide-title/body separation with richer notes
- XLSX multi-sheet tables with row and column labels that differ by section

### Archive and email lineage gaps
Missing fixtures for:
- nested archive entry lineage
- email + attachment linkage
- email thread reconstruction across multiple messages

### Media gaps
Missing fixtures for:
- transcript segmentation
- timestamp preservation
- speaker/channel metadata

## Phase 1 Fixture Additions
These are the next fixtures to add before deep extractor work.

### 1. PDF fixture set
Add:
- `pdf_multicolumn_layout.pdf`
  - expected reading order across two-column content
- `pdf_table_regions.pdf`
  - expected paragraph/table separation
- `pdf_figure_caption.pdf`
  - expected figure/caption adjacency metadata
- `pdf_headers_footers.pdf`
  - expected suppression or de-emphasis of repeated chrome

Success checks:
- extracted text order is deterministic
- table content remains distinct from paragraph flow
- page/region metadata is stable enough for downstream citation work

### 2. HTML fixture set
Add:
- `html_article_boilerplate.html`
  - heavy nav, aside, promo, footer noise
- `html_heading_hierarchy.html`
  - nested heading structure for chunking inputs
- `html_table_and_code.html`
  - mixed article, table, and code blocks

Success checks:
- content extraction favors the article body
- headings remain recoverable for section-aware chunking
- tables/code blocks are preserved as meaningful text units

### 3. OCR fixture set
Add:
- `ocr_scanned_notice.pdf`
- `ocr_scanned_form.png`

Success checks:
- OCR fallback path is exercised explicitly
- confidence metadata can be asserted in tests
- low-confidence extraction remains inspectable

### 4. Office depth set
Add:
- `office_complex.docx`
  - nested headings, lists, and tables
- `office_complex.xlsx`
  - multi-sheet structured tables with repeated headers
- `office_complex.pptx`
  - title/body/note separation across slides

Success checks:
- Office extraction carries richer structural cues than the current baseline set

### 5. Archive and email lineage set
Add:
- `archive_nested.zip`
- `thread_with_attachment.eml`
- `thread_reply.eml`

Success checks:
- parent/child lineage is assertable
- attachment linkage is assertable
- thread-level metadata survives extraction

## Recommended Execution Order
1. add the PDF multi-column and table-region fixtures
2. add heavy-boilerplate HTML fixtures
3. add OCR fixtures with confidence expectations
4. add deeper Office fixtures
5. add archive/email lineage fixtures

## Scorecard Rule
New extraction fixtures should assert RAG-relevant outcomes, not only raw text presence.

Prefer expectations like:
- heading or section boundaries are preserved
- boilerplate is excluded
- row/column context is preserved
- page/region metadata exists
- thread or attachment lineage exists
- OCR confidence exists

Avoid fixtures that only prove:
- the parser returned some text
- the extractor did not throw
