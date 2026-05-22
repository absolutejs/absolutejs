import { useState } from 'react';
import type {
	PackageField,
	PackageJsonEditResult,
	PackageJsonState,
	PackageScript
} from '../../../../types/packageJson';

type Notice = {
	kind: 'ok' | 'err';
	text: string;
};

const matchesQuery = (query: string, text: string) =>
	query === '' || text.toLowerCase().includes(query.toLowerCase());

type ScriptRowProps = {
	busy: boolean;
	onRemove: () => void;
	onSave: (command: string) => void;
	script: PackageScript;
};

const ScriptRow = ({ busy, onRemove, onSave, script }: ScriptRowProps) => {
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
						disabled={busy}
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

type FieldRowProps = {
	field: PackageField;
	onSave: (value: unknown, remove?: boolean) => void;
};

const FieldRow = ({ field, onSave }: FieldRowProps) => {
	const [draft, setDraft] = useState(
		field.value === undefined || field.value === null
			? ''
			: String(field.value)
	);

	if (field.kind === 'complex') {
		return (
			<div className="rule">
				<div className="rule-main">
					<div className="rule-name-row">
						<span className="rule-name">{field.name}</span>
						<span className="badge dep">edit in file</span>
					</div>
				</div>
			</div>
		);
	}

	if (field.kind === 'boolean') {
		return (
			<div className="rule">
				<div className="rule-main">
					<div className="rule-name-row">
						<span className="rule-name">{field.name}</span>
					</div>
				</div>
				<div className="rule-controls">
					<div className="seg">
						<button
							data-on={field.value === false}
							onClick={() => onSave(false)}
							type="button"
						>
							false
						</button>
						<button
							data-on={field.value === true}
							onClick={() => onSave(true)}
							type="button"
						>
							true
						</button>
					</div>
				</div>
			</div>
		);
	}

	const commit = () => {
		if (field.kind === 'number') {
			const parsed = Number(draft.trim());
			if (!Number.isNaN(parsed)) onSave(parsed);

			return;
		}
		onSave(draft);
	};

	return (
		<div className="rule">
			<div className="rule-main">
				<div className="rule-name-row">
					<span className="rule-name">{field.name}</span>
				</div>
			</div>
			<div className="rule-controls">
				<div className="ts-control">
					<input
						className="ts-input"
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
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<Notice | null>(null);

	const post = async (path: string, body: unknown) => {
		setBusy(true);
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
		} finally {
			setBusy(false);
		}
	};

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
							busy={busy}
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
							top-level metadata
						</span>
					</div>
					{fields.map((field) => (
						<FieldRow
							field={field}
							key={field.name}
							onSave={(value, remove) =>
								post('/api/package/field', {
									name: field.name,
									remove,
									value
								})
							}
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
