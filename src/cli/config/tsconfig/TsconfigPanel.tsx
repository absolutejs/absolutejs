import { useMemo, useState } from 'react';
import { FieldEditor } from '../page/FieldEditor';
import type { FieldSchema } from '../../../../types/config';
import type {
	TsConfigState,
	TsEditResult,
	TsOption,
	TsOptionKind
} from '../../../../types/tsconfig';

type Notice = {
	kind: 'ok' | 'err';
	text: string;
};

type SaveFn = (value: unknown, remove?: boolean) => void;

const formatValue = (value: unknown) => JSON.stringify(value);

const matchesQuery = (query: string, name: string, description: string) => {
	if (query === '') return true;
	const needle = query.toLowerCase();

	return (
		name.toLowerCase().includes(needle) ||
		description.toLowerCase().includes(needle)
	);
};

const seedText = (kind: TsOptionKind, value: unknown) => {
	if (kind === 'number')
		return typeof value === 'number' ? String(value) : '';
	if (kind === 'list')
		return Array.isArray(value) ? JSON.stringify(value) : '';

	return typeof value === 'string' ? value : '';
};

const placeholderFor = (kind: TsOptionKind) => {
	if (kind === 'number') return 'e.g. 2020';
	if (kind === 'list') return '["DOM", "ESNext"]';

	return 'value';
};

type BooleanControlProps = {
	busy: boolean;
	isSet: boolean;
	onSave: SaveFn;
	value: unknown;
};

const BooleanControl = ({
	busy,
	isSet,
	onSave,
	value
}: BooleanControlProps) => (
	<div className="ts-control">
		<div className={busy ? 'seg busy' : 'seg'}>
			<button
				data-on={value === false}
				onClick={() => onSave(false)}
				type="button"
			>
				false
			</button>
			<button
				data-on={value === true}
				onClick={() => onSave(true)}
				type="button"
			>
				true
			</button>
		</div>
		{isSet && (
			<button
				className="ts-clear"
				onClick={() => onSave(undefined, true)}
				type="button"
			>
				unset
			</button>
		)}
	</div>
);

type EnumControlProps = {
	isSet: boolean;
	onSave: SaveFn;
	option: TsOption;
	value: unknown;
};

const EnumControl = ({ isSet, onSave, option, value }: EnumControlProps) => (
	<select
		className="ts-select"
		onChange={(event) =>
			event.target.value === ''
				? onSave(undefined, true)
				: onSave(event.target.value)
		}
		value={isSet ? String(value) : ''}
	>
		<option value="">— unset —</option>
		{option.enumValues.map((choice) => (
			<option key={choice} value={choice}>
				{choice}
			</option>
		))}
	</select>
);

type TextControlProps = {
	kind: TsOptionKind;
	onSave: SaveFn;
	value: unknown;
};

const TextControl = ({ kind, onSave, value }: TextControlProps) => {
	const [draft, setDraft] = useState(seedText(kind, value));
	const [error, setError] = useState<string | null>(null);

	const commit = () => {
		const text = draft.trim();
		if (text === '') {
			onSave(undefined, true);
			setError(null);

			return;
		}
		if (kind === 'number') {
			const parsed = Number(text);
			if (Number.isNaN(parsed)) {
				setError('Must be a number');

				return;
			}
			onSave(parsed);
			setError(null);

			return;
		}
		if (kind === 'list') {
			try {
				const parsed = JSON.parse(text);
				if (!Array.isArray(parsed)) {
					setError('Must be a JSON array, e.g. ["DOM", "ESNext"]');

					return;
				}
				onSave(parsed);
				setError(null);
			} catch (parseError) {
				setError(String(parseError));
			}

			return;
		}
		onSave(text);
		setError(null);
	};

	return (
		<div>
			<div className="ts-control">
				<input
					className={error ? 'ts-input err' : 'ts-input'}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') commit();
					}}
					placeholder={placeholderFor(kind)}
					spellCheck={false}
					value={draft}
				/>
				<button className="ts-btn" onClick={commit} type="button">
					save
				</button>
			</div>
			{error && <div className="ts-err">{error}</div>}
		</div>
	);
};

type ListControlProps = {
	onSave: SaveFn;
	option: TsOption;
	value: unknown;
};

const ListControl = ({ onSave, option, value }: ListControlProps) => {
	const [draft, setDraft] = useState<unknown>(
		Array.isArray(value) ? value : []
	);
	const schema: FieldSchema = {
		item:
			option.enumValues.length > 0
				? { choices: option.enumValues, kind: 'enum' }
				: { kind: 'string' },
		kind: 'array'
	};

	return (
		<div className="ts-control">
			<div className="fe-root">
				<FieldEditor
					onChange={setDraft}
					schema={schema}
					value={draft}
				/>
			</div>
			<button
				className="ts-btn"
				onClick={() => onSave(draft)}
				type="button"
			>
				save
			</button>
		</div>
	);
};

