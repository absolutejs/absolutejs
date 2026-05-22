import { useState } from 'react';
import type { ConfigField } from '../../../../types/config';
import type {
	PackageJsonEditResult,
	PackageJsonState,
	PackageScript
} from '../../../../types/packageJsonPanel';

type Notice = {
	kind: 'ok' | 'err';
	text: string;
};

type SaveFn = (value: unknown, remove?: boolean) => void;

const matchesQuery = (query: string, text: string) =>
	query === '' || text.toLowerCase().includes(query.toLowerCase());

type BooleanControlProps = {
	isSet: boolean;
	onSave: SaveFn;
	value: unknown;
};

const BooleanControl = ({ isSet, onSave, value }: BooleanControlProps) => (
	<div className="ts-control">
		<div className="seg">
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

type ChoiceControlProps = {
	choices: string[];
	isSet: boolean;
	onSave: SaveFn;
	value: unknown;
};

const ChoiceControl = ({
	choices,
	isSet,
	onSave,
	value
}: ChoiceControlProps) => (
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

type FieldRowProps = {
	complexKeys: string[];
	current: Record<string, unknown>;
	field: ConfigField;
	onSave: (name: string) => SaveFn;
};

const FieldRow = ({ complexKeys, current, field, onSave }: FieldRowProps) => {
	const editable = field.kind !== 'complex';
	const isSet = editable
		? Object.prototype.hasOwnProperty.call(current, field.name)
		: complexKeys.includes(field.name);
	const value = current[field.name];

	const control = () => {
		if (field.kind === 'boolean') {
			return (
				<BooleanControl
					isSet={isSet}
					onSave={onSave(field.name)}
					value={value}
				/>
			);
		}
		if (field.kind === 'enum') {
			return (
				<ChoiceControl
					choices={field.choices}
					isSet={isSet}
					onSave={onSave(field.name)}
					value={value}
				/>
			);
		}

		return (
			<TextControl
				numeric={field.kind === 'number'}
				onSave={onSave(field.name)}
				value={value}
			/>
		);
	};

	return (
		<div className="rule">
			<div className="rule-main">
				<div className="rule-name-row">
					<span className="rule-name">{field.name}</span>
					{isSet && <span className="badge src">set</span>}
					{!editable && (
						<span className="badge dep">edit in file</span>
					)}
					{field.description !== '' && (
						<span className="ts-default">{field.description}</span>
					)}
				</div>
			</div>
			{editable && <div className="rule-controls">{control()}</div>}
		</div>
	);
};

type ScriptRowProps = {
	onRemove: () => void;
	onSave: (command: string) => void;
	script: PackageScript;
};

const ScriptRow = ({ onRemove, onSave, script }: ScriptRowProps) => {
	const [draft, setDraft] = useState(script.command);

	return (
		<div className="rule">
			<div className="rule-main">
				<div className="rule-name-row">
					<span className="rule-name">{script.name}</span>
				</div>
				<div className="ts-control">
					<input
						className="ts-input wide"
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') onSave(draft);
						}}
						spellCheck={false}
						value={draft}
					/>
					<button
						className="ts-btn"
						onClick={() => onSave(draft)}
						type="button"
					>
						save
					</button>
					<button
						className="ts-clear"
						onClick={onRemove}
						type="button"
					>
						remove
					</button>
				</div>
			</div>
		</div>
	);
};

type AddScriptProps = {
	onAdd: (name: string, command: string) => void;
};

const AddScript = ({ onAdd }: AddScriptProps) => {
	const [name, setName] = useState('');
	const [command, setCommand] = useState('');

	const add = () => {
		if (name.trim() === '') return;
		onAdd(name.trim(), command);
		setName('');
		setCommand('');
	};

	return (
		<div className="rule">
			<div className="rule-main">
				<div className="ts-control">
					<input
						className="ts-input"
						onChange={(event) => setName(event.target.value)}
						placeholder="script name"
						spellCheck={false}
						value={name}
					/>
					<input
						className="ts-input wide"
						onChange={(event) => setCommand(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') add();
						}}
						placeholder="command"
						spellCheck={false}
						value={command}
					/>
					<button className="ts-btn" onClick={add} type="button">
						add
					</button>
				</div>
			</div>
		</div>
	);
};

type PackageJsonPanelProps = {
	state: PackageJsonState;
};

export const PackageJsonPanel = ({ state: initial }: PackageJsonPanelProps) => {
	const [state, setState] = useState(initial);
	const [query, setQuery] = useState('');
	const [notice, setNotice] = useState<Notice | null>(null);

	const post = async (path: string, body: unknown) => {
		setNotice(null);
		try {
			const response = await fetch(path, {
				body: JSON.stringify(body),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			});
			const result: PackageJsonEditResult = await response.json();
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
		}
	};

	const saveField = (name: string) => (value: unknown, remove?: boolean) =>
		post('/api/package/field', { name, remove, value });

	const scripts = state.scripts.filter(
		(script) =>
			matchesQuery(query, script.name) ||
			matchesQuery(query, script.command)
	);
	const visible = state.fields.filter((field) =>
		matchesQuery(query, field.name)
	);
	const editable = visible.filter((field) => field.kind !== 'complex');
	const advanced = visible.filter((field) => field.kind === 'complex');

	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">
					<h1 className="wordmark">
						package <em>.json</em>
					</h1>
					<div className="subpath">
						<span className="dot" />
						{state.configPath ?? 'no package.json found'}
					</div>
				</div>
				<div className="counts">
					<div className="count">
						<b>{state.scripts.length}</b>
						<span>scripts</span>
					</div>
					<div className="count">
						<b>{editable.length}</b>
						<span>fields</span>
					</div>
				</div>
			</header>

			<div className="controls">
				<input
					className="search"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search scripts or fields…"
					value={query}
				/>
			</div>

			<main>
				<section className="section">
					<div className="section-head">
						<h2 className="section-title">Scripts</h2>
						<span className="section-files">
							{state.scripts.length} scripts
						</span>
					</div>
					{scripts.map((script) => (
						<ScriptRow
							key={script.name}
							onRemove={() =>
								post('/api/package/script', {
									name: script.name,
									remove: true
								})
							}
							onSave={(command) =>
								post('/api/package/script', {
									command,
									name: script.name
								})
							}
							script={script}
						/>
					))}
					{query === '' && (
						<AddScript
							onAdd={(name, command) =>
								post('/api/package/script', { command, name })
							}
						/>
					)}
				</section>

				{editable.length > 0 && (
					<section className="section">
						<div className="section-head">
							<h2 className="section-title">Fields</h2>
							<span className="section-files">
								{editable.length} editable
							</span>
						</div>
						{editable.map((field) => (
							<FieldRow
								complexKeys={state.complexKeys}
								current={state.current}
								field={field}
								key={field.name}
								onSave={saveField}
							/>
						))}
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
						{advanced.map((field) => (
							<FieldRow
								complexKeys={state.complexKeys}
								current={state.current}
								field={field}
								key={field.name}
								onSave={saveField}
							/>
						))}
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
