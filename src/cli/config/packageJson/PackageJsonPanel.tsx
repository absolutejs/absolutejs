import { useState } from 'react';
import { FieldEditor } from '../page/FieldEditor';
import type { FieldNode } from '../../../../types/config';
import type {
	PackageJsonEditResult,
	PackageJsonState,
	PackageScript
} from '../../../../types/packageJsonPanel';

type Notice = {
	kind: 'ok' | 'err';
	text: string;
};

const matchesQuery = (query: string, text: string) =>
	query === '' || text.toLowerCase().includes(query.toLowerCase());

type FieldRowProps = {
	field: FieldNode;
	isSet: boolean;
	onSave: (value: unknown, remove?: boolean) => void;
	value: unknown;
};

const FieldRow = ({ field, isSet, onSave, value }: FieldRowProps) => {
	const [draft, setDraft] = useState<unknown>(value);

	return (
		<div className="rule fe-block">
			<div className="rule-main">
				<div className="rule-name-row">
					<span className="rule-name">{field.name}</span>
					{isSet && <span className="badge src">set</span>}
				</div>
				<div className="fe-root">
					<FieldEditor
						onChange={setDraft}
						schema={field.schema}
						value={draft}
					/>
				</div>
			</div>
			<div className="rule-controls fe-actions">
				<button
					className="ts-btn"
					onClick={() => onSave(draft)}
					type="button"
				>
					save
				</button>
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
	const fields = state.fields.filter((field) =>
		matchesQuery(query, field.name)
	);

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
						<b>{state.fields.length}</b>
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

				<section className="section">
					<div className="section-head">
						<h2 className="section-title">Fields</h2>
						<span className="section-files">
							{state.fields.length} fields
						</span>
					</div>
					{fields.map((field) => (
						<FieldRow
							field={field}
							isSet={Object.prototype.hasOwnProperty.call(
								state.current,
								field.name
							)}
							key={field.name}
							onSave={saveField(field.name)}
							value={state.current[field.name]}
						/>
					))}
				</section>
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