type ControlProps = {
	busy: boolean;
	isSet: boolean;
	onSave: SaveFn;
	option: TsOption;
	value: unknown;
};

const Control = ({ busy, isSet, onSave, option, value }: ControlProps) => {
	if (option.kind === 'boolean') {
		return (
			<BooleanControl
				busy={busy}
				isSet={isSet}
				onSave={onSave}
				value={value}
			/>
		);
	}
	if (option.kind === 'enum') {
		return (
			<EnumControl
				isSet={isSet}
				onSave={onSave}
				option={option}
				value={value}
			/>
		);
	}
	if (option.kind === 'list') {
		return <ListControl onSave={onSave} option={option} value={value} />;
	}

	return <TextControl kind={option.kind} onSave={onSave} value={value} />;
};

type OptionRowProps = {
	busy: boolean;
	current: Record<string, unknown>;
	onSave: SaveFn;
	option: TsOption;
};

const OptionRow = ({ busy, current, onSave, option }: OptionRowProps) => {
	const isSet = Object.prototype.hasOwnProperty.call(current, option.name);
	const value = current[option.name];

	return (
		<div className="rule">
			<div className="rule-main">
				<div className="rule-name-row">
					<span className="rule-name">{option.name}</span>
					{isSet && <span className="badge src">set</span>}
					{option.defaultLabel !== '' && (
						<span className="ts-default">
							default: {option.defaultLabel}
						</span>
					)}
				</div>
				{option.description !== '' && (
					<p className="rule-desc">{option.description}</p>
				)}
			</div>
			<div className="rule-controls">
				<Control
					busy={busy}
					isSet={isSet}
					onSave={onSave}
					option={option}
					value={value}
				/>
			</div>
		</div>
	);
};

type TsconfigPanelProps = {
	state: TsConfigState;
};

export const TsconfigPanel = ({ state: initial }: TsconfigPanelProps) => {
	const [state, setState] = useState(initial);
	const [query, setQuery] = useState('');
	const [category, setCategory] = useState('all');
	const [busy, setBusy] = useState<string | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);

	const categoryCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const option of state.options) {
			counts.set(option.category, (counts.get(option.category) ?? 0) + 1);
		}

		return counts;
	}, [state.options]);

	const sections = state.categories
		.filter((entry) => category === 'all' || entry === category)
		.map((entry) => ({
			items: state.options.filter(
				(option) =>
					option.category === entry &&
					matchesQuery(query, option.name, option.description)
			),
			label: entry
		}))
		.filter((section) => section.items.length > 0);

	const save = (name: string) => async (value: unknown, remove?: boolean) => {
		setBusy(name);
		setNotice(null);
		try {
			const response = await fetch('/api/tsconfig', {
				body: JSON.stringify({ name, remove, value }),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			});
			const result: TsEditResult = await response.json();
			if (result.ok && result.state) {
				setState(result.state);
				setNotice({ kind: 'ok', text: result.message });
			} else {
				setNotice({
					kind: 'err',
					text: result.message ?? 'Update failed'
				});
			}
		} catch (error) {
			setNotice({ kind: 'err', text: String(error) });
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">
					<h1 className="wordmark">
						tsconfig <em>options</em>
					</h1>
					<div className="subpath">
						<span className="dot" />
						{state.configPath}
					</div>
				</div>
				<div className="counts">
					<div className="count">
						<b>{Object.keys(state.current).length}</b>
						<span>set</span>
					</div>
					<div className="count">
						<b>{state.options.length}</b>
						<span>available</span>
					</div>
				</div>
			</header>

			<div className="controls">
				<input
					className="search"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search options or descriptions…"
					value={query}
				/>
			</div>

			<div className="layout">
				<nav className="rail">
					<div className="rail-label">Category</div>
					<button
						className="source-btn"
						data-active={category === 'all'}
						onClick={() => setCategory('all')}
						type="button"
					>
						<span>all</span>
						<span className="n">{state.options.length}</span>
					</button>
					{state.categories.map((entry) => (
						<button
							className="source-btn"
							data-active={category === entry}
							key={entry}
							onClick={() => setCategory(entry)}
							type="button"
						>
							<span>{entry}</span>
							<span className="n">
								{categoryCounts.get(entry)}
							</span>
						</button>
					))}
				</nav>

				<main>
					{sections.length === 0 ? (
						<div className="empty">
							No options match this filter.
						</div>
					) : (
						sections.map((section) => (
							<section className="section" key={section.label}>
								<div className="section-head">
									<h2 className="section-title">
										{section.label}
									</h2>
									<span className="section-files">
										{section.items.length} options
									</span>
								</div>
								{section.items.map((option) => (
									<OptionRow
										busy={busy === option.name}
										current={state.current}
										key={option.name}
										onSave={save(option.name)}
										option={option}
									/>
								))}
							</section>
						))
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
