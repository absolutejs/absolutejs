import { describe, expect, it } from 'bun:test';
import {
	buildRAGMaintenanceOverview,
	createRAGClient
} from '../../../../src/ai/client/ragClient';

describe('createRAGClient', () => {
	it('calls search and returns normalized results', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/search');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({ query: 'hello', topK: 2 })
			);

			return new Response(
				JSON.stringify({
					ok: true,
					results: [
						{
							chunkId: 'a',
							labels: {
								locatorLabel: 'Page 7 · Region 2',
								provenanceLabel:
									'OCR demo_pdf_ocr · Confidence 0.91'
							},
							score: 0.9,
							text: 'alpha'
						}
					]
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const results = await client.search({ query: 'hello', topK: 2 });
		expect(results).toEqual([
			{
				chunkId: 'a',
				labels: {
					locatorLabel: 'Page 7 · Region 2',
					provenanceLabel: 'OCR demo_pdf_ocr · Confidence 0.91'
				},
				score: 0.9,
				text: 'alpha'
			}
		]);
	});

	it('requests trace details when includeTrace is true', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/search');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({ query: 'hello', topK: 3, includeTrace: true })
			);

			return new Response(
				JSON.stringify({
					ok: true,
					results: [{ chunkId: 'a', score: 0.9, text: 'alpha' }],
					trace: {
						candidateTopK: 3,
						lexicalTopK: 3,
						mode: 'vector',
						query: 'hello',
						topK: 3,
						transformedQuery: 'hello',
						variantQueries: [],
						resultCounts: {
							fused: 1,
							final: 1,
							lexical: 0,
							reranked: 1,
							vector: 1
						},
						runLexical: false,
						runVector: true,
						steps: []
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.search({
			query: 'hello',
			topK: 3,
			includeTrace: true
		});
		expect(response).toEqual({
			results: [{ chunkId: 'a', score: 0.9, text: 'alpha' }],
			trace: {
				candidateTopK: 3,
				lexicalTopK: 3,
				mode: 'vector',
				query: 'hello',
				topK: 3,
				transformedQuery: 'hello',
				variantQueries: [],
				resultCounts: {
					fused: 1,
					final: 1,
					lexical: 0,
					reranked: 1,
					vector: 1
				},
				runLexical: false,
				runVector: true,
				steps: []
			}
		});
	});

	it('exposes a first-class searchWithTrace method', async () => {
		const fetchMock = (async (input, init) => {
			expect(init?.body).toBe(
				JSON.stringify({ query: 'hello', topK: 3, includeTrace: true })
			);

			return new Response(
				JSON.stringify({
					ok: true,
					results: [{ chunkId: 'a', score: 0.9, text: 'alpha' }],
					trace: {
						candidateTopK: 3,
						lexicalTopK: 3,
						mode: 'vector',
						query: 'hello',
						topK: 3,
						transformedQuery: 'hello',
						variantQueries: [],
						resultCounts: {
							fused: 1,
							final: 1,
							lexical: 0,
							reranked: 1,
							vector: 1
						},
						runLexical: false,
						runVector: true,
						steps: []
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.searchWithTrace({
			query: 'hello',
			topK: 3
		});
		expect(response).toEqual({
			results: [{ chunkId: 'a', score: 0.9, text: 'alpha' }],
			trace: {
				candidateTopK: 3,
				lexicalTopK: 3,
				mode: 'vector',
				query: 'hello',
				topK: 3,
				transformedQuery: 'hello',
				variantQueries: [],
				resultCounts: {
					fused: 1,
					final: 1,
					lexical: 0,
					reranked: 1,
					vector: 1
				},
				runLexical: false,
				runVector: true,
				steps: []
			}
		});
	});

	it('keeps search detailed alias around the trace path', async () => {
		const fetchMock = (async (input, init) => {
			expect(init?.body).toBe(
				JSON.stringify({ query: 'hello', topK: 2, includeTrace: true })
			);

			return new Response(
				JSON.stringify({
					ok: true,
					results: [{ chunkId: 'a', score: 0.9, text: 'alpha' }],
					trace: {
						candidateTopK: 2,
						lexicalTopK: 2,
						mode: 'vector',
						query: 'hello',
						topK: 2,
						transformedQuery: 'hello',
						variantQueries: [],
						resultCounts: {
							fused: 1,
							final: 1,
							lexical: 0,
							reranked: 1,
							vector: 1
						},
						runLexical: false,
						runVector: true,
						steps: []
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.searchDetailed({
			query: 'hello',
			topK: 2
		});
		expect(response).toEqual({
			results: [{ chunkId: 'a', score: 0.9, text: 'alpha' }],
			trace: {
				candidateTopK: 2,
				lexicalTopK: 2,
				mode: 'vector',
				query: 'hello',
				topK: 2,
				transformedQuery: 'hello',
				variantQueries: [],
				resultCounts: {
					fused: 1,
					final: 1,
					lexical: 0,
					reranked: 1,
					vector: 1
				},
				runLexical: false,
				runVector: true,
				steps: []
			}
		});
	});

	it('loads persisted search trace history through the client', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe(
				'/rag/traces?query=alpha&groupKey=docs&tag=guide&limit=5'
			);

			return new Response(
				JSON.stringify({
					history: {
						groupKey: 'docs',
						latestTrace: { id: 'trace-1', query: 'alpha' },
						query: 'alpha',
						retrievalTraceTrend: {
							stageTrends: {},
							summaries: [],
							totalRuns: 1
						},
						tag: 'guide',
						traces: [{ id: 'trace-1', query: 'alpha' }]
					},
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const history = await client.searchTraceHistory({
			groupKey: 'docs',
			limit: 5,
			query: 'alpha',
			tag: 'guide'
		});

		expect(history).toEqual(
			expect.objectContaining({
				groupKey: 'docs',
				query: 'alpha',
				tag: 'guide',
				traces: [
					expect.objectContaining({ id: 'trace-1', query: 'alpha' })
				]
			})
		);
	});

	it('loads grouped trace history through the client', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/traces/groups?tag=guide&limit=3');

			return new Response(
				JSON.stringify({
					history: {
						groups: [
							{
								groupKey: 'docs',
								latestTrace: { id: 'trace-1', query: 'alpha' },
								retrievalTraceTrend: {
									stageTrends: {},
									summaries: [],
									totalRuns: 1
								},
								traceCount: 1
							}
						],
						tag: 'guide'
					},
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const history = await client.searchTraceGroups({
			limit: 3,
			tag: 'guide'
		});

		expect(history).toEqual(
			expect.objectContaining({
				groups: [
					expect.objectContaining({
						groupKey: 'docs',
						traceCount: 1
					})
				],
				tag: 'guide'
			})
		);
	});

	it('loads search trace stats through the client', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/traces/stats?tag=guide');

			return new Response(
				JSON.stringify({
					ok: true,
					stats: {
						groupCount: 1,
						queryCount: 2,
						tagCounts: { guide: 2 },
						totalTraces: 2
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const stats = await client.searchTraceStats({ tag: 'guide' });
		expect(stats).toEqual({
			groupCount: 1,
			queryCount: 2,
			tagCounts: { guide: 2 },
			totalTraces: 2
		});
	});

	it('previews and executes search trace pruning through the client', async () => {
		const calls: Array<{ input: string; method?: string; body?: string }> =
			[];
		const fetchMock = (async (input, init) => {
			calls.push({
				body: typeof init?.body === 'string' ? init.body : undefined,
				input: String(input),
				method: init?.method
			});

			if (String(input).endsWith('/preview')) {
				return new Response(
					JSON.stringify({
						ok: true,
						preview: {
							result: { keptCount: 1, removedCount: 1 },
							statsAfter: {
								totalTraces: 1,
								queryCount: 1,
								groupCount: 1,
								tagCounts: { guide: 1 }
							},
							statsBefore: {
								totalTraces: 2,
								queryCount: 1,
								groupCount: 1,
								tagCounts: { guide: 2 }
							}
						}
					}),
					{ status: 200 }
				);
			}

			return new Response(
				JSON.stringify({
					ok: true,
					result: { keptCount: 1, removedCount: 1 },
					stats: {
						totalTraces: 1,
						queryCount: 1,
						groupCount: 1,
						tagCounts: { guide: 1 }
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const input = { maxRecordsPerGroup: 1, tag: 'guide' };
		const preview = await client.previewSearchTracePrune(input);
		const result = await client.pruneSearchTraces(input);

		expect(preview.result).toEqual({ keptCount: 1, removedCount: 1 });
		expect(result.result).toEqual({ keptCount: 1, removedCount: 1 });
		expect(calls).toEqual([
			{
				body: JSON.stringify(input),
				input: '/rag/traces/prune/preview',
				method: 'POST'
			},
			{
				body: JSON.stringify(input),
				input: '/rag/traces/prune',
				method: 'POST'
			}
		]);
	});

	it('loads prune run history through the client', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe(
				'/rag/traces/prune/history?limit=5&trigger=manual'
			);

			return new Response(
				JSON.stringify({
					ok: true,
					runs: [
						{
							finishedAt: 2,
							id: 'prune-run-1',
							startedAt: 1,
							trigger: 'manual'
						}
					]
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const runs = await client.searchTracePruneHistory({
			limit: 5,
			trigger: 'manual'
		});
		expect(runs).toEqual([
			expect.objectContaining({
				id: 'prune-run-1',
				trigger: 'manual'
			})
		]);
	});

	it('compares retrieval strategies and loads comparison history through the client', async () => {
		const calls: Array<{ input: string; method?: string; body?: string }> =
			[];
		const fetchMock = (async (input, init) => {
			calls.push({
				body: typeof init?.body === 'string' ? init.body : undefined,
				input: String(input),
				method: init?.method
			});

			if (String(input).includes('/history')) {
				return new Response(
					JSON.stringify({
						ok: true,
						runs: [
							{
								decisionSummary: {
									baselineRetrievalId: 'vector',
									candidateRetrievalId: 'lexical'
								},
								groupKey: 'docs-release',
								id: 'comparison-run-1',
								label: 'Docs retrieval benchmark',
								tags: ['docs', 'release'],
								comparison: {
									summary: { bestByPassingRate: 'lexical' }
								}
							}
						]
					}),
					{ status: 200 }
				);
			}

			return new Response(
				JSON.stringify({
					ok: true,
					comparison: {
						entries: [
							{ retrievalId: 'vector' },
							{ retrievalId: 'lexical' }
						],
						summary: { bestByPassingRate: 'lexical' }
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const comparison = await client.compareRetrievals({
			baselineRetrievalId: 'vector',
			candidateRetrievalId: 'lexical',
			cases: [
				{
					expectedDocumentIds: ['alpha-doc'],
					id: 'alpha-case',
					query: 'question about alpha'
				}
			],
			retrievals: [
				{ id: 'vector', retrieval: 'vector' },
				{ id: 'lexical', retrieval: 'lexical' }
			]
		});
		const history = await client.retrievalComparisonHistory({
			groupKey: 'docs-release',
			label: 'docs',
			limit: 5,
			tag: 'release',
			winnerId: 'lexical'
		});

		expect(comparison.summary.bestByPassingRate).toBe('lexical');
		expect(history[0]).toEqual(
			expect.objectContaining({
				decisionSummary: expect.objectContaining({
					baselineRetrievalId: 'vector',
					candidateRetrievalId: 'lexical'
				}),
				groupKey: 'docs-release',
				id: 'comparison-run-1',
				label: 'Docs retrieval benchmark',
				tags: ['docs', 'release']
			})
		);
		expect(calls[0]?.input).toBe('/rag/compare/retrieval');
		expect(calls[1]?.input).toBe(
			'/rag/compare/retrieval/history?limit=5&label=docs&winnerId=lexical&groupKey=docs-release&tag=release'
		);
	});

	it('promotes, reverts, and lists retrieval baselines through the client', async () => {
		const calls: Array<{ input: string; method?: string; body?: string }> =
			[];
		const fetchMock = (async (input, init) => {
			calls.push({
				body: typeof init?.body === 'string' ? init.body : undefined,
				input: String(input),
				method: init?.method
			});

			if (String(input).includes('/promote-run')) {
				return new Response(
					JSON.stringify({
						ok: true,
						baseline: {
							approvedBy: 'alex',
							groupKey: 'docs-release',
							id: 'baseline-2',
							label: 'Lexical candidate',
							promotedAt: 2,
							retrievalId: 'lexical',
							sourceRunId: 'run-1',
							status: 'active',
							version: 2
						},
						rolloutState: {
							groupKey: 'docs-release',
							targetRolloutLabel: 'stable',
							ready: true,
							remediationActions: [
								'Monitor the active lane and verify post-promotion behavior.'
							],
							requiresApproval: true,
							reasons: [
								'baseline is active in the target rollout lane'
							]
						}
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/revert')) {
				return new Response(
					JSON.stringify({
						ok: true,
						baseline: {
							approvedBy: 'alex',
							groupKey: 'docs-release',
							id: 'baseline-3',
							label: 'Lexical release baseline',
							promotedAt: 3,
							retrievalId: 'lexical',
							status: 'active',
							version: 3
						}
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/baselines/decisions')) {
				return new Response(
					JSON.stringify({
						ok: true,
						decisions: [
							{
								ageMs: 7,
								baselineId: 'baseline-3',
								decidedAt: 3,
								decidedBy: 'alex',
								freshnessStatus: 'not_applicable',
								groupKey: 'docs-release',
								id: 'decision-1',
								kind: 'revert',
								retrievalId: 'lexical',
								version: 3
							}
						]
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/candidates')) {
				return new Response(
					JSON.stringify({
						ok: true,
						candidates: [
							{
								approved: false,
								approvalAgeMs: 20,
								approvalExpiresAt: 30,
								approvalFreshnessStatus: 'expired',
								approvedAt: 2,
								approvedBy: 'alex',
								baselineRetrievalId: 'vector',
								candidateRetrievalId: 'lexical',
								delta: {
									averageF1Delta: -0.2,
									passingRateDelta: -0.5
								},
								effectiveBaselineGatePolicy: {
									minPassingRateDelta: 1,
									severity: 'fail'
								},
								effectiveReleasePolicy: {
									approvalMaxAgeMs: 60_000,
									requireApprovalBeforePromotion: true
								},
								finishedAt: 4,
								gateStatus: 'fail',
								groupKey: 'docs-release',
								label: 'Docs candidate gate',
								priority: 'needs_review',
								priorityScore: 4,
								ready: false,
								reasons: [
									'approval has expired and must be renewed before promotion'
								],
								requiresApproval: true,
								reviewStatus: 'needs_review',
								sortReason:
									'candidate approval expired and needs review',
								sourceRunId: 'run-1',
								suiteId: 'suite-1',
								suiteLabel: 'Docs Suite',
								releaseVerdictStatus: 'fail',
								targetRolloutLabel: 'stable',
								tags: ['docs', 'release']
							}
						]
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/release-history')) {
				return new Response(
					JSON.stringify({
						ok: true,
						groupKey: 'docs-release',
						decisions: [
							{
								ageMs: 7,
								decidedAt: 5,
								freshnessStatus: 'not_applicable',
								groupKey: 'docs-release',
								id: 'decision-4',
								kind: 'reject',
								retrievalId: 'lexical'
							}
						],
						baselines: [
							{
								groupKey: 'docs-release',
								id: 'baseline-1',
								label: 'Lexical release baseline',
								promotedAt: 1,
								retrievalId: 'lexical',
								status: 'active',
								version: 3
							}
						],
						runs: [
							{
								comparison: {
									entries: [],
									summary: {}
								},
								elapsedMs: 10,
								finishedAt: 6,
								groupKey: 'docs-release',
								id: 'run-1',
								label: 'Docs release run',
								suiteId: 'suite-1',
								suiteLabel: 'Docs Suite'
							}
						],
						timeline: {
							groupKey: 'docs-release',
							lastPromotedAt: 4,
							lastRejectedAt: 5,
							latestDecisionAt: 5,
							latestDecisionFreshnessStatus: 'not_applicable',
							latestDecisionKind: 'reject'
						}
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/status/handoffs/incidents')) {
				return new Response(
					JSON.stringify({
						freshnessWindows: [
							{
								freshnessStatus: 'expired',
								groupKey: 'docs-release',
								sourceRolloutLabel: 'canary',
								staleAfterMs: 60000,
								targetRolloutLabel: 'stable'
							}
						],
						incidentSummary: {
							acknowledgedOpenCount: 0,
							latestResolvedAt: 9,
							openCount: 1,
							resolvedCount: 0,
							staleOpenCount: 1,
							unacknowledgedOpenCount: 1
						},
						incidents: [
							{
								groupKey: 'docs-release',
								kind: 'handoff_stale',
								targetRolloutLabel: 'stable'
							}
						],
						ok: true
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/status/handoffs')) {
				return new Response(
					JSON.stringify({
						autoComplete: [
							{
								enabled: true,
								freshnessStatus: 'expired',
								groupKey: 'docs-release',
								maxApprovedDecisionAgeMs: 60000,
								ready: false,
								reasons: [
									'latest approved handoff decision is older than the auto-complete policy allows'
								],
								sourceRolloutLabel: 'canary',
								targetRolloutLabel: 'stable'
							}
						],
						decisions: [
							{
								groupKey: 'docs-release',
								kind: 'reject',
								sourceRolloutLabel: 'canary',
								targetRolloutLabel: 'stable'
							}
						],
						incidentSummary: {
							acknowledgedOpenCount: 0,
							openCount: 1,
							resolvedCount: 0,
							staleOpenCount: 1,
							unacknowledgedOpenCount: 1
						},
						incidents: [
							{
								groupKey: 'docs-release',
								kind: 'handoff_stale',
								targetRolloutLabel: 'stable'
							}
						],
						handoffs: [
							{
								groupKey: 'docs-release',
								readyForHandoff: false,
								reasons: ['stable gate has not passed yet'],
								sourceRolloutLabel: 'canary',
								targetRolloutLabel: 'stable'
							}
						],
						freshnessWindows: [
							{
								freshnessStatus: 'expired',
								groupKey: 'docs-release',
								sourceRolloutLabel: 'canary',
								staleAfterMs: 60000,
								targetRolloutLabel: 'stable'
							}
						],
						ok: true
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/handoffs')) {
				if (String(input).includes('/decide')) {
					return new Response(
						JSON.stringify({
							baseline: {
								groupKey: 'docs-release',
								id: 'baseline-4',
								retrievalId: 'lexical',
								rolloutLabel: 'stable',
								version: 4
							},
							ok: true,
							decision: {
								decidedAt: 8,
								decidedBy: 'alex',
								groupKey: 'docs-release',
								id: 'handoff-decision-1',
								kind: 'reject',
								notes: 'stable handoff is blocked until gate and approval pass',
								sourceRolloutLabel: 'canary',
								targetRolloutLabel: 'stable'
							},
							rolloutState: {
								candidateRetrievalId: 'lexical',
								groupKey: 'docs-release',
								ready: false,
								remediationActions: [
									'Renew or record the required approval for this rollout lane.'
								],
								remediationSteps: [
									{
										kind: 'renew_approval',
										label: 'Renew or record the required approval for this rollout lane.',
										actions: [
											{
												kind: 'view_release_status',
												label: 'Inspect release readiness before deciding.',
												method: 'GET',
												path: '/rag/status/release'
											}
										]
									}
								],
								reasons: [
									'explicit approval is required before promotion'
								],
								requiresApproval: true,
								targetRolloutLabel: 'stable'
							}
						}),
						{ status: 200 }
					);
				}
				if (String(input).includes('/decisions')) {
					return new Response(
						JSON.stringify({
							ok: true,
							decisions: [
								{
									decidedAt: 8,
									decidedBy: 'alex',
									groupKey: 'docs-release',
									id: 'handoff-decision-1',
									kind: 'reject',
									notes: 'stable handoff is blocked until gate and approval pass',
									sourceRolloutLabel: 'canary',
									targetRolloutLabel: 'stable'
								}
							]
						}),
						{ status: 200 }
					);
				}
				if (String(input).includes('/policies/history')) {
					return new Response(
						JSON.stringify({
							ok: true,
							records: [
								{
									changeKind: 'snapshot',
									enabled: true,
									groupKey: 'docs-release',
									id: 'handoff-policy-history-1',
									recordedAt: 10,
									targetRolloutLabel: 'stable'
								}
							]
						}),
						{ status: 200 }
					);
				}
				if (String(input).includes('/incidents/history')) {
					return new Response(
						JSON.stringify({
							ok: true,
							records: [
								{
									action: 'resolved',
									groupKey: 'docs-release',
									id: 'handoff-history-1',
									incidentId: 'handoff-incident-1',
									kind: 'handoff_stale',
									recordedAt: 9,
									status: 'resolved',
									targetRolloutLabel: 'stable'
								}
							]
						}),
						{ status: 200 }
					);
				}
				if (
					String(input).includes('/incidents') &&
					!String(input).includes('/remediations') &&
					!String(input).includes('/acknowledge') &&
					!String(input).includes('/unacknowledge') &&
					!String(input).includes('/resolve')
				) {
					return new Response(
						JSON.stringify({
							ok: true,
							incidents: [
								{
									groupKey: 'docs-release',
									id: 'handoff-incident-1',
									kind: 'handoff_stale',
									message:
										'approved canary -> stable handoff is stale and must be completed or re-approved',
									severity: 'critical',
									status: 'open',
									targetRolloutLabel: 'stable',
									triggeredAt: 6
								}
							]
						}),
						{ status: 200 }
					);
				}
				if (
					String(input).includes('/incidents') &&
					!String(input).includes('/remediations')
				) {
					if (String(input).includes('/acknowledge')) {
						return new Response(
							JSON.stringify({
								ok: true,
								incidents: [
									{
										acknowledgedAt: 7,
										acknowledgedBy: 'alex',
										acknowledgementNotes:
											'triaged for stable handoff follow-up',
										groupKey: 'docs-release',
										id: 'handoff-incident-1',
										kind: 'handoff_stale',
										severity: 'critical',
										status: 'open',
										targetRolloutLabel: 'stable',
										triggeredAt: 6
									}
								]
							}),
							{ status: 200 }
						);
					}
					if (String(input).includes('/unacknowledge')) {
						return new Response(
							JSON.stringify({
								ok: true,
								incidents: [
									{
										groupKey: 'docs-release',
										id: 'handoff-incident-1',
										kind: 'handoff_stale',
										severity: 'critical',
										status: 'open',
										targetRolloutLabel: 'stable',
										triggeredAt: 6
									}
								]
							}),
							{ status: 200 }
						);
					}
					if (String(input).includes('/resolve')) {
						return new Response(
							JSON.stringify({
								ok: true,
								incidents: [
									{
										groupKey: 'docs-release',
										id: 'handoff-incident-1',
										kind: 'handoff_stale',
										notes: 'stable handoff triaged after rollback',
										resolvedAt: 9,
										severity: 'critical',
										status: 'resolved',
										targetRolloutLabel: 'stable',
										triggeredAt: 6
									}
								]
							}),
							{ status: 200 }
						);
					}
					return new Response(
						JSON.stringify({
							ok: true,
							incidents: [
								{
									groupKey: 'docs-release',
									id: 'handoff-incident-1',
									kind: 'handoff_stale',
									message:
										'approved canary -> stable handoff is stale and must be completed or re-approved',
									severity: 'critical',
									status: 'open',
									targetRolloutLabel: 'stable',
									triggeredAt: 6
								}
							]
						}),
						{ status: 200 }
					);
				}
				return new Response(
					JSON.stringify({
						ok: true,
						handoffs: [
							{
								candidateRetrievalId: 'lexical',
								groupKey: 'docs-release',
								readyForHandoff: false,
								reasons: [
									'passing rate delta 0 is below 1',
									'explicit approval is required before promotion'
								],
								sourceActive: true,
								sourceBaselineRetrievalId: 'lexical',
								sourceRolloutLabel: 'canary',
								targetActive: false,
								targetRolloutLabel: 'stable'
							}
						]
					}),
					{ status: 200 }
				);
			}

			if (
				String(input).includes('/incidents') &&
				!String(input).includes('/remediations')
			) {
				if (String(input).includes('/acknowledge')) {
					return new Response(
						JSON.stringify({
							ok: true,
							incidents: [
								{
									acknowledgedAt: 7,
									acknowledgedBy: 'alex',
									acknowledgementNotes:
										'triaged for follow-up',
									groupKey: 'docs-release',
									id: 'incident-1',
									kind: 'gate_failure',
									message:
										'candidate regressed or failed the active gate and should be investigated',
									severity: 'critical',
									status: 'open',
									triggeredAt: 6
								}
							]
						}),
						{ status: 200 }
					);
				}
				if (String(input).includes('/unacknowledge')) {
					return new Response(
						JSON.stringify({
							ok: true,
							incidents: [
								{
									groupKey: 'docs-release',
									id: 'incident-1',
									kind: 'gate_failure',
									message:
										'candidate regressed or failed the active gate and should be investigated',
									severity: 'critical',
									status: 'open',
									triggeredAt: 6
								}
							]
						}),
						{ status: 200 }
					);
				}
				if (String(input).includes('/resolve')) {
					return new Response(
						JSON.stringify({
							ok: true,
							incidents: [
								{
									groupKey: 'docs-release',
									id: 'incident-1',
									kind: 'gate_failure',
									message:
										'candidate regressed or failed the active gate and should be investigated',
									notes: 'rolled back to prior lexical canary baseline',
									resolvedAt: 9,
									severity: 'critical',
									status: 'resolved',
									triggeredAt: 6
								}
							]
						}),
						{ status: 200 }
					);
				}
				return new Response(
					JSON.stringify({
						ok: true,
						incidents: [
							{
								groupKey: 'docs-release',
								id: 'incident-1',
								kind: 'handoff_stale',
								message:
									'approved canary -> stable handoff is stale and must be completed or re-approved',
								severity: 'critical',
								status: 'open',
								triggeredAt: 6
							}
						]
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/status/release')) {
				return new Response(
					JSON.stringify({
						ok: true,
						retrievalComparisons: {
							alerts: [
								{
									groupKey: 'docs-release',
									kind: 'handoff_auto_complete_stale_approval',
									latestRunId: 'run-1',
									message:
										'Auto-complete is enabled for docs-release:stable but the latest handoff approval is stale.',
									severity: 'warning'
								}
							],
							handoffAutoCompletePolicies: [
								{
									enabled: true,
									groupKey: 'docs-release',
									maxApprovedDecisionAgeMs: 60000,
									scope: 'group_target_rollout_label',
									targetRolloutLabel: 'stable'
								}
							],
							handoffAutoCompleteSafety: [
								{
									enabled: true,
									freshnessStatus: 'expired',
									groupKey: 'docs-release',
									reasons: [
										'latest approved handoff decision is older than the auto-complete policy allows'
									],
									safe: false,
									targetRolloutLabel: 'stable'
								}
							],
							handoffDriftRollups: [
								{
									count: 1,
									groupKeys: ['docs-release'],
									kind: 'handoff_auto_complete_stale_approval',
									remediationHints: [
										'Renew the handoff approval so it falls within the configured freshness window.'
									],
									severity: 'warning',
									targetRolloutLabel: 'stable'
								}
							],
							handoffDriftCountsByLane: [
								{
									targetRolloutLabel: 'stable',
									totalCount: 1,
									countsByKind: {
										handoff_auto_complete_policy_drift: 0,
										handoff_auto_complete_stale_approval: 1,
										handoff_auto_complete_source_lane_missing: 0,
										handoff_auto_complete_gate_blocked: 0,
										handoff_auto_complete_approval_missing: 0
									}
								}
							],
							recentHandoffAutoCompletePolicyHistory: [
								{
									changeKind: 'snapshot',
									enabled: true,
									groupKey: 'docs-release',
									id: 'handoff-policy-history-1',
									recordedAt: 10,
									targetRolloutLabel: 'stable'
								}
							],
							recentReleaseLanePolicyHistory: [
								{
									changeKind: 'snapshot',
									groupKey: 'docs-release',
									id: 'release-lane-policy-history-1',
									recordedAt: 11,
									rolloutLabel: 'stable',
									scope: 'group_rollout_label'
								}
							],
							recentBaselineGatePolicyHistory: [
								{
									changeKind: 'snapshot',
									id: 'gate-policy-history-1',
									recordedAt: 12,
									rolloutLabel: 'canary',
									scope: 'rollout_label'
								}
							],
							recentReleaseLaneEscalationPolicyHistory: [
								{
									changeKind: 'snapshot',
									groupKey: 'docs-release',
									id: 'escalation-policy-history-1',
									recordedAt: 13,
									targetRolloutLabel: 'stable'
								}
							],
							releaseLaneHandoffs: [
								{
									groupKey: 'docs-release',
									readyForHandoff: false,
									reasons: ['stable gate has not passed yet'],
									sourceRolloutLabel: 'canary',
									targetRolloutLabel: 'stable'
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			if (String(input).includes('/release-policies/history')) {
				return new Response(
					JSON.stringify({
						ok: true,
						records: [
							{
								approvalMaxAgeMs: 60000,
								changeKind: 'snapshot',
								groupKey: 'docs-release',
								id: 'release-lane-policy-history-1',
								recordedAt: 11,
								requireApprovalBeforePromotion: true,
								rolloutLabel: 'stable',
								scope: 'group_rollout_label'
							}
						]
					}),
					{ status: 200 }
				);
			}
			if (String(input).includes('/gate-policies/history')) {
				return new Response(
					JSON.stringify({
						ok: true,
						records: [
							{
								changeKind: 'snapshot',
								id: 'gate-policy-history-1',
								policy: {
									minPassingRateDelta: 0,
									severity: 'warn'
								},
								recordedAt: 12,
								rolloutLabel: 'canary',
								scope: 'rollout_label'
							}
						]
					}),
					{ status: 200 }
				);
			}
			if (String(input).includes('/escalation-policies/history')) {
				return new Response(
					JSON.stringify({
						ok: true,
						records: [
							{
								changeKind: 'snapshot',
								groupKey: 'docs-release',
								id: 'escalation-policy-history-1',
								recordedAt: 13,
								targetRolloutLabel: 'stable',
								openIncidentSeverity: 'critical',
								regressionSeverity: 'critical',
								gateFailureSeverity: 'critical',
								approvalExpiredSeverity: 'critical'
							}
						]
					}),
					{ status: 200 }
				);
			}
			if (String(input).includes('/incident-policies/history')) {
				return new Response(
					JSON.stringify({
						ok: true,
						records: [
							{
								changeKind: 'snapshot',
								groupKey: 'docs-release',
								id: 'incident-policy-history-1',
								recordedAt: 14,
								targetRolloutLabel: 'stable',
								openIncidentSeverity: 'critical',
								regressionSeverity: 'critical',
								gateFailureSeverity: 'critical',
								approvalExpiredSeverity: 'critical'
							}
						]
					}),
					{ status: 200 }
				);
			}
			if (String(input).includes('/incidents/remediations/execute')) {
				if (String(input).includes('/bulk')) {
					return new Response(
						JSON.stringify({
							ok: true,
							results: [
								{
									index: 0,
									ok: true,
									execution: {
										action: {
											kind: 'view_release_status',
											label: 'Inspect release readiness before deciding.',
											method: 'GET',
											path: '/rag/status/release'
										},
										code: 'release_status_loaded',
										idempotentReplay: false,
										followUpSteps: [
											{
												kind: 'review_readiness',
												label: 'Review the current release readiness and decide on the next operator action.'
											}
										],
										releaseStatus: {
											configured: true
										}
									}
								}
							]
						}),
						{ status: 200 }
					);
				}
				return new Response(
					JSON.stringify({
						ok: true,
						record: {
							decidedAt: 16,
							decidedBy: 'alex',
							groupKey: 'docs-release',
							id: 'incident-remediation-2',
							idempotencyKey: 'incident-ack-1',
							incidentId: 'incident-1',
							incidentKind: 'handoff_stale',
							remediationKind: 'review_readiness',
							status: 'applied',
							targetRolloutLabel: 'stable'
						},
						execution: {
							action: {
								kind: 'acknowledge_incident',
								label: 'Acknowledge this release incident.',
								method: 'POST',
								path: '/rag/compare/retrieval/incidents/acknowledge',
								payload: { incidentId: 'incident-1' }
							},
							code: 'incident_acknowledged',
							idempotentReplay: false,
							followUpSteps: [
								{
									kind: 'inspect_gate',
									label: 'Inspect the latest release or gate state before resolving the incident.'
								}
							],
							incidents: [
								{
									acknowledgedAt: 7,
									acknowledgedBy: 'alex',
									acknowledgementNotes:
										'triaged for follow-up',
									groupKey: 'docs-release',
									id: 'incident-1',
									kind: 'gate_failure',
									status: 'open'
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			if (
				String(input).includes('/incidents/remediations') &&
				!String(input).includes('/executions')
			) {
				return new Response(
					JSON.stringify({
						ok: true,
						records: [
							{
								action: {
									kind: 'approve_candidate',
									label: 'Record or renew approval for this candidate.',
									method: 'POST',
									path: '/rag/compare/retrieval/baselines/approve',
									payload: {
										candidateRetrievalId: 'lexical',
										groupKey: 'docs-release',
										sourceRunId: 'run-1',
										targetRolloutLabel: 'stable'
									}
								},
								decidedAt: 15,
								decidedBy: 'alex',
								groupKey: 'docs-release',
								id: 'incident-remediation-1',
								incidentId: 'incident-1',
								incidentKind: 'handoff_stale',
								notes: 'renew approval first',
								remediationKind: 'renew_approval',
								status: 'planned',
								targetRolloutLabel: 'stable'
							}
						]
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/approve')) {
				return new Response(
					JSON.stringify({
						ok: true,
						decisions: [
							{
								ageMs: 5,
								decidedAt: 4,
								decidedBy: 'alex',
								expiresAt: 14,
								freshnessStatus: 'fresh',
								groupKey: 'docs-release',
								id: 'decision-2',
								kind: 'approve',
								retrievalId: 'lexical',
								sourceRunId: 'run-1'
							}
						]
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/reject')) {
				return new Response(
					JSON.stringify({
						ok: true,
						decisions: [
							{
								decidedAt: 5,
								decidedBy: 'alex',
								groupKey: 'docs-release',
								id: 'decision-3',
								kind: 'reject',
								notes: 'candidate regressed',
								retrievalId: 'lexical',
								sourceRunId: 'run-2'
							}
						]
					}),
					{ status: 200 }
				);
			}

			if (String(input).includes('/promote')) {
				if (String(input).includes('/promote-lane')) {
					return new Response(
						JSON.stringify({
							ok: true,
							baseline: {
								approvedBy: 'alex',
								groupKey: 'docs-release',
								id: 'baseline-2',
								label: 'Lexical canary baseline',
								promotedAt: 2,
								retrievalId: 'lexical',
								rolloutLabel: 'canary'
							},
							rolloutState: {
								groupKey: 'docs-release',
								targetRolloutLabel: 'canary',
								ready: true,
								remediationActions: [
									'Monitor the active lane and verify post-promotion behavior.'
								],
								requiresApproval: false,
								reasons: [
									'baseline is active in the target rollout lane'
								]
							}
						}),
						{ status: 200 }
					);
				}
				return new Response(
					JSON.stringify({
						ok: true,
						baseline: {
							approvedBy: 'alex',
							groupKey: 'docs-release',
							id: 'baseline-1',
							label: 'Lexical release baseline',
							policy: { minAverageF1Delta: 0 },
							promotedAt: 1,
							retrievalId: 'lexical',
							rolloutLabel: 'stable',
							tags: ['docs', 'release']
						},
						rolloutState: {
							groupKey: 'docs-release',
							targetRolloutLabel: 'stable',
							ready: true,
							remediationActions: [
								'Monitor the active lane and verify post-promotion behavior.'
							],
							requiresApproval: true,
							reasons: [
								'baseline is active in the target rollout lane'
							]
						}
					}),
					{ status: 200 }
				);
			}

			return new Response(
				JSON.stringify({
					baselines: [
						{
							approvedBy: 'alex',
							groupKey: 'docs-release',
							id: 'baseline-1',
							label: 'Lexical release baseline',
							policy: { minAverageF1Delta: 0 },
							promotedAt: 1,
							retrievalId: 'lexical',
							rolloutLabel: 'stable',
							tags: ['docs', 'release']
						}
					],
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const baseline = await client.promoteRetrievalBaseline({
			approvedBy: 'alex',
			groupKey: 'docs-release',
			label: 'Lexical release baseline',
			policy: {
				minAverageF1Delta: 0
			},
			retrievalId: 'lexical',
			rolloutLabel: 'stable',
			tags: ['docs', 'release']
		});
		const detailedBaseline = await client.promoteRetrievalBaselineDetailed({
			approvedBy: 'alex',
			groupKey: 'docs-release',
			retrievalId: 'lexical',
			rolloutLabel: 'stable'
		});
		const canaryBaseline = await client.promoteRetrievalBaselineToLane({
			approvedBy: 'alex',
			groupKey: 'docs-release',
			retrievalId: 'lexical',
			rolloutLabel: 'canary'
		});
		const detailedCanaryBaseline =
			await client.promoteRetrievalBaselineToLaneDetailed({
				approvedBy: 'alex',
				groupKey: 'docs-release',
				retrievalId: 'lexical',
				rolloutLabel: 'canary'
			});
		const baselines = await client.retrievalBaselines({
			groupKey: 'docs-release',
			limit: 5,
			status: 'active',
			tag: 'release'
		});
		const baselineFromRun = await client.promoteRetrievalBaselineFromRun({
			approvedBy: 'alex',
			groupKey: 'docs-release',
			sourceRunId: 'run-1'
		});
		const detailedBaselineFromRun =
			await client.promoteRetrievalBaselineFromRunDetailed({
				approvedBy: 'alex',
				groupKey: 'docs-release',
				sourceRunId: 'run-1'
			});
		const revertedBaseline = await client.revertRetrievalBaseline({
			approvedBy: 'alex',
			groupKey: 'docs-release',
			version: 2
		});
		const decisions = await client.retrievalBaselineDecisions({
			freshnessStatus: 'not_applicable',
			groupKey: 'docs-release',
			kind: 'revert',
			limit: 3,
			targetRolloutLabel: 'stable'
		});
		const candidates = await client.retrievalPromotionCandidates({
			approved: false,
			blocked: true,
			groupKey: 'docs-release',
			limit: 2,
			ready: false,
			freshnessStatus: 'expired',
			reviewStatus: 'needs_review',
			sortBy: 'priority',
			sortDirection: 'desc',
			tag: 'release',
			targetRolloutLabel: 'stable'
		});
		const groupHistory = await client.retrievalReleaseGroupHistory({
			targetRolloutLabel: 'canary',
			groupKey: 'docs-release',
			decisionLimit: 5,
			baselineLimit: 4,
			runLimit: 3
		});
		const handoffs = await client.retrievalLaneHandoffs({
			groupKey: 'docs-release',
			sourceRolloutLabel: 'canary',
			targetRolloutLabel: 'stable',
			limit: 2
		});
		const handoffDecisions = await client.retrievalLaneHandoffDecisions({
			groupKey: 'docs-release',
			sourceRolloutLabel: 'canary',
			targetRolloutLabel: 'stable',
			kind: 'reject',
			limit: 2
		});
		const handoffDecision = await client.decideRetrievalLaneHandoff({
			decidedBy: 'alex',
			groupKey: 'docs-release',
			kind: 'reject',
			notes: 'stable handoff is blocked until gate and approval pass',
			sourceRolloutLabel: 'canary',
			targetRolloutLabel: 'stable'
		});
		const detailedHandoffDecision =
			await client.decideRetrievalLaneHandoffDetailed({
				decidedBy: 'alex',
				executePromotion: true,
				groupKey: 'docs-release',
				kind: 'complete',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable'
			});
		const handoffIncidents = await client.retrievalLaneHandoffIncidents({
			groupKey: 'docs-release',
			limit: 2,
			status: 'open',
			severity: 'critical',
			targetRolloutLabel: 'stable'
		});
		const handoffPolicyHistory =
			await client.retrievalLaneHandoffAutoCompletePolicyHistory({
				groupKey: 'docs-release',
				limit: 2,
				targetRolloutLabel: 'stable'
			});
		const releaseLanePolicyHistory =
			await client.retrievalReleaseLanePolicyHistory({
				groupKey: 'docs-release',
				limit: 2,
				rolloutLabel: 'stable',
				scope: 'group_rollout_label'
			});
		const baselineGatePolicyHistory =
			await client.retrievalBaselineGatePolicyHistory({
				limit: 2,
				rolloutLabel: 'canary',
				scope: 'rollout_label'
			});
		const escalationPolicyHistory =
			await client.retrievalReleaseLaneEscalationPolicyHistory({
				groupKey: 'docs-release',
				limit: 2,
				targetRolloutLabel: 'stable'
			});
		const incidentPolicyHistory =
			await client.retrievalReleaseIncidentPolicyHistory({
				groupKey: 'docs-release',
				limit: 2,
				targetRolloutLabel: 'stable'
			});
		const handoffIncidentHistory =
			await client.retrievalLaneHandoffIncidentHistory({
				action: 'resolved',
				groupKey: 'docs-release',
				incidentId: 'handoff-incident-1',
				limit: 2,
				targetRolloutLabel: 'stable'
			});
		const acknowledgedHandoffIncidents =
			await client.acknowledgeRetrievalLaneHandoffIncident({
				acknowledgedBy: 'alex',
				acknowledgementNotes: 'triaged for stable handoff follow-up',
				incidentId: 'handoff-incident-1'
			});
		const unacknowledgedHandoffIncidents =
			await client.unacknowledgeRetrievalLaneHandoffIncident({
				incidentId: 'handoff-incident-1'
			});
		const resolvedHandoffIncidents =
			await client.resolveRetrievalLaneHandoffIncident({
				incidentId: 'handoff-incident-1',
				resolutionNotes: 'stable handoff triaged after rollback',
				resolvedBy: 'alex'
			});
		const incidents = await client.retrievalReleaseIncidents({
			acknowledged: false,
			groupKey: 'docs-release',
			kind: 'handoff_stale',
			limit: 2,
			severity: 'critical',
			status: 'open',
			targetRolloutLabel: 'stable'
		});
		const incidentRemediations =
			await client.retrievalIncidentRemediationDecisions({
				incidentId: 'incident-1',
				limit: 2,
				status: 'planned',
				targetRolloutLabel: 'stable'
			});
		const recordedIncidentRemediations =
			await client.recordRetrievalIncidentRemediationDecision({
				decidedBy: 'alex',
				incidentId: 'incident-1',
				notes: 'renew approval first',
				remediationKind: 'renew_approval',
				status: 'planned',
				action: {
					kind: 'approve_candidate',
					label: 'Record or renew approval for this candidate.',
					method: 'POST',
					path: '/rag/compare/retrieval/baselines/approve',
					payload: {
						candidateRetrievalId: 'lexical',
						groupKey: 'docs-release',
						sourceRunId: 'run-1',
						targetRolloutLabel: 'stable'
					}
				}
			});
		const executedIncidentRemediation =
			await client.executeRetrievalIncidentRemediation({
				action: {
					kind: 'acknowledge_incident',
					label: 'Acknowledge this release incident.',
					method: 'POST',
					path: '/rag/compare/retrieval/incidents/acknowledge',
					payload: { incidentId: 'incident-1' }
				},
				decidedBy: 'alex',
				incidentId: 'incident-1',
				idempotencyKey: 'incident-ack-1',
				notes: 'triaged via remediation execution',
				persistDecision: true,
				remediationKind: 'review_readiness'
			});
		const bulkExecutedIncidentRemediations =
			await client.bulkExecuteRetrievalIncidentRemediations({
				allowMutationExecution: true,
				items: [
					{
						action: {
							kind: 'view_release_status',
							label: 'Inspect release readiness before deciding.',
							method: 'GET',
							path: '/rag/status/release'
						},
						incidentId: 'incident-1',
						remediationKind: 'review_readiness'
					}
				]
			});
		const acknowledgedIncidents =
			await client.acknowledgeRetrievalReleaseIncident({
				acknowledgedBy: 'alex',
				acknowledgementNotes: 'triaged for follow-up',
				incidentId: 'incident-1'
			});
		const unacknowledgedIncidents =
			await client.unacknowledgeRetrievalReleaseIncident({
				incidentId: 'incident-1'
			});
		const resolvedIncidents = await client.resolveRetrievalReleaseIncident({
			incidentId: 'incident-1',
			resolutionNotes: 'rolled back to prior lexical canary baseline',
			resolvedBy: 'alex'
		});
		const approvals = await client.approveRetrievalCandidate({
			decidedBy: 'alex',
			groupKey: 'docs-release',
			sourceRunId: 'run-1',
			targetRolloutLabel: 'stable'
		});
		const rejections = await client.rejectRetrievalCandidate({
			decidedBy: 'alex',
			groupKey: 'docs-release',
			notes: 'candidate regressed',
			sourceRunId: 'run-2',
			targetRolloutLabel: 'canary'
		});

		expect(baseline).toEqual(
			expect.objectContaining({
				approvedBy: 'alex',
				groupKey: 'docs-release',
				rolloutLabel: 'stable',
				retrievalId: 'lexical'
			})
		);
		expect(canaryBaseline).toEqual(
			expect.objectContaining({
				retrievalId: 'lexical',
				rolloutLabel: 'canary'
			})
		);
		expect(detailedBaseline.rolloutState).toEqual(
			expect.objectContaining({
				ready: true,
				remediationActions: expect.arrayContaining([
					expect.stringContaining('Monitor')
				]),
				requiresApproval: true,
				targetRolloutLabel: 'stable'
			})
		);
		expect(detailedCanaryBaseline.rolloutState).toEqual(
			expect.objectContaining({
				ready: true,
				remediationActions: expect.arrayContaining([
					expect.stringContaining('Monitor')
				]),
				requiresApproval: false,
				targetRolloutLabel: 'canary'
			})
		);
		expect(baselines[0]).toEqual(
			expect.objectContaining({
				approvedBy: 'alex',
				groupKey: 'docs-release',
				retrievalId: 'lexical'
			})
		);
		expect(baselineFromRun).toEqual(
			expect.objectContaining({
				retrievalId: 'lexical',
				sourceRunId: 'run-1',
				version: 2
			})
		);
		expect(detailedBaselineFromRun.rolloutState).toEqual(
			expect.objectContaining({
				remediationActions: expect.arrayContaining([
					expect.stringContaining('Monitor')
				]),
				targetRolloutLabel: 'stable'
			})
		);
		expect(revertedBaseline).toEqual(
			expect.objectContaining({
				retrievalId: 'lexical',
				version: 3
			})
		);
		expect(decisions[0]).toEqual(
			expect.objectContaining({
				kind: 'revert',
				freshnessStatus: 'not_applicable',
				retrievalId: 'lexical'
			})
		);
		expect(candidates[0]).toEqual(
			expect.objectContaining({
				approvalFreshnessStatus: 'expired',
				candidateRetrievalId: 'lexical',
				delta: expect.objectContaining({
					averageF1Delta: -0.2,
					passingRateDelta: -0.5
				}),
				effectiveBaselineGatePolicy: expect.objectContaining({
					minPassingRateDelta: 1,
					severity: 'fail'
				}),
				effectiveReleasePolicy: expect.objectContaining({
					approvalMaxAgeMs: 60_000,
					requireApprovalBeforePromotion: true
				}),
				priority: 'needs_review',
				priorityScore: 4,
				releaseVerdictStatus: 'fail',
				ready: false,
				requiresApproval: true,
				reviewStatus: 'needs_review',
				sortReason: 'candidate approval expired and needs review',
				targetRolloutLabel: 'stable'
			})
		);
		expect(groupHistory.timeline).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				latestDecisionKind: 'reject'
			})
		);
		expect(handoffs[0]).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable'
			})
		);
		expect(handoffDecisions[0]).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				kind: 'reject',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable'
			})
		);
		expect(handoffDecision).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				kind: 'reject',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable'
			})
		);
		expect(detailedHandoffDecision).toEqual(
			expect.objectContaining({
				baseline: expect.objectContaining({
					retrievalId: 'lexical',
					rolloutLabel: 'stable'
				}),
				decision: expect.objectContaining({
					groupKey: 'docs-release'
				}),
				ok: true,
				rolloutState: expect.objectContaining({
					remediationActions: expect.arrayContaining([
						expect.stringContaining('approval')
					]),
					remediationSteps: expect.arrayContaining([
						expect.objectContaining({
							kind: 'renew_approval',
							actions: expect.arrayContaining([
								expect.objectContaining({
									kind: expect.any(String),
									path: expect.any(String)
								})
							])
						})
					]),
					targetRolloutLabel: 'stable'
				})
			})
		);
		expect(incidents[0]).toEqual(
			expect.objectContaining({
				kind: 'handoff_stale',
				severity: 'critical'
			})
		);
		expect(incidentRemediations[0]).toEqual(
			expect.objectContaining({
				incidentId: 'incident-1',
				remediationKind: 'renew_approval',
				status: 'planned'
			})
		);
		expect(recordedIncidentRemediations[0]).toEqual(
			expect.objectContaining({
				decidedBy: 'alex',
				remediationKind: 'renew_approval',
				status: 'planned'
			})
		);
		expect(executedIncidentRemediation).toEqual(
			expect.objectContaining({
				record: expect.objectContaining({
					decidedBy: 'alex',
					remediationKind: 'review_readiness',
					status: 'applied'
				}),
				execution: expect.objectContaining({
					action: expect.objectContaining({
						kind: 'acknowledge_incident'
					}),
					code: 'incident_acknowledged',
					idempotentReplay: false,
					followUpSteps: expect.arrayContaining([
						expect.objectContaining({
							kind: 'inspect_gate'
						})
					]),
					incidents: expect.arrayContaining([
						expect.objectContaining({
							acknowledgedBy: 'alex',
							id: 'incident-1'
						})
					])
				})
			})
		);
		expect(bulkExecutedIncidentRemediations[0]).toEqual(
			expect.objectContaining({
				index: 0,
				ok: true,
				execution: expect.objectContaining({
					code: 'release_status_loaded',
					idempotentReplay: false,
					followUpSteps: expect.arrayContaining([
						expect.objectContaining({
							kind: 'review_readiness'
						})
					]),
					releaseStatus: expect.objectContaining({
						configured: true
					})
				})
			})
		);
		expect(handoffIncidents[0]).toEqual(
			expect.objectContaining({
				kind: 'handoff_stale',
				targetRolloutLabel: 'stable'
			})
		);
		expect(handoffPolicyHistory[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-release',
				targetRolloutLabel: 'stable'
			})
		);
		expect(releaseLanePolicyHistory[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-release',
				rolloutLabel: 'stable',
				scope: 'group_rollout_label'
			})
		);
		expect(baselineGatePolicyHistory[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				rolloutLabel: 'canary',
				scope: 'rollout_label'
			})
		);
		expect(escalationPolicyHistory[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-release',
				targetRolloutLabel: 'stable'
			})
		);
		expect(incidentPolicyHistory[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-release',
				targetRolloutLabel: 'stable'
			})
		);
		expect(handoffIncidentHistory[0]).toEqual(
			expect.objectContaining({
				action: 'resolved',
				incidentId: 'handoff-incident-1',
				targetRolloutLabel: 'stable'
			})
		);
		expect(acknowledgedHandoffIncidents[0]).toEqual(
			expect.objectContaining({
				acknowledgedBy: 'alex',
				id: 'handoff-incident-1',
				kind: 'handoff_stale'
			})
		);
		expect(unacknowledgedHandoffIncidents[0]).toEqual(
			expect.objectContaining({
				id: 'handoff-incident-1',
				status: 'open'
			})
		);
		expect(resolvedHandoffIncidents[0]).toEqual(
			expect.objectContaining({
				id: 'handoff-incident-1',
				notes: 'stable handoff triaged after rollback',
				status: 'resolved'
			})
		);
		expect(acknowledgedIncidents[0]).toEqual(
			expect.objectContaining({
				acknowledgedBy: 'alex',
				acknowledgementNotes: 'triaged for follow-up',
				id: 'incident-1'
			})
		);
		expect(unacknowledgedIncidents[0]).toEqual(
			expect.objectContaining({
				id: 'incident-1',
				status: 'open'
			})
		);
		expect(resolvedIncidents[0]).toEqual(
			expect.objectContaining({
				id: 'incident-1',
				notes: 'rolled back to prior lexical canary baseline',
				status: 'resolved'
			})
		);
		expect(approvals[0]).toEqual(
			expect.objectContaining({
				kind: 'approve',
				retrievalId: 'lexical'
			})
		);
		expect(rejections[0]).toEqual(
			expect.objectContaining({
				kind: 'reject',
				notes: 'candidate regressed',
				retrievalId: 'lexical'
			})
		);
		expect(calls[0]?.input).toBe(
			'/rag/compare/retrieval/baselines/promote'
		);
		expect(calls[0]?.method).toBe('POST');
		expect(calls[1]?.input).toBe(
			'/rag/compare/retrieval/baselines/promote'
		);
		expect(calls[1]?.method).toBe('POST');
		expect(calls[2]?.input).toBe(
			'/rag/compare/retrieval/baselines/promote-lane'
		);
		expect(calls[2]?.method).toBe('POST');
		expect(calls[3]?.input).toBe(
			'/rag/compare/retrieval/baselines/promote-lane'
		);
		expect(calls[3]?.method).toBe('POST');
		expect(calls[4]?.input).toBe(
			'/rag/compare/retrieval/baselines?groupKey=docs-release&tag=release&limit=5&status=active'
		);
		expect(calls[5]?.input).toBe(
			'/rag/compare/retrieval/baselines/promote-run'
		);
		expect(calls[5]?.method).toBe('POST');
		expect(calls[6]?.input).toBe(
			'/rag/compare/retrieval/baselines/promote-run'
		);
		expect(calls[6]?.method).toBe('POST');
		expect(calls[7]?.input).toBe('/rag/compare/retrieval/baselines/revert');
		expect(calls[7]?.method).toBe('POST');
		expect(calls[8]?.input).toBe(
			'/rag/compare/retrieval/baselines/decisions?groupKey=docs-release&limit=3&kind=revert&freshnessStatus=not_applicable&targetRolloutLabel=stable'
		);
		expect(calls[9]?.input).toBe(
			'/rag/compare/retrieval/candidates?groupKey=docs-release&limit=2&tag=release&targetRolloutLabel=stable&approved=false&ready=false&blocked=true&reviewStatus=needs_review&freshnessStatus=expired&sortBy=priority&sortDirection=desc'
		);
		expect(calls[10]?.input).toBe(
			'/rag/compare/retrieval/release-history?groupKey=docs-release&decisionLimit=5&baselineLimit=4&runLimit=3&targetRolloutLabel=canary'
		);
		expect(calls[11]?.input).toBe(
			'/rag/compare/retrieval/handoffs?groupKey=docs-release&sourceRolloutLabel=canary&targetRolloutLabel=stable&limit=2'
		);
		expect(calls[12]?.input).toBe(
			'/rag/compare/retrieval/handoffs/decisions?groupKey=docs-release&sourceRolloutLabel=canary&targetRolloutLabel=stable&kind=reject&limit=2'
		);
		expect(calls[13]?.input).toBe('/rag/compare/retrieval/handoffs/decide');
		expect(calls[13]?.method).toBe('POST');
		expect(calls[14]?.input).toBe('/rag/compare/retrieval/handoffs/decide');
		expect(calls[14]?.method).toBe('POST');
		expect(calls[15]?.input).toBe(
			'/rag/compare/retrieval/handoffs/incidents?groupKey=docs-release&limit=2&status=open&severity=critical&targetRolloutLabel=stable'
		);
		expect(calls[16]?.input).toBe(
			'/rag/compare/retrieval/handoffs/policies/history?groupKey=docs-release&limit=2&targetRolloutLabel=stable'
		);
		expect(calls[17]?.input).toBe(
			'/rag/compare/retrieval/release-policies/history?groupKey=docs-release&limit=2&rolloutLabel=stable&scope=group_rollout_label'
		);
		expect(calls[18]?.input).toBe(
			'/rag/compare/retrieval/gate-policies/history?limit=2&rolloutLabel=canary&scope=rollout_label'
		);
		expect(calls[19]?.input).toBe(
			'/rag/compare/retrieval/escalation-policies/history?groupKey=docs-release&limit=2&targetRolloutLabel=stable'
		);
		expect(calls[20]?.input).toBe(
			'/rag/compare/retrieval/incident-policies/history?groupKey=docs-release&limit=2&targetRolloutLabel=stable'
		);
		expect(calls[21]?.input).toBe(
			'/rag/compare/retrieval/handoffs/incidents/history?action=resolved&groupKey=docs-release&incidentId=handoff-incident-1&limit=2&targetRolloutLabel=stable'
		);
		expect(calls[22]?.input).toBe(
			'/rag/compare/retrieval/handoffs/incidents/acknowledge'
		);
		expect(calls[22]?.method).toBe('POST');
		expect(calls[23]?.input).toBe(
			'/rag/compare/retrieval/handoffs/incidents/unacknowledge'
		);
		expect(calls[23]?.method).toBe('POST');
		expect(calls[24]?.input).toBe(
			'/rag/compare/retrieval/handoffs/incidents/resolve'
		);
		expect(calls[24]?.method).toBe('POST');
		expect(calls[25]?.input).toBe(
			'/rag/compare/retrieval/incidents?groupKey=docs-release&limit=2&status=open&severity=critical&kind=handoff_stale&acknowledged=false&targetRolloutLabel=stable'
		);
		expect(calls[26]?.input).toBe(
			'/rag/compare/retrieval/incidents/remediations?incidentId=incident-1&limit=2&status=planned&targetRolloutLabel=stable'
		);
		expect(calls[27]?.input).toBe(
			'/rag/compare/retrieval/incidents/remediations'
		);
		expect(calls[27]?.method).toBe('POST');
		expect(calls[28]?.input).toBe(
			'/rag/compare/retrieval/incidents/remediations/execute'
		);
		expect(calls[28]?.method).toBe('POST');
		expect(calls[29]?.input).toBe(
			'/rag/compare/retrieval/incidents/remediations/execute/bulk'
		);
		expect(calls[29]?.method).toBe('POST');
		expect(calls[30]?.input).toBe(
			'/rag/compare/retrieval/incidents/acknowledge'
		);
		expect(calls[30]?.method).toBe('POST');
		expect(calls[31]?.input).toBe(
			'/rag/compare/retrieval/incidents/unacknowledge'
		);
		expect(calls[31]?.method).toBe('POST');
		expect(calls[32]?.input).toBe(
			'/rag/compare/retrieval/incidents/resolve'
		);
		expect(calls[32]?.method).toBe('POST');
		expect(calls[33]?.input).toBe(
			'/rag/compare/retrieval/baselines/approve'
		);
		expect(calls[33]?.method).toBe('POST');
		expect(calls[34]?.input).toBe(
			'/rag/compare/retrieval/baselines/reject'
		);
		expect(calls[34]?.method).toBe('POST');
	});

	it('loads and persists adaptive native planner benchmark governance routes through the client', async () => {
		const calls: Array<{
			input: RequestInfo | URL;
			method?: string;
			body?: string;
		}> = [];
		const client = createRAGClient({
			fetch: (async (input, init) => {
				calls.push({
					body:
						typeof init?.body === 'string' ? init.body : undefined,
					input,
					method: init?.method
				});

				if (
					String(input).includes(
						'/benchmarks/native-backend-comparison/run'
					)
				) {
					return new Response(
						JSON.stringify({
							fixtureVariants: ['current-collection'],
							comparison: {
								caseCount: 1,
								results: []
							},
							groupKey: 'runtime-native-backend-parity',
							historyPresentation: {
								recentRuns: [],
								rows: [],
								summary: '1 recent runs'
							},
							latestRun: {
								id: 'backend-run-1'
							},
							latestFixtureVariant: 'current-collection',
							ok: true,
							recentRuns: [{ id: 'backend-run-1' }],
							suite: {
								id: 'rag-native-backend-larger-corpus',
								label: 'Native Backend Comparison Benchmark'
							}
						}),
						{ status: 200 }
					);
				}

				if (
					String(input).includes(
						'/benchmarks/native-backend-comparison/snapshots'
					)
				) {
					return new Response(
						JSON.stringify({
							ok: true,
							snapshot: {
								id: 'backend-snapshot-2',
								version: 2
							},
							snapshotHistoryPresentation: {
								rows: [],
								snapshots: [
									{
										id: 'backend-snapshot-2',
										label: 'Native Backend Comparison Benchmark',
										rows: [],
										summary: 'v2 · 1 cases',
										version: 2
									}
								],
								summary: 'v2'
							},
							suite: {
								id: 'rag-native-backend-larger-corpus',
								label: 'Native Backend Comparison Benchmark'
							}
						}),
						{ status: 200 }
					);
				}

				if (
					String(input).includes(
						'/benchmarks/native-backend-comparison'
					)
				) {
					return new Response(
						JSON.stringify({
							groupKey: 'runtime-native-backend-parity',
							ok: true,
							snapshotHistoryPresentation: {
								rows: [],
								snapshots: [],
								summary: 'No saved suite snapshots yet.'
							},
							suite: {
								id: 'rag-native-backend-larger-corpus',
								label: 'Native Backend Comparison Benchmark'
							}
						}),
						{ status: 200 }
					);
				}

				if (
					String(input).includes(
						'/benchmarks/adaptive-native-planner/run'
					)
				) {
					return new Response(
						JSON.stringify({
							fixtureVariants: ['current-collection'],
							comparison: {
								caseCount: 1,
								results: []
							},
							groupKey: 'runtime-native-planner',
							historyPresentation: {
								recentRuns: [],
								rows: [],
								summary: '1 recent runs'
							},
							latestRun: {
								id: 'run-1'
							},
							latestFixtureVariant: 'current-collection',
							ok: true,
							recentRuns: [{ id: 'run-1' }],
							suite: {
								id: 'rag-native-planner-larger-corpus',
								label: 'Adaptive Native Planner Benchmark'
							}
						}),
						{ status: 200 }
					);
				}

				if (
					String(input).includes(
						'/benchmarks/adaptive-native-planner/snapshots'
					)
				) {
					return new Response(
						JSON.stringify({
							ok: true,
							snapshot: {
								id: 'snapshot-2',
								version: 2
							},
							snapshotHistoryPresentation: {
								rows: [],
								snapshots: [
									{
										id: 'snapshot-2',
										label: 'Adaptive Native Planner Benchmark',
										rows: [],
										summary: 'v2 · 1 cases',
										version: 2
									}
								],
								summary: 'v2'
							},
							suite: {
								id: 'rag-native-planner-larger-corpus',
								label: 'Adaptive Native Planner Benchmark'
							}
						}),
						{ status: 200 }
					);
				}

				if (
					String(input).includes(
						'/benchmarks/adaptive-native-planner'
					)
				) {
					return new Response(
						JSON.stringify({
							groupKey: 'runtime-native-planner',
							ok: true,
							snapshotHistoryPresentation: {
								rows: [],
								snapshots: [],
								summary: 'No saved suite snapshots yet.'
							},
							suite: {
								id: 'rag-native-planner-larger-corpus',
								label: 'Adaptive Native Planner Benchmark'
							}
						}),
						{ status: 200 }
					);
				}

				if (String(input).includes('/release-history')) {
					return new Response(
						JSON.stringify({
							ok: true,
							groupKey: 'docs-release',
							presentation: {
								recentRuns: [],
								rows: [],
								summary: 'revert · 1 recent runs'
							},
							adaptiveNativePlannerBenchmark: {
								suiteId: 'rag-native-planner-larger-corpus'
							}
						}),
						{ status: 200 }
					);
				}

				return new Response(JSON.stringify({ ok: true }), {
					status: 200
				});
			}) as typeof fetch,
			path: '/rag'
		});

		const groupHistory = await client.retrievalReleaseGroupHistory({
			benchmarkLimit: 2,
			groupKey: 'docs-release'
		});
		const benchmark = await client.adaptiveNativePlannerBenchmark({
			corpusGroupKey: 'docs',
			description: 'runtime planner proof',
			groupKey: 'runtime-native-planner',
			label: 'Planner Benchmark',
			limit: 3,
			runLimit: 2
		});
		const benchmarkRun = await client.runAdaptiveNativePlannerBenchmark({
			corpusGroupKey: 'docs',
			description: 'runtime planner proof',
			groupKey: 'runtime-native-planner',
			limit: 2,
			persistRun: true,
			runLimit: 3,
			topK: 1
		});
		const backendBenchmark = await client.nativeBackendComparisonBenchmark({
			corpusGroupKey: 'docs',
			groupKey: 'runtime-native-backend-parity',
			limit: 3,
			runLimit: 2
		});
		const backendBenchmarkRun =
			await client.runNativeBackendComparisonBenchmark({
				corpusGroupKey: 'docs',
				groupKey: 'runtime-native-backend-parity',
				limit: 2,
				persistRun: true,
				runLimit: 3,
				topK: 1
			});
		const savedSnapshot =
			await client.saveAdaptiveNativePlannerBenchmarkSnapshot({
				createdAt: 123,
				description: 'runtime planner proof',
				label: 'Planner Benchmark',
				limit: 4,
				metadata: { scope: 'runtime' },
				snapshotMetadata: { persistedBy: 'alex' },
				version: 2
			});
		const savedBackendSnapshot =
			await client.saveNativeBackendComparisonBenchmarkSnapshot({
				createdAt: 321,
				description: 'backend parity proof',
				label: 'Backend Benchmark',
				limit: 4,
				metadata: { scope: 'backend' },
				snapshotMetadata: { persistedBy: 'alex' },
				version: 2
			});

		expect(groupHistory).toEqual(
			expect.objectContaining({
				adaptiveNativePlannerBenchmark: expect.objectContaining({
					suiteId: 'rag-native-planner-larger-corpus'
				}),
				groupKey: 'docs-release',
				presentation: expect.objectContaining({
					summary: 'revert · 1 recent runs'
				})
			})
		);
		expect(benchmark).toEqual(
			expect.objectContaining({
				groupKey: 'runtime-native-planner',
				snapshotHistoryPresentation: expect.objectContaining({
					summary: 'No saved suite snapshots yet.'
				}),
				suite: expect.objectContaining({
					id: 'rag-native-planner-larger-corpus'
				})
			})
		);
		expect(benchmarkRun).toEqual(
			expect.objectContaining({
				fixtureVariants: ['current-collection'],
				groupKey: 'runtime-native-planner',
				historyPresentation: expect.objectContaining({
					summary: '1 recent runs'
				}),
				latestFixtureVariant: 'current-collection',
				latestRun: expect.objectContaining({
					id: 'run-1'
				}),
				suite: expect.objectContaining({
					id: 'rag-native-planner-larger-corpus'
				})
			})
		);
		expect(backendBenchmark).toEqual(
			expect.objectContaining({
				groupKey: 'runtime-native-backend-parity',
				snapshotHistoryPresentation: expect.objectContaining({
					summary: 'No saved suite snapshots yet.'
				}),
				suite: expect.objectContaining({
					id: 'rag-native-backend-larger-corpus'
				})
			})
		);
		expect(backendBenchmarkRun).toEqual(
			expect.objectContaining({
				fixtureVariants: ['current-collection'],
				groupKey: 'runtime-native-backend-parity',
				historyPresentation: expect.objectContaining({
					summary: '1 recent runs'
				}),
				latestFixtureVariant: 'current-collection',
				latestRun: expect.objectContaining({
					id: 'backend-run-1'
				}),
				suite: expect.objectContaining({
					id: 'rag-native-backend-larger-corpus'
				})
			})
		);
		expect(savedSnapshot).toEqual(
			expect.objectContaining({
				snapshot: expect.objectContaining({ version: 2 }),
				snapshotHistoryPresentation: expect.objectContaining({
					summary: 'v2'
				}),
				suite: expect.objectContaining({
					id: 'rag-native-planner-larger-corpus'
				})
			})
		);
		expect(savedBackendSnapshot).toEqual(
			expect.objectContaining({
				snapshot: expect.objectContaining({ version: 2 }),
				snapshotHistoryPresentation: expect.objectContaining({
					summary: 'v2'
				}),
				suite: expect.objectContaining({
					id: 'rag-native-backend-larger-corpus'
				})
			})
		);
		expect(calls[0]?.input).toBe(
			'/rag/compare/retrieval/release-history?groupKey=docs-release&benchmarkLimit=2'
		);
		expect(calls[1]?.input).toBe(
			'/rag/compare/retrieval/benchmarks/adaptive-native-planner?limit=3&runLimit=2&label=Planner+Benchmark&description=runtime+planner+proof&benchmarkGroupKey=runtime-native-planner&benchmarkCorpusGroupKey=docs'
		);
		expect(calls[2]?.input).toBe(
			'/rag/compare/retrieval/benchmarks/adaptive-native-planner/run'
		);
		expect(calls[2]?.method).toBe('POST');
		expect(JSON.parse(calls[2]?.body ?? '{}')).toEqual({
			baselineRetrievalId: undefined,
			candidateRetrievalId: undefined,
			corpusGroupKey: 'docs',
			description: 'runtime planner proof',
			groupKey: 'runtime-native-planner',
			label: undefined,
			limit: 2,
			metadata: undefined,
			persistRun: true,
			retrievals: undefined,
			runLimit: 3,
			tags: undefined,
			topK: 1
		});
		expect(calls[3]?.input).toBe(
			'/rag/compare/retrieval/benchmarks/native-backend-comparison?limit=3&runLimit=2&benchmarkGroupKey=runtime-native-backend-parity&benchmarkCorpusGroupKey=docs'
		);
		expect(calls[4]?.input).toBe(
			'/rag/compare/retrieval/benchmarks/native-backend-comparison/run'
		);
		expect(calls[4]?.method).toBe('POST');
		expect(JSON.parse(calls[4]?.body ?? '{}')).toEqual({
			baselineRetrievalId: undefined,
			candidateRetrievalId: undefined,
			corpusGroupKey: 'docs',
			description: undefined,
			groupKey: 'runtime-native-backend-parity',
			label: undefined,
			limit: 2,
			metadata: undefined,
			persistRun: true,
			retrievals: undefined,
			runLimit: 3,
			tags: undefined,
			topK: 1
		});
		expect(calls[5]?.input).toBe(
			'/rag/compare/retrieval/benchmarks/adaptive-native-planner/snapshots'
		);
		expect(calls[5]?.method).toBe('POST');
		expect(JSON.parse(calls[5]?.body ?? '{}')).toEqual({
			createdAt: 123,
			description: 'runtime planner proof',
			label: 'Planner Benchmark',
			limit: 4,
			metadata: { scope: 'runtime' },
			snapshotMetadata: { persistedBy: 'alex' },
			version: 2
		});
		expect(calls[6]?.input).toBe(
			'/rag/compare/retrieval/benchmarks/native-backend-comparison/snapshots'
		);
		expect(calls[6]?.method).toBe('POST');
		expect(JSON.parse(calls[6]?.body ?? '{}')).toEqual({
			createdAt: 321,
			description: 'backend parity proof',
			label: 'Backend Benchmark',
			limit: 4,
			metadata: { scope: 'backend' },
			snapshotMetadata: { persistedBy: 'alex' },
			version: 2
		});
	});

	it('surfaces ingest errors as structured responses', async () => {
		const fetchMock = (async () =>
			new Response(JSON.stringify({ error: 'bad ingest' }), {
				status: 400
			})) as unknown as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.ingest([{ chunkId: 'a', text: 'hello' }]);
		expect(response).toEqual({
			error: 'bad ingest',
			ok: false
		});
	});

	it('posts document ingest payloads to the workflow endpoint', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/ingest');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({
					documents: [
						{
							source: 'notes/demo.md',
							text: '# Demo\n\nAbsoluteJS retrieval workflow.'
						}
					]
				})
			);

			return new Response(
				JSON.stringify({
					count: 2,
					documentCount: 1,
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.ingestDocuments({
			documents: [
				{
					source: 'notes/demo.md',
					text: '# Demo\n\nAbsoluteJS retrieval workflow.'
				}
			]
		});
		expect(response).toEqual({
			count: 2,
			documentCount: 1,
			ok: true
		});
	});

	it('posts URL ingest payloads to the workflow endpoint', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/ingest');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({
					urls: [
						{
							url: 'https://example.com/guide.md'
						}
					]
				})
			);

			return new Response(
				JSON.stringify({
					count: 1,
					documentCount: 1,
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.ingestUrls({
			urls: [{ url: 'https://example.com/guide.md' }]
		});
		expect(response).toEqual({
			count: 1,
			documentCount: 1,
			ok: true
		});
	});

	it('posts upload ingest payloads to the workflow endpoint', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/ingest');
			expect(init?.method).toBe('POST');
			expect(JSON.parse(init?.body as string)).toEqual({
				baseMetadata: { source: 'upload' },
				uploads: [
					{
						content: 'hello',
						encoding: 'utf8',
						name: 'notes.txt'
					}
				]
			});

			return new Response(
				JSON.stringify({
					count: 1,
					documentCount: 1,
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.ingestUploads({
			baseMetadata: { source: 'upload' },
			uploads: [
				{
					content: 'hello',
					encoding: 'utf8',
					name: 'notes.txt'
				}
			]
		});
		expect(response).toEqual({
			count: 1,
			documentCount: 1,
			ok: true
		});
	});

	it('loads status from the workflow endpoint', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/status');

			return new Response(
				JSON.stringify({
					capabilities: {
						backend: 'sqlite',
						nativeVectorSearch: false,
						persistence: 'embedded',
						serverSideFiltering: false,
						streamingIngestStatus: false
					},
					ok: true,
					status: {
						backend: 'sqlite',
						vectorMode: 'json_fallback'
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag/'
		});

		const response = await client.status();
		expect(response.ok).toBe(true);
		expect(response.status?.vectorMode).toBe('json_fallback');
		expect(response.capabilities?.backend).toBe('sqlite');
	});

	it('loads maintenance status from the workflow endpoint', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/status/maintenance');

			return new Response(
				JSON.stringify({
					admin: {
						canAnalyzeBackend: true
					},
					maintenance: {
						activeJobs: [],
						backend: 'postgres',
						recentActions: [
							{
								action: 'analyze_backend',
								id: 'admin-1',
								startedAt: 1,
								status: 'completed'
							}
						],
						recommendations: [
							{
								code: 'analyze_recommended',
								message:
									'Run ANALYZE to refresh planner statistics.',
								severity: 'warning'
							}
						]
					},
					ok: true,
					status: {
						backend: 'postgres',
						vectorMode: 'native'
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag/'
		});

		const response = await client.statusMaintenance();
		expect(response.ok).toBe(true);
		expect(response.status?.backend).toBe('postgres');
		expect(response.maintenance?.recentActions[0]?.action).toBe(
			'analyze_backend'
		);
	});

	it('builds a normalized maintenance overview from workflow payloads', () => {
		const overview = buildRAGMaintenanceOverview({
			admin: {
				canAnalyzeBackend: true,
				canClearIndex: false,
				canCreateDocument: false,
				canDeleteDocument: false,
				canListSyncSources: false,
				canManageRetrievalBaselines: false,
				canPruneSearchTraces: false,
				canRebuildNativeIndex: false,
				canReindexDocument: false,
				canReindexSource: false,
				canReseed: false,
				canReset: false,
				canSyncAllSources: false,
				canSyncSource: false
			},
			maintenance: {
				activeJobs: [],
				backend: 'postgres',
				recentActions: [],
				recommendations: [
					{
						action: 'analyze_backend',
						code: 'backend_statistics_refresh_recommended',
						message: 'Run analyze to refresh planner statistics.',
						severity: 'warning'
					}
				]
			},
			status: {
				backend: 'postgres',
				vectorMode: 'native_pgvector'
			}
		});

		expect(overview.backend).toBe('postgres');
		expect(overview.recommendationCount).toBe(1);
		expect(overview.warningCount).toBe(1);
		expect(overview.recommendedNow).toHaveLength(1);
		expect(overview.blockingRecommendations).toHaveLength(0);
		expect(overview.availableActions).toEqual([
			expect.objectContaining({
				available: true,
				kind: 'analyze_backend',
				recommended: true
			})
		]);
		expect(overview.primaryRecommendation?.action).toBe('analyze_backend');
		expect(overview.actions).toEqual([
			expect.objectContaining({
				available: true,
				kind: 'analyze_backend',
				recommended: true
			}),
			expect.objectContaining({
				available: false,
				kind: 'rebuild_native_index',
				recommended: false
			})
		]);
	});

	it('loads lightweight retrieval release status helpers from the workflow endpoint', async () => {
		const calls: string[] = [];
		const fetchMock = (async (input) => {
			calls.push(String(input));
			if (String(input) === '/rag/status/release/drift') {
				return new Response(
					JSON.stringify({
						ok: true,
						handoffDriftCountsByLane: [
							{
								targetRolloutLabel: 'stable',
								totalCount: 1,
								countsByKind: {
									handoff_auto_complete_policy_drift: 0,
									handoff_auto_complete_stale_approval: 1,
									handoff_auto_complete_source_lane_missing: 0,
									handoff_auto_complete_gate_blocked: 0,
									handoff_auto_complete_approval_missing: 0
								}
							}
						],
						handoffDriftRollups: [
							{
								count: 1,
								groupKeys: ['docs-release'],
								kind: 'handoff_auto_complete_stale_approval',
								remediationHints: [
									'Renew the handoff approval so it falls within the configured freshness window.'
								],
								severity: 'warning',
								targetRolloutLabel: 'stable'
							}
						]
					}),
					{ status: 200 }
				);
			}
			if (String(input) === '/rag/status/release') {
				return new Response(
					JSON.stringify({
						ok: true,
						retrievalComparisons: {
							alerts: [
								{
									kind: 'handoff_auto_complete_stale_approval',
									latestRunId: 'run-1',
									message:
										'Auto-complete is enabled for docs-release:stable but the latest handoff approval is stale.',
									severity: 'warning'
								}
							],
							handoffAutoCompletePolicies: [
								{
									enabled: true,
									groupKey: 'docs-release',
									maxApprovedDecisionAgeMs: 60000,
									scope: 'group_target_rollout_label',
									targetRolloutLabel: 'stable'
								}
							],
							handoffAutoCompleteSafety: [
								{
									enabled: true,
									freshnessStatus: 'expired',
									groupKey: 'docs-release',
									reasons: [
										'latest approved handoff decision is older than the auto-complete policy allows'
									],
									safe: false,
									targetRolloutLabel: 'stable'
								}
							],
							handoffDriftRollups: [
								{
									count: 1,
									groupKeys: ['docs-release'],
									kind: 'handoff_auto_complete_stale_approval',
									remediationHints: [
										'Renew the handoff approval so it falls within the configured freshness window.'
									],
									severity: 'warning',
									targetRolloutLabel: 'stable'
								}
							],
							handoffDriftCountsByLane: [
								{
									targetRolloutLabel: 'stable',
									totalCount: 1,
									countsByKind: {
										handoff_auto_complete_policy_drift: 0,
										handoff_auto_complete_stale_approval: 1,
										handoff_auto_complete_source_lane_missing: 0,
										handoff_auto_complete_gate_blocked: 0,
										handoff_auto_complete_approval_missing: 0
									}
								}
							],
							recentHandoffAutoCompletePolicyHistory: [
								{
									changeKind: 'snapshot',
									enabled: true,
									groupKey: 'docs-release',
									id: 'handoff-policy-history-1',
									recordedAt: 10,
									targetRolloutLabel: 'stable'
								}
							],
							recentReleaseLanePolicyHistory: [
								{
									changeKind: 'snapshot',
									groupKey: 'docs-release',
									id: 'release-lane-policy-history-1',
									recordedAt: 11,
									rolloutLabel: 'stable',
									scope: 'group_rollout_label'
								}
							],
							recentBaselineGatePolicyHistory: [
								{
									changeKind: 'snapshot',
									id: 'gate-policy-history-1',
									recordedAt: 12,
									rolloutLabel: 'canary',
									scope: 'rollout_label'
								}
							],
							recentReleaseLaneEscalationPolicyHistory: [
								{
									changeKind: 'snapshot',
									groupKey: 'docs-release',
									id: 'escalation-policy-history-1',
									recordedAt: 13,
									targetRolloutLabel: 'stable'
								}
							],
							releaseLaneHandoffs: [
								{
									groupKey: 'docs-release',
									sourceRolloutLabel: 'canary',
									targetRolloutLabel: 'stable',
									readyForHandoff: false,
									reasons: [
										'explicit approval is required before promotion'
									]
								}
							]
						}
					}),
					{ status: 200 }
				);
			}
			if (String(input) === '/rag/status/release/incidents') {
				return new Response(
					JSON.stringify({
						ok: true,
						incidentSummary: {
							acknowledgedOpenCount: 1,
							openCount: 1,
							resolvedCount: 2,
							unacknowledgedOpenCount: 0
						},
						releaseLaneIncidentSummaries: [
							{
								groupKey: 'docs-release',
								openCount: 1,
								targetRolloutLabel: 'stable'
							}
						],
						recentIncidentRemediationDecisions: [
							{
								decidedAt: 15,
								decidedBy: 'alex',
								groupKey: 'docs-release',
								id: 'incident-remediation-1',
								incidentId: 'incident-1',
								remediationKind: 'renew_approval',
								status: 'planned',
								targetRolloutLabel: 'stable'
							}
						]
					}),
					{ status: 200 }
				);
			}
			if (String(input) === '/rag/status/release/remediations') {
				return new Response(
					JSON.stringify({
						ok: true,
						incidentRemediationExecutionSummary: {
							totalCount: 4,
							replayCount: 1,
							replayRate: 0.25,
							guardrailBlockedCount: 1,
							guardrailBlockRate: 0.25,
							mutationSkippedReplayCount: 1,
							recentMutationSkippedReplays: [
								{
									action: {
										kind: 'acknowledge_incident',
										label: 'Acknowledge incident',
										method: 'POST',
										path: '/rag/compare/retrieval/incidents/acknowledge'
									},
									code: 'idempotent_replay',
									executedAt: 17,
									id: 'execution-2',
									idempotentReplay: true,
									mutationSkipped: true,
									ok: true
								}
							],
							recentGuardrailBlocks: [
								{
									action: {
										kind: 'resolve_incident',
										label: 'Resolve incident',
										method: 'POST',
										path: '/rag/compare/retrieval/incidents/resolve'
									},
									blockedByGuardrail: true,
									code: 'guardrail_blocked',
									executedAt: 18,
									guardrailKind:
										'bulk_mutation_opt_in_required',
									id: 'execution-3',
									ok: false
								}
							]
						},
						recentIncidentRemediationExecutions: [
							{
								action: {
									kind: 'resolve_incident',
									label: 'Resolve incident',
									method: 'POST',
									path: '/rag/compare/retrieval/incidents/resolve'
								},
								blockedByGuardrail: true,
								code: 'guardrail_blocked',
								executedAt: 18,
								id: 'execution-3',
								ok: false
							},
							{
								action: {
									kind: 'acknowledge_incident',
									label: 'Acknowledge incident',
									method: 'POST',
									path: '/rag/compare/retrieval/incidents/acknowledge'
								},
								code: 'idempotent_replay',
								executedAt: 17,
								id: 'execution-2',
								idempotentReplay: true,
								mutationSkipped: true,
								ok: true
							}
						]
					}),
					{ status: 200 }
				);
			}
			if (
				String(input) ===
				'/rag/compare/retrieval/incidents/remediations/executions?idempotentReplay=true&incidentId=incident-1&limit=5'
			) {
				return new Response(
					JSON.stringify({
						ok: true,
						records: [
							{
								action: {
									kind: 'acknowledge_incident',
									label: 'Acknowledge incident',
									method: 'POST',
									path: '/rag/compare/retrieval/incidents/acknowledge'
								},
								code: 'idempotent_replay',
								executedAt: 17,
								id: 'execution-2',
								idempotentReplay: true,
								incidentId: 'incident-1',
								mutationSkipped: true,
								ok: true
							}
						]
					}),
					{ status: 200 }
				);
			}
			if (String(input) === '/rag/status/release/drift') {
				return new Response(
					JSON.stringify({
						ok: true,
						handoffDriftCountsByLane: [
							{
								targetRolloutLabel: 'stable',
								totalCount: 1,
								countsByKind: {
									handoff_auto_complete_policy_drift: 0,
									handoff_auto_complete_stale_approval: 1,
									handoff_auto_complete_source_lane_missing: 0,
									handoff_auto_complete_gate_blocked: 0,
									handoff_auto_complete_approval_missing: 0
								}
							}
						],
						handoffDriftRollups: [
							{
								count: 1,
								groupKeys: ['docs-release'],
								kind: 'handoff_auto_complete_stale_approval',
								remediationHints: [
									'Renew the handoff approval so it falls within the configured freshness window.'
								],
								severity: 'warning',
								targetRolloutLabel: 'stable'
							}
						]
					}),
					{ status: 200 }
				);
			}
			if (String(input) === '/rag/status/handoffs/incidents') {
				return new Response(
					JSON.stringify({
						freshnessWindows: [
							{
								freshnessStatus: 'expired',
								groupKey: 'docs-release',
								sourceRolloutLabel: 'canary',
								staleAfterMs: 60000,
								targetRolloutLabel: 'stable'
							}
						],
						incidentSummary: {
							acknowledgedOpenCount: 0,
							openCount: 1,
							resolvedCount: 0,
							staleOpenCount: 1,
							unacknowledgedOpenCount: 1
						},
						incidents: [
							{
								groupKey: 'docs-release',
								kind: 'handoff_stale',
								targetRolloutLabel: 'stable'
							}
						],
						recentHistory: [
							{
								action: 'resolved',
								groupKey: 'docs-release',
								id: 'handoff-history-1',
								incidentId: 'handoff-incident-1',
								kind: 'handoff_stale',
								recordedAt: 9,
								targetRolloutLabel: 'stable'
							}
						],
						ok: true
					}),
					{ status: 200 }
				);
			}
			return new Response(
				JSON.stringify({
					autoComplete: [
						{
							enabled: true,
							freshnessStatus: 'expired',
							groupKey: 'docs-release',
							maxApprovedDecisionAgeMs: 60000,
							ready: false,
							reasons: [
								'latest approved handoff decision is older than the auto-complete policy allows'
							],
							sourceRolloutLabel: 'canary',
							targetRolloutLabel: 'stable'
						}
					],
					decisions: [
						{
							groupKey: 'docs-release',
							kind: 'reject',
							sourceRolloutLabel: 'canary',
							targetRolloutLabel: 'stable'
						}
					],
					handoffs: [
						{
							groupKey: 'docs-release',
							sourceRolloutLabel: 'canary',
							targetRolloutLabel: 'stable',
							readyForHandoff: false,
							reasons: [
								'explicit approval is required before promotion'
							]
						}
					],
					freshnessWindows: [
						{
							freshnessStatus: 'expired',
							groupKey: 'docs-release',
							sourceRolloutLabel: 'canary',
							staleAfterMs: 60000,
							targetRolloutLabel: 'stable'
						}
					],
					recentHistory: [
						{
							action: 'resolved',
							groupKey: 'docs-release',
							id: 'handoff-history-1',
							incidentId: 'handoff-incident-1',
							kind: 'handoff_stale',
							recordedAt: 9,
							targetRolloutLabel: 'stable'
						}
					],
					incidentSummary: {
						acknowledgedOpenCount: 0,
						openCount: 1,
						resolvedCount: 0,
						staleOpenCount: 1,
						unacknowledgedOpenCount: 1
					},
					incidents: [
						{
							groupKey: 'docs-release',
							kind: 'handoff_stale',
							targetRolloutLabel: 'stable'
						}
					],
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const releaseStatus = await client.retrievalReleaseStatus();
		const releaseIncidentStatus =
			await client.retrievalReleaseIncidentStatus();
		const remediationStatus =
			await client.retrievalIncidentRemediationStatus();
		const remediationExecutions =
			await client.retrievalIncidentRemediationExecutions({
				idempotentReplay: true,
				incidentId: 'incident-1',
				limit: 5
			});
		const releaseDriftStatus = await client.retrievalReleaseDriftStatus();
		const handoffStatus = await client.retrievalLaneHandoffStatus();
		const handoffIncidentStatus =
			await client.retrievalLaneHandoffIncidentStatus();

		expect(releaseStatus?.releaseLaneHandoffs?.[0]).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				sourceRolloutLabel: 'canary',
				targetRolloutLabel: 'stable'
			})
		);
		expect(releaseStatus?.handoffAutoCompletePolicies?.[0]).toEqual(
			expect.objectContaining({
				enabled: true,
				groupKey: 'docs-release',
				targetRolloutLabel: 'stable'
			})
		);
		expect(
			releaseStatus?.recentHandoffAutoCompletePolicyHistory?.[0]
		).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-release',
				targetRolloutLabel: 'stable'
			})
		);
		expect(releaseStatus?.handoffAutoCompleteSafety?.[0]).toEqual(
			expect.objectContaining({
				enabled: true,
				groupKey: 'docs-release',
				safe: false,
				targetRolloutLabel: 'stable'
			})
		);
		expect(releaseStatus?.handoffDriftRollups?.[0]).toEqual(
			expect.objectContaining({
				count: 1,
				kind: 'handoff_auto_complete_stale_approval',
				targetRolloutLabel: 'stable'
			})
		);
		expect(releaseStatus?.handoffDriftCountsByLane?.[0]).toEqual(
			expect.objectContaining({
				targetRolloutLabel: 'stable',
				totalCount: 1,
				countsByKind: expect.objectContaining({
					handoff_auto_complete_stale_approval: 1
				})
			})
		);
		expect(releaseStatus?.recentReleaseLanePolicyHistory?.[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-release',
				rolloutLabel: 'stable'
			})
		);
		expect(releaseStatus?.recentBaselineGatePolicyHistory?.[0]).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				rolloutLabel: 'canary',
				scope: 'rollout_label'
			})
		);
		expect(
			releaseStatus?.recentReleaseLaneEscalationPolicyHistory?.[0]
		).toEqual(
			expect.objectContaining({
				changeKind: 'snapshot',
				groupKey: 'docs-release',
				targetRolloutLabel: 'stable'
			})
		);
		expect(
			releaseIncidentStatus.recentIncidentRemediationDecisions?.[0]
		).toEqual(
			expect.objectContaining({
				decidedBy: 'alex',
				incidentId: 'incident-1',
				remediationKind: 'renew_approval'
			})
		);
		expect(releaseIncidentStatus.incidentSummary).toEqual(
			expect.objectContaining({
				acknowledgedOpenCount: 1,
				openCount: 1
			})
		);
		expect(remediationStatus.incidentRemediationExecutionSummary).toEqual(
			expect.objectContaining({
				guardrailBlockedCount: 1,
				mutationSkippedReplayCount: 1,
				replayCount: 1
			})
		);
		expect(
			remediationStatus.recentIncidentRemediationExecutions?.[0]
		).toEqual(
			expect.objectContaining({
				code: 'guardrail_blocked'
			})
		);
		expect(remediationExecutions[0]).toEqual(
			expect.objectContaining({
				code: 'idempotent_replay',
				idempotentReplay: true,
				incidentId: 'incident-1',
				mutationSkipped: true
			})
		);
		expect(releaseDriftStatus.handoffDriftCountsByLane?.[0]).toEqual(
			expect.objectContaining({
				targetRolloutLabel: 'stable',
				totalCount: 1
			})
		);
		expect(releaseDriftStatus.handoffDriftRollups?.[0]).toEqual(
			expect.objectContaining({
				kind: 'handoff_auto_complete_stale_approval',
				targetRolloutLabel: 'stable'
			})
		);
		expect(releaseStatus?.alerts?.[0]).toEqual(
			expect.objectContaining({
				kind: 'handoff_auto_complete_stale_approval'
			})
		);
		expect(handoffStatus.handoffs?.[0]).toEqual(
			expect.objectContaining({
				groupKey: 'docs-release',
				targetRolloutLabel: 'stable'
			})
		);
		expect(handoffStatus.decisions?.[0]).toEqual(
			expect.objectContaining({
				kind: 'reject'
			})
		);
		expect(handoffStatus.incidents?.[0]).toEqual(
			expect.objectContaining({
				kind: 'handoff_stale'
			})
		);
		expect(handoffStatus.incidentSummary).toEqual(
			expect.objectContaining({
				openCount: 1,
				staleOpenCount: 1,
				unacknowledgedOpenCount: 1
			})
		);
		expect(handoffStatus.autoComplete?.[0]).toEqual(
			expect.objectContaining({
				enabled: true,
				freshnessStatus: 'expired',
				ready: false,
				targetRolloutLabel: 'stable'
			})
		);
		expect(handoffStatus.freshnessWindows?.[0]).toEqual(
			expect.objectContaining({
				freshnessStatus: 'expired',
				targetRolloutLabel: 'stable'
			})
		);
		expect(handoffIncidentStatus.incidentSummary).toEqual(
			expect.objectContaining({
				openCount: 1,
				staleOpenCount: 1
			})
		);
		expect(handoffIncidentStatus.freshnessWindows?.[0]).toEqual(
			expect.objectContaining({
				freshnessStatus: 'expired',
				targetRolloutLabel: 'stable'
			})
		);
		expect(handoffStatus.recentHistory?.[0]).toEqual(
			expect.objectContaining({
				action: 'resolved',
				incidentId: 'handoff-incident-1'
			})
		);
		expect(handoffIncidentStatus.recentHistory?.[0]).toEqual(
			expect.objectContaining({
				action: 'resolved',
				incidentId: 'handoff-incident-1'
			})
		);
		expect(calls).toEqual([
			'/rag/status/release',
			'/rag/status/release/incidents',
			'/rag/status/release/remediations',
			'/rag/compare/retrieval/incidents/remediations/executions?idempotentReplay=true&incidentId=incident-1&limit=5',
			'/rag/status/release/drift',
			'/rag/status/handoffs',
			'/rag/status/handoffs/incidents'
		]);
	});

	it('loads ops from the workflow endpoint', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/ops');

			return new Response(
				JSON.stringify({
					admin: {
						canClearIndex: true,
						canCreateDocument: true,
						canDeleteDocument: true,
						canListSyncSources: true,
						canReindexDocument: true,
						canReindexSource: true,
						canReseed: true,
						canReset: true,
						canSyncAllSources: true,
						canSyncSource: true
					},
					adminActions: [
						{
							action: 'reseed',
							id: 'admin-1',
							startedAt: 1,
							status: 'completed'
						}
					],
					adminJobs: [
						{
							action: 'reseed',
							id: 'job-1',
							startedAt: 1,
							status: 'completed'
						}
					],
					capabilities: {
						backend: 'sqlite',
						nativeVectorSearch: false,
						persistence: 'embedded',
						serverSideFiltering: false,
						streamingIngestStatus: false
					},
					documents: {
						byKind: { note: 1 },
						chunkCount: 3,
						total: 1
					},
					health: {
						averageChunksPerDocument: 3,
						coverageByFormat: { markdown: 1 },
						coverageByKind: { note: 1 },
						documentsMissingCreatedAt: 0,
						documentsMissingMetadata: 0,
						documentsMissingSource: 0,
						documentsMissingTitle: 0,
						documentsMissingUpdatedAt: 0,
						documentsWithoutChunkPreview: 0,
						duplicateDocumentIdGroups: [],
						duplicateDocumentIds: [],
						duplicateSourceGroups: [],
						duplicateSources: [],
						emptyChunks: 0,
						emptyDocuments: 0,
						failedAdminJobs: 0,
						failedIngestJobs: 0,
						failuresByAdminAction: {},
						failuresByExtractor: {},
						failuresByInputKind: {},
						inspectedChunks: 3,
						inspectedDocuments: 1,
						inspection: {
							chunkingProfiles: {
								'markdown-source-aware': 1
							},
							chunksWithSourceLabels: 1,
							documentsWithSourceLabels: 1,
							extractorRegistryMatches: {
								'markdown-registry-override': 1
							},
							sampleChunks: [
								{
									chunkId: 'doc-1:001',
									chunkingProfile: 'markdown-source-aware',
									documentId: 'doc-1',
									extractorRegistryMatch:
										'markdown-registry-override',
									labels: {
										locatorLabel: 'Page 7 · Region 2',
										provenanceLabel:
											'Extractor markdown-registry-override · Chunking markdown-source-aware'
									},
									sourceNativeKind: 'pdf_region'
								}
							],
							sampleDocuments: [
								{
									chunkingProfile: 'markdown-source-aware',
									extractorRegistryMatch:
										'markdown-registry-override',
									id: 'doc-1',
									labels: {
										locatorLabel: 'Page 7',
										provenanceLabel:
											'Extractor markdown-registry-override · Chunking markdown-source-aware'
									},
									source: 'notes/demo.md',
									sourceNativeKind: 'pdf_page',
									title: 'Demo'
								}
							],
							sourceNativeKinds: {
								pdf_page: 1,
								pdf_region: 1
							}
						},
						lowSignalChunks: 0,
						newestDocumentAgeMs: 10,
						oldestDocumentAgeMs: 10,
						staleAfterMs: 604800000,
						staleDocuments: []
					},
					ingestJobs: [
						{
							chunkCount: 3,
							documentCount: 1,
							id: 'job-1',
							inputKind: 'documents',
							requestedCount: 1,
							startedAt: 1,
							status: 'completed'
						}
					],
					ok: true,
					readiness: {
						embeddingConfigured: false,
						extractorNames: ['pdf'],
						extractorsConfigured: true,
						indexManagerConfigured: true,
						providerConfigured: true,
						rerankerConfigured: false
					},
					syncSources: [
						{
							id: 'sync-1',
							kind: 'directory',
							label: 'Docs folder',
							status: 'completed',
							target: '/docs'
						}
					],
					status: {
						backend: 'sqlite',
						vectorMode: 'json_fallback'
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag/'
		});

		const response = await client.ops();
		expect(response.ok).toBe(true);
		expect(response.admin.canReseed).toBe(true);
		expect(response.adminActions[0]?.action).toBe('reseed');
		expect(response.adminJobs?.[0]?.status).toBe('completed');
		expect(response.documents?.chunkCount).toBe(3);
		expect(response.health.duplicateSourceGroups).toEqual([]);
		expect(response.health.coverageByFormat).toEqual({ markdown: 1 });
		expect(response.health.inspection?.sourceNativeKinds).toEqual({
			pdf_page: 1,
			pdf_region: 1
		});
		expect(response.health.inspection?.extractorRegistryMatches).toEqual({
			'markdown-registry-override': 1
		});
		expect(response.health.inspection?.chunkingProfiles).toEqual({
			'markdown-source-aware': 1
		});
		expect(response.ingestJobs[0]?.status).toBe('completed');
		expect(response.readiness.extractorNames).toEqual(['pdf']);
		expect(response.syncSources[0]?.id).toBe('sync-1');
	});

	it('posts reindex mutations to the workflow endpoints', async () => {
		const calls: Array<{ input: string; method?: string; body?: string }> =
			[];
		const fetchMock = (async (input, init) => {
			calls.push({
				body: typeof init?.body === 'string' ? init.body : undefined,
				input: String(input),
				method: init?.method
			});

			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		await client.reindexDocument('doc-1');
		await client.reindexSource('docs/a.md');

		expect(calls).toEqual([
			{
				body: undefined,
				input: '/rag/reindex/documents/doc-1',
				method: 'POST'
			},
			{
				body: JSON.stringify({ source: 'docs/a.md' }),
				input: '/rag/reindex/source',
				method: 'POST'
			}
		]);
	});

	it('posts backend maintenance mutations to the workflow endpoints', async () => {
		const calls: Array<{ input: string; method?: string; body?: string }> =
			[];
		const fetchMock = (async (input, init) => {
			calls.push({
				body: typeof init?.body === 'string' ? init.body : undefined,
				input: String(input),
				method: init?.method
			});

			return new Response(
				JSON.stringify({
					admin: {
						canAnalyzeBackend: true,
						canRebuildNativeIndex: true
					},
					adminActions: [
						{
							action: 'analyze_backend',
							id: 'admin-1',
							startedAt: 1,
							status: 'completed'
						}
					],
					adminJobs: [],
					maintenance: {
						activeJobs: [],
						backend: 'postgres',
						recentActions: [
							{
								action: 'analyze_backend',
								id: 'admin-1',
								startedAt: 1,
								status: 'completed'
							}
						],
						recommendations: []
					},
					ok: true,
					status: 'backend analyze completed successfully',
					workflowStatus: {
						backend: 'postgres',
						vectorMode: 'native'
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const analyzeResponse = await client.analyzeBackend();
		const reindexResponse = await client.rebuildNativeIndex();

		expect(analyzeResponse).toMatchObject({
			admin: {
				canAnalyzeBackend: true
			},
			maintenance: {
				backend: 'postgres'
			},
			ok: true,
			workflowStatus: {
				backend: 'postgres'
			}
		});
		expect(reindexResponse).toMatchObject({
			admin: {
				canRebuildNativeIndex: true
			},
			ok: true
		});
		expect(calls).toEqual([
			{
				body: undefined,
				input: '/rag/backend/analyze',
				method: 'POST'
			},
			{
				body: undefined,
				input: '/rag/backend/reindex-native',
				method: 'POST'
			}
		]);
	});

	it('lists and triggers source sync workflow endpoints', async () => {
		const calls: Array<{
			body?: string;
			input: string;
			method?: string;
		}> = [];
		const fetchMock = (async (input, init) => {
			calls.push({
				body: typeof init?.body === 'string' ? init.body : undefined,
				input: String(input),
				method: init?.method
			});

			return new Response(
				JSON.stringify({
					ok: true,
					sources: [
						{
							id: 'sync-1',
							kind: 'directory',
							label: 'Docs folder',
							status: 'completed'
						}
					]
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		await client.syncSources();
		await client.syncAllSources({ background: true });
		await client.syncSource('sync-1', { background: true });

		expect(calls).toEqual([
			{
				body: undefined,
				input: '/rag/sync',
				method: undefined
			},
			{
				body: JSON.stringify({ background: true }),
				input: '/rag/sync',
				method: 'POST'
			},
			{
				body: JSON.stringify({ background: true }),
				input: '/rag/sync/sync-1',
				method: 'POST'
			}
		]);
	});

	it('posts evaluation payloads to the workflow endpoint', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/evaluate');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({
					cases: [
						{
							expectedDocumentIds: ['guide-1'],
							id: 'doc-hit',
							query: 'how does retrieval work?',
							topK: 3
						}
					],
					topK: 5
				})
			);

			return new Response(
				JSON.stringify({
					cases: [
						{
							caseId: 'doc-hit',
							elapsedMs: 4,
							expectedCount: 1,
							expectedIds: ['guide-1'],
							f1: 1,
							matchedCount: 1,
							matchedIds: ['guide-1'],
							missingIds: [],
							mode: 'documentId',
							precision: 1,
							query: 'how does retrieval work?',
							recall: 1,
							retrievedCount: 1,
							retrievedIds: ['guide-1'],
							status: 'pass',
							topK: 3
						}
					],
					elapsedMs: 4,
					ok: true,
					passingRate: 100,
					summary: {
						averageF1: 1,
						averageLatencyMs: 4,
						averagePrecision: 1,
						averageRecall: 1,
						failedCases: 0,
						partialCases: 0,
						passedCases: 1,
						totalCases: 1
					},
					totalCases: 1
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.evaluate({
			cases: [
				{
					expectedDocumentIds: ['guide-1'],
					id: 'doc-hit',
					query: 'how does retrieval work?',
					topK: 3
				}
			],
			topK: 5
		});

		expect(response.summary.passedCases).toBe(1);
		expect(response.cases[0]?.mode).toBe('documentId');
	});

	it('loads indexed documents from the workflow endpoint', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/documents?kind=custom');

			return new Response(
				JSON.stringify({
					documents: [
						{
							labels: {
								locatorLabel: 'Sheet Overview',
								provenanceLabel: 'Spreadsheet workbook'
							},
							chunkCount: 2,
							id: 'doc-1',
							source: 'notes/demo.md',
							title: 'Demo'
						}
					],
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.documents('custom');
		expect(response.documents[0]?.id).toBe('doc-1');
		expect(response.documents[0]?.labels?.locatorLabel).toBe(
			'Sheet Overview'
		);
	});

	it('loads document chunk previews from the workflow endpoint', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/documents/doc-1/chunks');

			return new Response(
				JSON.stringify({
					chunks: [
						{
							chunkId: 'doc-1:001',
							labels: {
								locatorLabel: 'Page 7 · Region 2',
								provenanceLabel:
									'OCR demo_pdf_ocr · Confidence 0.91'
							},
							text: 'Alpha'
						}
					],
					document: {
						id: 'doc-1',
						labels: {
							contextLabel: 'Page 7',
							locatorLabel: 'Page 7'
						},
						source: 'notes/demo.md',
						title: 'Demo'
					},
					normalizedText: 'Alpha',
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.documentChunks('doc-1');
		expect(response.ok).toBe(true);
		if (response.ok) {
			expect(response.chunks).toHaveLength(1);
			expect(response.document.labels?.locatorLabel).toBe('Page 7');
			expect(response.chunks[0]?.labels?.locatorLabel).toBe(
				'Page 7 · Region 2'
			);
		}
	});

	it('loads block-aware document chunk previews from the workflow endpoint', async () => {
		const fetchMock = (async (input) => {
			expect(input).toBe('/rag/documents/doc-2/chunks');

			return new Response(
				JSON.stringify({
					chunks: [
						{
							chunkId: 'doc-2:003',
							labels: {
								contextLabel:
									'PDF table block Page 2 Table Block',
								locatorLabel: 'Page 2 · Table Block 3',
								provenanceLabel: 'PDF native · PDF table block'
							},
							structure: {
								section: {
									kind: 'pdf_block',
									path: ['Page 2 Table Block'],
									title: 'Page 2 Table Block'
								}
							},
							text: 'Metric | Status'
						}
					],
					document: {
						id: 'doc-2',
						labels: {
							contextLabel: 'Page 2',
							locatorLabel: 'Page 2'
						},
						source: 'docs/report.pdf',
						title: 'Report'
					},
					normalizedText: 'Metric | Status',
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.documentChunks('doc-2');
		expect(response.ok).toBe(true);
		if (response.ok) {
			expect(response.chunks[0]?.labels?.contextLabel).toBe(
				'PDF table block Page 2 Table Block'
			);
			expect(response.chunks[0]?.labels?.locatorLabel).toBe(
				'Page 2 · Table Block 3'
			);
			expect(response.chunks[0]?.structure?.section?.kind).toBe(
				'pdf_block'
			);
		}
	});

	it('posts document creation to the managed documents endpoint', async () => {
		const fetchMock = (async (input, init) => {
			expect(input).toBe('/rag/documents');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBe(
				JSON.stringify({
					source: 'custom/demo.md',
					text: '# Demo'
				})
			);

			return new Response(
				JSON.stringify({
					document: {
						id: 'custom-demo',
						source: 'custom/demo.md',
						title: 'custom-demo'
					},
					inserted: 'custom-demo',
					ok: true
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		const response = await client.createDocument({
			source: 'custom/demo.md',
			text: '# Demo'
		});
		expect(response.ok).toBe(true);
		expect(response.inserted).toBe('custom-demo');
	});

	it('posts reseed and reset mutations to the workflow endpoints', async () => {
		const calls: Array<{ input: unknown; method?: string }> = [];
		const fetchMock = (async (input, init) => {
			calls.push({ input, method: init?.method });

			return new Response(JSON.stringify({ ok: true, status: 'ok' }), {
				status: 200
			});
		}) as typeof fetch;

		const client = createRAGClient({
			fetch: fetchMock,
			path: '/rag'
		});

		await client.reseed();
		await client.reset();

		expect(calls).toEqual([
			{ input: '/rag/reseed', method: 'POST' },
			{ input: '/rag/reset', method: 'POST' }
		]);
	});
});
