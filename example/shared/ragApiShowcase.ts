const styles = `
	:host {
		display: block;
		margin-top: 3rem;
	}

	* {
		box-sizing: border-box;
	}

	.panel {
		border: 1px solid rgba(95, 190, 235, 0.35);
		border-radius: 1.5rem;
		padding: 1.5rem;
		background:
			radial-gradient(circle at top right, rgba(53, 213, 162, 0.18), transparent 32%),
			radial-gradient(circle at top left, rgba(95, 190, 235, 0.18), transparent 28%),
			rgba(14, 18, 25, 0.88);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
		color: #f6fbff;
	}

	.hero {
		display: grid;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.kicker {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #35d5a2;
	}

	h2 {
		margin: 0;
		font-size: 1.8rem;
	}

	p {
		margin: 0;
		line-height: 1.5;
		color: rgba(246, 251, 255, 0.78);
	}

	.grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	}

	.card {
		border: 1px solid rgba(95, 190, 235, 0.2);
		border-radius: 1rem;
		padding: 1rem;
		background: rgba(8, 12, 18, 0.64);
	}

	.card h3 {
		margin: 0 0 0.75rem;
		font-size: 1rem;
	}

	.controls {
		display: grid;
		gap: 0.75rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	input,
	select,
	button,
	label {
		font: inherit;
	}

	input,
	select {
		flex: 1 1 220px;
		border: 1px solid rgba(95, 190, 235, 0.35);
		border-radius: 999px;
		padding: 0.7rem 1rem;
		background: rgba(255, 255, 255, 0.06);
		color: inherit;
	}

	button {
		border: 1px solid rgba(95, 190, 235, 0.4);
		border-radius: 999px;
		padding: 0.7rem 1rem;
		background: linear-gradient(135deg, rgba(95, 190, 235, 0.18), rgba(53, 213, 162, 0.16));
		color: inherit;
		cursor: pointer;
	}

	button:hover {
		border-color: rgba(95, 190, 235, 0.8);
	}

	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.presets button {
		padding-inline: 0.85rem;
		font-size: 0.9rem;
	}

	.status {
		font-size: 0.92rem;
		color: #5fbeeb;
	}

	.status.error {
		color: #ff7a9a;
	}

	ul {
		margin: 0;
		padding-left: 1.1rem;
	}

	li + li {
		margin-top: 0.4rem;
	}

	.metric {
		display: grid;
		gap: 0.25rem;
		margin-top: 0.75rem;
	}

	.metric strong {
		color: #35d5a2;
	}

	pre {
		overflow: auto;
		max-height: 20rem;
		padding: 0.85rem;
		border-radius: 0.85rem;
		background: rgba(0, 0, 0, 0.35);
		font-size: 0.8rem;
	}

	details {
		margin-top: 0.75rem;
	}

	summary {
		cursor: pointer;
		color: #5fbeeb;
	}

	@media (prefers-color-scheme: light) {
		.panel {
			background:
				radial-gradient(circle at top right, rgba(53, 213, 162, 0.1), transparent 32%),
				radial-gradient(circle at top left, rgba(95, 190, 235, 0.1), transparent 28%),
				rgba(255, 255, 255, 0.94);
			color: #14202a;
		}

		p {
			color: rgba(20, 32, 42, 0.75);
		}

		.card {
			background: rgba(255, 255, 255, 0.72);
		}

		input,
		select {
			background: rgba(255, 255, 255, 0.9);
			color: #14202a;
		}

		pre {
			background: rgba(20, 32, 42, 0.06);
		}
	}
`;

const searchPresets = [
	{
		label: 'Exact phrase',
		query: 'Which launch checklist phrase is exact wording?',
		retrieval: 'vector'
	},
	{
		label: 'Hybrid phrase',
		query: 'aurora promotion checklist wording',
		retrieval: 'hybrid'
	},
	{
		label: 'Lane filter',
		query: 'focus lane launch checklist wording',
		retrieval: 'hybrid'
	}
] as const;

