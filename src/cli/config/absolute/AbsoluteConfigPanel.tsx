import { useState } from 'react';
import type {
	AbsoluteConfigEditResult,
	AbsoluteConfigState
} from '../../../../types/absoluteConfig';
import type { ConfigField } from '../../../../types/config';

type Notice = {
	kind: 'ok' | 'err';
	text: string;
};

type SaveFn = (value: unknown, remove?: boolean) => void;

const matchesQuery = (query: string, name: string, description: string) => {
	if (query === '') return true;
	const needle = query.toLowerCase();

	return (
		name.toLowerCase().includes(needle) ||
		description.toLowerCase().includes(needle)
	);
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
	choices: string[];
	isSet: boolean;
	onSave: SaveFn;
	value: unknown;
};

const EnumControl = ({ choices, isSet, onSave, value }: EnumControlProps) => (
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
		{choices.map((choice) => (
			<option key={choice} value={choice}>
				{choice}
			</option>
		))}
	</select>
);

type TextControlProps = {
	numeric: boolean;
	onSave: SaveFn;
	value: unknown;
};

const TextControl = ({ numeric, onSave, value }: TextControlProps) => {
	const [draft, setDraft] = useState(
		value === undefined ? '' : String(value)
	);
	const [error, setError] = useState<string | null>(null);

	const commit = () => {
		const text = draft.trim();
		if (text === '') {
			onSave(undefined, true);
			setError(null);

			return;
		}
		if (numeric) {
			const parsed = Number(text);
			if (Number.isNaN(parsed)) {
				setError('Must be a number');

				return;
			}
			onSave(parsed);
			setError(null);

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
					placeholder={numeric ? 'e.g. 3000' : 'value'}
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

type ControlProps = {
	busy: boolean;
	field: ConfigField;
	isSet: boolean;
	onSave: SaveFn;
	value: unknown;
};

const Control = ({ busy, field, isSet, onSave, value }: ControlProps) => {
	if (field.kind === 'boolean') {
		return (
			<BooleanControl
				busy={busy}
				isSet={isSet}
				onSave={onSave}
				value={value}
			/>
		);
	}
	if (field.kind === 'enum') {
		return (
			<EnumControl
				choices={field.choices}
				isSet={isSet}
				onSave={onSave}
				value={value}
			/>
		);
	}

	return (
		<TextControl
			numeric={field.kind === 'number'}
			onSave={onSave}
			value={value}
		/>
	);
};

type RowProps = {
	busy: string | null;
	complexKeys: string[];
	current: Record<string, unknown>;
	onSave: (name: string) => SaveFn;
	field: ConfigField;
};

const FieldRow = ({ busy, complexKeys, current, onSave, field }: RowProps) => {
	const editable = field.kind !== 'complex';
	const isSet = editable
		? Object.prototype.hasOwnProperty.call(current, field.name)
		: complexKeys.includes(field.name);

	return (
		<div className="rule">
			<div className="rule-main">
				<div className="rule-name-row">
					<span className="rule-name">{field.name}</span>
					{isSet && <span className="badge src">set</span>}
					{!editable && (
						<span className="badge dep">edit in file</span>
					)}
					<span className="ts-default">{field.typeText}</span>
				</div>
				{field.description !== '' && (
					<p className="rule-desc">{field.description}</p>
				)}
			</div>
			{editable && (
				<div className="rule-controls">
					<Control
						busy={busy === field.name}
						field={field}
						isSet={isSet}
						onSave={onSave(field.name)}
						value={current[field.name]}
					/>
				</div>
			)}
		</div>
	);
};

type AbsoluteConfigPanelProps = {
	state: AbsoluteConfigState;
};

export const AbsoluteConfigPanel = ({
	state: initial
}: AbsoluteConfigPanelProps) => {
	const [state, setState] = useState(initial);
	const [query, setQuery] = useState('');
	const [busy, setBusy] = useState<string | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);

	const visible = state.fields.filter((field) =>
		matchesQuery(query, field.name, field.description)
	);
	const editable = visible.filter((field) => field.kind !== 'complex');
	const advanced = visible.filter((field) => field.kind === 'complex');

	const save = (name: string) => async (value: unknown, remove?: boolean) => {
		setBusy(name);
		setNotice(null);
		try {
			const response = await fetch('/api/absolute', {
				body: JSON.stringify({ name, remove, value }),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			});
			const result: AbsoluteConfigEditResult = await response.json();
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

	const renderRows = (fields: ConfigField[]) =>
		fields.map((field) => (
			<FieldRow
				busy={busy}
				complexKeys={state.complexKeys}
				current={state.current}
				field={field}
				key={field.name}
				onSave={save}
			/>
		));

	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">
					<h1 className="wordmark">
						absolute.config <em>·ts</em>
					</h1>
					<div className="subpath">
						<span className="dot" />
						{state.configPath ?? 'no absolute.config.ts found'}
					</div>
				</div>
				<div className="counts">
					<div className="count">
						<b>{Object.keys(state.current).length}</b>
						<span>set</span>
					</div>
					<div className="count">
						<b>{editable.length}</b>
						<span>editable</span>
					</div>
				</div>
			</header>

			<div className="controls">
				<input
					className="search"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search config fields…"
					value={query}
				/>
			</div>

			<main>
				{editable.length === 0 && advanced.length === 0 && (
					<div className="empty">
						No config fields match this filter.
					</div>
				)}
				{editable.length > 0 && (
					<section className="section">
						<div className="section-head">
							<h2 className="section-title">Fields</h2>
							<span className="section-files">
								{editable.length} editable
							</span>
						</div>
						{renderRows(editable)}
					</section>
				)}
				{advanced.length > 0 && (
					<section className="section">
						<div className="section-head">
							<h2 className="section-title">Advanced</h2>
							<span className="section-files">
								object/array fields — edit in the file
							</span>
						</div>
						{renderRows(advanced)}
					</section>
				)}
			</main>

			{notice && (
				<div className={`toast ${notice.kind}`}>
					<b>{notice.kind === 'ok' ? '✓' : '✕'}</b>
					{notice.text}
				</div>
			)}
		</div>
	);
};
