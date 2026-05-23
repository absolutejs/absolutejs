import { useMemo, useState } from 'react';
import { FieldEditor } from '../page/FieldEditor';
import { eslintOptionsSchema } from '../schema/fromJsonSchema';
import type {
	ConfigBlock,
	EffectiveRule,
	RuleCatalog,
	RuleMeta,
	RuleSeverity
} from '../../../../types/eslintConfig';

const SEVERITIES: RuleSeverity[] = ['off', 'warn', 'error'];
const CATALOG_RENDER_CAP = 250;

type EslintTab = 'config' | 'catalog' | 'effective';

type Notice = {
	kind: 'ok' | 'err';
	text: string;
};

type SaveRequest = {
	file?: string;
	name: string;
	options?: unknown[];
	severity: RuleSeverity;
	sourceIndex: number;
};

const splitName = (name: string) => {
	if (!name.includes('/')) return { prefix: '', short: name };
	const slash = name.lastIndexOf('/');

	return { prefix: name.slice(0, slash + 1), short: name.slice(slash + 1) };
};

const formatOptions = (options: unknown[]) =>
	options.map((option) => JSON.stringify(option)).join(', ');

type SegmentProps = {
	busy: boolean;
	onChange: (severity: RuleSeverity) => void;
	value: RuleSeverity;
};

const SeveritySegment = ({ busy, onChange, value }: SegmentProps) => (
	<div className={busy ? 'seg busy' : 'seg'}>
		{SEVERITIES.map((severity) => (
			<button
				data-on={value === severity}
				data-sev={severity}
				key={severity}
				onClick={() => onChange(severity)}
				type="button"
			>
				{severity}
			</button>
		))}
	</div>
);

type RuleNameProps = {
	meta: RuleMeta | null;
	name: string;
};

const RuleName = ({ meta, name }: RuleNameProps) => {
	const parts = splitName(name);

	return (
		<div className="rule-name-row">
			<span className="rule-name">
				<span className="pfx">{parts.prefix}</span>
				{parts.short}
			</span>
			{meta && <span className="badge src">{meta.source}</span>}
			{meta?.fixable && <span className="badge fix">fixable</span>}
			{meta?.deprecated && <span className="badge dep">deprecated</span>}
			{meta?.docsUrl && (
				<a
					className="docs"
					href={meta.docsUrl}
					rel="noreferrer"
					target="_blank"
				>
					docs ↗
				</a>
			)}
		</div>
	);
};

type ConfigRowProps = {
	busy: boolean;
	meta: RuleMeta | null;
	name: string;
	onSave: (severity: RuleSeverity, options?: unknown[]) => void;
	options: unknown[];
	severity: RuleSeverity;
};

const ConfigRow = ({
	busy,
	meta,
	name,
	onSave,
	options,
	severity
}: ConfigRowProps) => {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<unknown[]>(options);
	const optionsSchema = useMemo(
		() => eslintOptionsSchema(meta?.schema),
		[meta]
	);

	const openEditor = () => {
		setDraft(options);
		setEditing(true);
	};

	return (
		<div className="rule">
			<div className="rule-main">
				<RuleName meta={meta} name={name} />
				{meta?.description && (
					<p className="rule-desc">{meta.description}</p>
				)}
				{options.length > 0 && !editing && (
					<code className="rule-opts">{formatOptions(options)}</code>
				)}
				{editing && (
					<div className="opts-editor">
						<div className="fe-root">
							<FieldEditor
								onChange={(value) =>
									setDraft(Array.isArray(value) ? value : [])
								}
								schema={optionsSchema}
								value={draft}
							/>
						</div>
						<div className="opts-actions">
							<button
								className="opts-btn save"
								onClick={() => {
									onSave(severity, draft);
									setEditing(false);
								}}
								type="button"
							>
								Save options
							</button>
							<button
								className="opts-btn"
								onClick={() => setEditing(false)}
								type="button"
							>
								Cancel
							</button>
						</div>
					</div>
				)}
			</div>
			<div className="rule-controls">
				<button
					className="opts-toggle"
					data-on={editing}
					onClick={() => (editing ? setEditing(false) : openEditor())}
					type="button"
				>
					options
				</button>
				<SeveritySegment
					busy={busy}
					onChange={(next) => onSave(next)}
					value={severity}
				/>
			</div>
		</div>
	);
};