const html = `
	<div class="panel">
		<div class="hero">
			<div class="kicker">RAG API</div>
			<h2>Search, trace, benchmark, and governance in one panel</h2>
			<p>
				This example is backed by the real <code>/rag</code> API. Search runs return trace detail, benchmark routes persist comparison history, and ops/status endpoints expose the same governance surface the package ships.
			</p>
		</div>
		<div class="grid">
			<section class="card">
				<h3>Search</h3>
				<form class="controls" data-role="search-form">
					<div class="row">
						<input data-role="query" name="query" value="${searchPresets[0].query}" />
						<select data-role="retrieval" name="retrieval">
							<option value="vector">vector</option>
							<option value="hybrid">hybrid</option>
							<option value="lexical">lexical</option>
						</select>
					</div>
					<div class="row">
						<label><input data-role="include-trace" type="checkbox" checked /> include trace</label>
						<button type="submit">Run search</button>
					</div>
				</form>
				<div class="presets" data-role="presets"></div>
				<div class="status" data-role="search-status">Ready.</div>
				<div class="metric" data-role="search-summary"></div>
				<details>
					<summary>Search payload</summary>
					<pre data-role="search-json">No search executed yet.</pre>
				</details>
			</section>
			<section class="card">
				<h3>Trace highlights</h3>
				<div class="metric" data-role="trace-summary">
					<span>Run a traced search to inspect planner and retrieval decisions.</span>
				</div>
			</section>
			<section class="card">
				<h3>Benchmarks</h3>
				<div class="row">
					<button data-action="adaptive-run" type="button">Run adaptive planner</button>
					<button data-action="backend-run" type="button">Run backend comparison</button>
				</div>
				<div class="row">
					<button data-action="adaptive-load" type="button">Load adaptive history</button>
					<button data-action="backend-load" type="button">Load backend history</button>
				</div>
				<div class="status" data-role="benchmark-status">No benchmark run yet.</div>
				<div class="metric" data-role="benchmark-summary"></div>
				<details>
					<summary>Benchmark payload</summary>
					<pre data-role="benchmark-json">No benchmark payload loaded yet.</pre>
				</details>
			</section>
			<section class="card">
				<h3>Governance</h3>
				<div class="row">
					<button data-action="ops-load" type="button">Load ops</button>
					<button data-action="status-load" type="button">Load status</button>
				</div>
				<div class="status" data-role="governance-status">No governance payload loaded yet.</div>
				<div class="metric" data-role="governance-summary"></div>
				<details>
					<summary>Governance payload</summary>
					<pre data-role="governance-json">No governance payload loaded yet.</pre>
				</details>
			</section>
		</div>
	</div>
`;

const formatJSON = (value: unknown) => JSON.stringify(value, null, 2);

const fetchJSON = async (input: RequestInfo | URL, init?: RequestInit) => {
	const response = await fetch(input, init);
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(
			typeof body?.error === 'string'
				? body.error
				: `Request failed with status ${response.status}`
		);
	}

	return body;
};

const setHTML = (element: Element | null, content: string) => {
	if (element) {
		element.innerHTML = content;
	}
};