type CatalogCardProps = {
	busy: boolean;
	configuredLabel: string | null;
	effective: RuleSeverity;
	meta: RuleMeta | null;
	name: string;
	onChange: (severity: RuleSeverity) => void;
};

const CatalogCard = ({
	busy,
	configuredLabel,
	effective,
	meta,
	name,
	onChange
}: CatalogCardProps) => (
	<div className="rule">
		<div className="rule-main">
			<RuleName meta={meta} name={name} />
			{meta?.description && (
				<p className="rule-desc">{meta.description}</p>
			)}
		</div>
		<div className="cat-control">
			<span className="effective">
				{configuredLabel ? (
					<>
						in <b>{configuredLabel}</b>
					</>
				) : (
					<>inherited</>
				)}
			</span>
			<SeveritySegment
				busy={busy}
				onChange={onChange}
				value={effective}
			/>
		</div>
	</div>
);

const buildMetaIndex = (meta: RuleMeta[]) => {
	const byName = new Map<string, RuleMeta>();
	for (const entry of meta) byName.set(entry.name, entry);

	return byName;
};

const buildConfiguredIndex = (blocks: ConfigBlock[]) => {
	const byName = new Map<string, { label: string; sourceIndex: number }>();
	for (const block of blocks) {
		for (const rule of block.rules) {
			if (!byName.has(rule.name)) {
				byName.set(rule.name, {
					label: block.label,
					sourceIndex: block.sourceIndex
				});
			}
		}
	}

	return byName;
};

const pickDefaultBlock = (blocks: ConfigBlock[]) => {
	const editable = blocks.filter(
		(block) => !block.isGlobalIgnore && block.rules.length > 0
	);
	if (editable.length === 0) return null;
	const best = editable.reduce((winner, block) =>
		block.rules.length > winner.rules.length ? block : winner
	);

	return best.sourceIndex;
};

const sourceCounts = (meta: RuleMeta[]) => {
	const counts = new Map<string, number>();
	for (const entry of meta) {
		counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1);
	}

	return Array.from(counts.entries()).sort(
		(left, right) => right[1] - left[1]
	);
};

const matchesQuery = (
	query: string,
	name: string,
	description: string | null
) => {
	if (query === '') return true;
	const needle = query.toLowerCase();

	return (
		name.toLowerCase().includes(needle) ||
		(description ?? '').toLowerCase().includes(needle)
	);
};

type EslintPanelProps = {
	catalog: RuleCatalog;
};

export const EslintPanel = ({ catalog: initialCatalog }: EslintPanelProps) => {
	const [catalog, setCatalog] = useState(initialCatalog);
	const [tab, setTab] = useState<EslintTab>('config');
	const [query, setQuery] = useState('');
	const [source, setSource] = useState('all');
	const [busyRule, setBusyRule] = useState<string | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [scopeFile, setScopeFile] = useState('');
	const [scopeDraft, setScopeDraft] = useState('');

	const metaByName = useMemo(
		() => buildMetaIndex(catalog.meta),
		[catalog.meta]
	);
	const configuredByName = useMemo(
		() => buildConfiguredIndex(catalog.blocks),
		[catalog.blocks]
	);
	const effectiveByName = useMemo(() => {
		const byName = new Map<string, RuleSeverity>();
		for (const rule of catalog.effective)
			byName.set(rule.name, rule.severity);

		return byName;
	}, [catalog.effective]);
	const defaultBlock = useMemo(
		() => pickDefaultBlock(catalog.blocks),
		[catalog.blocks]
	);
	const sources = useMemo(() => sourceCounts(catalog.meta), [catalog.meta]);
	const configuredCount = configuredByName.size;

	const save = async (request: SaveRequest) => {
		setBusyRule(request.name);
		setNotice(null);
		try {
			const response = await fetch('/api/rules', {
				body: JSON.stringify({ ...request, file: scopeFile }),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			});
			const result = await response.json();
			if (result.ok && result.catalog) {
				setCatalog(result.catalog);
				setNotice({ kind: 'ok', text: `Updated ${request.name}` });
			} else {
				setNotice({
					kind: 'err',
					text: result.message ?? 'Update failed'
				});
			}
		} catch (error) {
			setNotice({ kind: 'err', text: String(error) });
		} finally {
			setBusyRule(null);
		}
	};

	const applyScope = async (file: string) => {
		setNotice(null);
		try {
			const response = await fetch(
				`/api/rules?file=${encodeURIComponent(file)}`
			);
			const next = await response.json();
			setCatalog(next);
			setScopeFile(file);
			if (file !== '') setTab('effective');
		} catch (error) {
			setNotice({ kind: 'err', text: String(error) });
		}
	};

	const matchesSource = (ruleSource: string) =>
		source === 'all' || ruleSource === source;

	const visibleBlocks = catalog.blocks.filter(
		(block) => block.rules.length > 0
	);

	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">
					<h1 className="wordmark">
						ESLint <em>rules</em>
					</h1>
					<div className="subpath">
						<span className="dot" />
						{catalog.configPath}
					</div>
				</div>
				<div className="counts">
					<div className="count">
						<b>{configuredCount}</b>
						<span>configured</span>
					</div>
					<div className="count">
						<b>{catalog.meta.length}</b>
						<span>available</span>
					</div>
				</div>
			</header>

			<div className="controls">
				<div className="tabs">
					<button
						className="tab"
						data-active={tab === 'config'}
						onClick={() => setTab('config')}
						type="button"
					>
						Your config
					</button>
					<button
						className="tab"
						data-active={tab === 'catalog'}
						onClick={() => setTab('catalog')}
						type="button"
					>
						Browse all rules
					</button>
					<button
						className="tab"
						data-active={tab === 'effective'}
						onClick={() => setTab('effective')}
						type="button"
					>
						Effective for file
					</button>
				</div>
				<input
					className="search"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search rules or descriptions…"
					value={query}
				/>
				<input
					className="scope"
					onChange={(event) => setScopeDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter')
							applyScope(scopeDraft.trim());
					}}
					placeholder="Scope to a file, e.g. src/app.ts ↵"
					value={scopeDraft}
				/>
				{scopeFile !== '' && (
					<button
						className="scope-clear"
						onClick={() => {
							setScopeDraft('');
							applyScope('');
						}}
						type="button"
					>
						clear scope
					</button>
				)}
			</div>

			<div className="layout">
				<nav className="rail">
					<div className="rail-label">Source</div>
					<button
						className="source-btn"
						data-active={source === 'all'}
						onClick={() => setSource('all')}
						type="button"
					>
						<span>all</span>
						<span className="n">{catalog.meta.length}</span>
					</button>
					{sources.map(([name, count]) => (
						<button
							className="source-btn"
							data-active={source === name}
							key={name}
							onClick={() => setSource(name)}
							type="button"
						>
							<span>{name}</span>
							<span className="n">{count}</span>
						</button>
					))}
				</nav>

				<main>
					{tab === 'config' &&
						renderConfig(
							visibleBlocks,
							metaByName,
							busyRule,
							matchesSource,
							query,
							save
						)}
					{tab === 'catalog' &&
						renderCatalog(
							catalog.meta,
							configuredByName,
							effectiveByName,
							defaultBlock,
							busyRule,
							matchesSource,
							query,
							save
						)}
					{tab === 'effective' &&
						renderEffective(
							catalog.effective,
							catalog.representativeFile,
							metaByName,
							configuredByName,
							defaultBlock,
							busyRule,
							matchesSource,
							query,
							save
						)}
				</main>
			</div>

			{notice && (
				<div className={`toast ${notice.kind}`}>
					<b>{notice.kind === 'ok' ? '✓' : '✕'}</b>
					{notice.text}
				</div>
			)}
		</div>
	);
};