export const mountRAGAPIShowcase = (container: HTMLElement) => {
	const root =
		container.shadowRoot ?? container.attachShadow({ mode: 'open' });
	root.innerHTML = `<style>${styles}</style>${html}`;

	const searchForm = root.querySelector<HTMLFormElement>(
		'[data-role="search-form"]'
	);
	const queryInput = root.querySelector<HTMLInputElement>(
		'[data-role="query"]'
	);
	const retrievalSelect = root.querySelector<HTMLSelectElement>(
		'[data-role="retrieval"]'
	);
	const includeTrace = root.querySelector<HTMLInputElement>(
		'[data-role="include-trace"]'
	);
	const searchStatus = root.querySelector<HTMLElement>(
		'[data-role="search-status"]'
	);
	const searchSummary = root.querySelector<HTMLElement>(
		'[data-role="search-summary"]'
	);
	const searchJSON = root.querySelector<HTMLElement>(
		'[data-role="search-json"]'
	);
	const traceSummary = root.querySelector<HTMLElement>(
		'[data-role="trace-summary"]'
	);
	const presets = root.querySelector<HTMLElement>('[data-role="presets"]');
	const benchmarkStatus = root.querySelector<HTMLElement>(
		'[data-role="benchmark-status"]'
	);
	const benchmarkSummary = root.querySelector<HTMLElement>(
		'[data-role="benchmark-summary"]'
	);
	const benchmarkJSON = root.querySelector<HTMLElement>(
		'[data-role="benchmark-json"]'
	);
	const governanceStatus = root.querySelector<HTMLElement>(
		'[data-role="governance-status"]'
	);
	const governanceSummary = root.querySelector<HTMLElement>(
		'[data-role="governance-summary"]'
	);
	const governanceJSON = root.querySelector<HTMLElement>(
		'[data-role="governance-json"]'
	);

	if (presets && queryInput && retrievalSelect) {
		presets.innerHTML = searchPresets
			.map(
				(entry, index) =>
					`<button type="button" data-preset="${index}">${entry.label}</button>`
			)
			.join('');
		presets
			.querySelectorAll<HTMLButtonElement>('button')
			.forEach((button) => {
				button.addEventListener('click', () => {
					const preset =
						searchPresets[Number(button.dataset.preset ?? 0)];
					if (!preset) return;
					queryInput.value = preset.query;
					retrievalSelect.value = preset.retrieval;
				});
			});
	}

	const renderSearch = (body: any) => {
		const results = Array.isArray(body?.results) ? body.results : [];
		setHTML(
			searchSummary,
			results.length === 0
				? '<span>No results returned.</span>'
				: `
					<strong>${results.length} results</strong>
					<ul>${results
						.slice(0, 3)
						.map(
							(entry: any) =>
								`<li><strong>${entry.source ?? entry.chunkId}</strong><br />${String(entry.text ?? '').slice(0, 120)}</li>`
						)
						.join('')}</ul>
				`
		);
		const trace = body?.trace;
		const plannerStep = Array.isArray(trace?.steps)
			? trace.steps.find(
					(entry: any) =>
						entry?.label === 'Selected native planner profile'
				)
			: undefined;
		const routeLabel =
			typeof trace?.routingLabel === 'string'
				? trace.routingLabel
				: 'n/a';
		const transformedQuery =
			typeof trace?.transformedQuery === 'string'
				? trace.transformedQuery
				: 'n/a';
		const stageCount = trace?.steps?.length ?? 0;
		setHTML(
			traceSummary,
			`
				<span><strong>Route:</strong> ${routeLabel}</span>
				<span><strong>Transformed query:</strong> ${transformedQuery}</span>
				<span><strong>Planner:</strong> ${plannerStep?.metadata?.selectedProfile ?? 'n/a'}</span>
				<span><strong>Trace steps:</strong> ${stageCount}</span>
			`
		);
		if (searchJSON) {
			searchJSON.textContent = formatJSON(body);
		}
	};

	const renderBenchmark = (body: any) => {
		const comparison = body?.comparison;
		const summary = comparison?.summary ?? {};
		const entries = Array.isArray(comparison?.entries)
			? comparison.entries
			: [];
		setHTML(
			benchmarkSummary,
			`
				<span><strong>Suite:</strong> ${body?.suite?.label ?? 'n/a'}</span>
				<span><strong>Passing-rate winner:</strong> ${summary.bestByPassingRate ?? 'n/a'}</span>
				<span><strong>Runtime budget winner:</strong> ${summary.bestByLowestRuntimeCandidateBudgetExhaustedCases ?? 'n/a'}</span>
				<span><strong>Recent runs:</strong> ${body?.historyPresentation?.summary ?? 'n/a'}</span>
				<ul>${entries
					.map(
						(entry: any) =>
							`<li><strong>${entry.retrievalId}</strong> · pass ${entry.response?.passingRate ?? 0}% · f1 ${entry.response?.summary?.averageF1 ?? 0}</li>`
					)
					.join('')}</ul>
			`
		);
		if (benchmarkJSON) {
			benchmarkJSON.textContent = formatJSON(body);
		}
	};

	const renderGovernance = (body: any) => {
		const latest = body?.retrievalComparisons?.latest;
		const adaptive =
			body?.retrievalComparisons?.adaptiveNativePlannerBenchmark;
		const backend =
			body?.retrievalComparisons?.nativeBackendComparisonBenchmark;
		setHTML(
			governanceSummary,
			`
				<span><strong>Latest comparison:</strong> ${latest?.label ?? 'n/a'}</span>
				<span><strong>Gate status:</strong> ${latest?.decisionSummary?.gate?.status ?? 'n/a'}</span>
				<span><strong>Adaptive benchmark:</strong> ${adaptive?.latestRun?.suiteId ?? adaptive?.suiteId ?? 'n/a'}</span>
				<span><strong>Backend benchmark:</strong> ${backend?.latestRun?.suiteId ?? backend?.suiteId ?? 'n/a'}</span>
			`
		);
		if (governanceJSON) {
			governanceJSON.textContent = formatJSON(body);
		}
	};

	const setStatus = (
		element: HTMLElement | null,
		message: string,
		tone: 'default' | 'error' = 'default'
	) => {
		if (!element) return;
		element.textContent = message;
		element.classList.toggle('error', tone === 'error');
	};

	const runSearch = async () => {
		if (!queryInput || !retrievalSelect) return;
		setStatus(searchStatus, 'Running search...');
		try {
			const body = await fetchJSON('/rag/search', {
				body: JSON.stringify({
					includeTrace: includeTrace?.checked === true,
					query: queryInput.value,
					retrieval: retrievalSelect.value,
					topK: 3
				}),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			});
			renderSearch(body);
			setStatus(searchStatus, 'Search complete.');
		} catch (error) {
			setStatus(
				searchStatus,
				error instanceof Error ? error.message : String(error),
				'error'
			);
		}
	};

	const loadAdaptiveHistory = async () => {
		setStatus(benchmarkStatus, 'Loading adaptive planner benchmark...');
		try {
			const body = await fetchJSON(
				'/rag/compare/retrieval/benchmarks/adaptive-native-planner?limit=5&runLimit=5'
			);
			renderBenchmark(body);
			setStatus(benchmarkStatus, 'Adaptive planner benchmark loaded.');
		} catch (error) {
			setStatus(
				benchmarkStatus,
				error instanceof Error ? error.message : String(error),
				'error'
			);
		}
	};

	const runAdaptiveBenchmark = async () => {
		setStatus(benchmarkStatus, 'Running adaptive planner benchmark...');
		try {
			const body = await fetchJSON(
				'/rag/compare/retrieval/benchmarks/adaptive-native-planner/run',
				{
					body: JSON.stringify({
						limit: 5,
						persistRun: true,
						runLimit: 5
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			);
			renderBenchmark(body);
			setStatus(benchmarkStatus, 'Adaptive planner benchmark complete.');
		} catch (error) {
			setStatus(
				benchmarkStatus,
				error instanceof Error ? error.message : String(error),
				'error'
			);
		}
	};

	const loadBackendHistory = async () => {
		setStatus(benchmarkStatus, 'Loading backend benchmark...');
		try {
			const body = await fetchJSON(
				'/rag/compare/retrieval/benchmarks/native-backend-comparison?limit=5&runLimit=5'
			);
			renderBenchmark(body);
			setStatus(benchmarkStatus, 'Backend benchmark loaded.');
		} catch (error) {
			setStatus(
				benchmarkStatus,
				error instanceof Error ? error.message : String(error),
				'error'
			);
		}
	};

	const runBackendBenchmark = async () => {
		setStatus(benchmarkStatus, 'Running backend benchmark...');
		try {
			const body = await fetchJSON(
				'/rag/compare/retrieval/benchmarks/native-backend-comparison/run',
				{
					body: JSON.stringify({
						limit: 5,
						persistRun: true,
						runLimit: 5
					}),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				}
			);
			renderBenchmark(body);
			setStatus(benchmarkStatus, 'Backend benchmark complete.');
		} catch (error) {
			setStatus(
				benchmarkStatus,
				error instanceof Error ? error.message : String(error),
				'error'
			);
		}
	};

	const loadOps = async () => {
		setStatus(governanceStatus, 'Loading ops...');
		try {
			const body = await fetchJSON('/rag/ops');
			renderGovernance(body);
			setStatus(governanceStatus, 'Ops loaded.');
		} catch (error) {
			setStatus(
				governanceStatus,
				error instanceof Error ? error.message : String(error),
				'error'
			);
		}
	};

	const loadStatus = async () => {
		setStatus(governanceStatus, 'Loading status...');
		try {
			const body = await fetchJSON('/rag/status');
			renderGovernance(body);
			setStatus(governanceStatus, 'Status loaded.');
		} catch (error) {
			setStatus(
				governanceStatus,
				error instanceof Error ? error.message : String(error),
				'error'
			);
		}
	};

	searchForm?.addEventListener('submit', (event) => {
		event.preventDefault();
		void runSearch();
	});

	root
		.querySelector<HTMLButtonElement>('[data-action="adaptive-run"]')
		?.addEventListener('click', () => void runAdaptiveBenchmark());
	root
		.querySelector<HTMLButtonElement>('[data-action="backend-run"]')
		?.addEventListener('click', () => void runBackendBenchmark());
	root
		.querySelector<HTMLButtonElement>('[data-action="adaptive-load"]')
		?.addEventListener('click', () => void loadAdaptiveHistory());
	root
		.querySelector<HTMLButtonElement>('[data-action="backend-load"]')
		?.addEventListener('click', () => void loadBackendHistory());
	root
		.querySelector<HTMLButtonElement>('[data-action="ops-load"]')
		?.addEventListener('click', () => void loadOps());
	root
		.querySelector<HTMLButtonElement>('[data-action="status-load"]')
		?.addEventListener('click', () => void loadStatus());

	void runSearch();
	void loadOps();
};