const renderConfig = (
	blocks: ConfigBlock[],
	metaByName: Map<string, RuleMeta>,
	busyRule: string | null,
	matchesSource: (source: string) => boolean,
	query: string,
	save: (request: SaveRequest) => void
) => {
	const sections = blocks
		.map((block) => {
			const rules = block.rules.filter((rule) => {
				const meta = metaByName.get(rule.name) ?? null;
				const ruleSource = meta?.source ?? 'core';

				return (
					matchesSource(ruleSource) &&
					matchesQuery(query, rule.name, meta?.description ?? null)
				);
			});

			return { block, rules };
		})
		.filter((section) => section.rules.length > 0);

	if (sections.length === 0) {
		return (
			<div className="empty">No configured rules match this filter.</div>
		);
	}

	return sections.map(({ block, rules }) => (
		<section className="section" key={block.sourceIndex}>
			<div className="section-head">
				<h2 className="section-title">{block.label}</h2>
				<span className="section-files">
					block #{block.sourceIndex} · {rules.length} rules
				</span>
			</div>
			{rules.map((rule) => (
				<ConfigRow
					busy={busyRule === rule.name}
					key={`${block.sourceIndex}:${rule.name}`}
					meta={metaByName.get(rule.name) ?? null}
					name={rule.name}
					onSave={(severity, options) =>
						save({
							name: rule.name,
							options,
							severity,
							sourceIndex: block.sourceIndex
						})
					}
					options={rule.options}
					severity={rule.severity}
				/>
			))}
		</section>
	));
};

const renderCatalog = (
	meta: RuleMeta[],
	configuredByName: Map<string, { label: string; sourceIndex: number }>,
	effectiveByName: Map<string, RuleSeverity>,
	defaultBlock: number | null,
	busyRule: string | null,
	matchesSource: (source: string) => boolean,
	query: string,
	save: (request: SaveRequest) => void
) => {
	const matches = meta.filter(
		(entry) =>
			matchesSource(entry.source) &&
			matchesQuery(query, entry.name, entry.description)
	);

	if (matches.length === 0) {
		return <div className="empty">No rules match this filter.</div>;
	}

	const shown = matches.slice(0, CATALOG_RENDER_CAP);

	return (
		<section className="section">
			{shown.map((entry) => {
				const configured = configuredByName.get(entry.name) ?? null;
				const effective =
					configured === null
						? (effectiveByName.get(entry.name) ?? 'off')
						: effectiveSeverity(entry.name, effectiveByName);
				const target = configured?.sourceIndex ?? defaultBlock;

				return (
					<CatalogCard
						busy={busyRule === entry.name}
						configuredLabel={configured?.label ?? null}
						effective={effective}
						key={entry.name}
						meta={entry}
						name={entry.name}
						onChange={(severity) =>
							target !== null &&
							save({
								name: entry.name,
								severity,
								sourceIndex: target
							})
						}
					/>
				);
			})}
			{matches.length > shown.length && (
				<div className="more">
					+{matches.length - shown.length} more — refine your search
					to see them
				</div>
			)}
		</section>
	);
};

const renderEffective = (
	effective: EffectiveRule[],
	representativeFile: string,
	metaByName: Map<string, RuleMeta>,
	configuredByName: Map<string, { label: string; sourceIndex: number }>,
	defaultBlock: number | null,
	busyRule: string | null,
	matchesSource: (source: string) => boolean,
	query: string,
	save: (request: SaveRequest) => void
) => {
	const rows = effective.filter((rule) => {
		const meta = metaByName.get(rule.name) ?? null;
		const ruleSource = meta?.source ?? 'core';

		return (
			matchesSource(ruleSource) &&
			matchesQuery(query, rule.name, meta?.description ?? null)
		);
	});

	if (rows.length === 0) {
		return (
			<div className="empty">
				No effective rules for this file match the filter.
			</div>
		);
	}

	const shown = rows.slice(0, CATALOG_RENDER_CAP);

	return (
		<section className="section">
			<div className="section-head">
				<h2 className="section-title">Effective ruleset</h2>
				<span className="section-files">
					{representativeFile} · {rows.length} rules in effect
				</span>
			</div>
			{shown.map((rule) => {
				const configured = configuredByName.get(rule.name) ?? null;
				const target = configured?.sourceIndex ?? defaultBlock;

				return (
					<CatalogCard
						busy={busyRule === rule.name}
						configuredLabel={configured?.label ?? null}
						effective={rule.severity}
						key={rule.name}
						meta={metaByName.get(rule.name) ?? null}
						name={rule.name}
						onChange={(severity) =>
							target !== null &&
							save({
								name: rule.name,
								severity,
								sourceIndex: target
							})
						}
					/>
				);
			})}
			{rows.length > shown.length && (
				<div className="more">
					+{rows.length - shown.length} more — refine your search to
					see them
				</div>
			)}
		</section>
	);
};

const effectiveSeverity = (
	name: string,
	effectiveByName: Map<string, RuleSeverity>
) => effectiveByName.get(name) ?? 'off';
