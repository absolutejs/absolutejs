import { useState } from 'react';
import { FieldEditor } from '../page/FieldEditor';
import type {
	AbsoluteConfigEditResult,
	AbsoluteConfigState
} from '../../../../types/absoluteConfig';
import type { FieldNode } from '../../../../types/config';

type Notice = {
	kind: 'ok' | 'err';
	text: string;
};

const matchesQuery = (query: string, name: string, description: string) => {
	if (query === '') return true;
	const needle = query.toLowerCase();

	return (
		name.toLowerCase().includes(needle) ||
		description.toLowerCase().includes(needle)
	);
};

type FieldRowProps = {
	busy: boolean;
	field: FieldNode;
	isSet: boolean;
	onSave: (value: unknown, remove?: boolean) => void;
	value: unknown;
};

const FieldRow = ({ busy, field, isSet, onSave, value }: FieldRowProps) => {
	const [draft, setDraft] = useState<unknown>(value);

	return (
		<div className="rule fe-block">
			<div className="rule-main">
				<div className="rule-name-row">
					<span className="rule-name">{field.name}</span>
					{isSet && <span className="badge src">set</span>}
				</div>
				{field.description !== '' && (
					<p className="rule-desc">{field.description}</p>
				)}
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
					disabled={busy}
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

	const opaque = new Set(state.opaqueKeys);
	const visible = state.fields.filter((field) =>
		matchesQuery(query, field.name, field.description)
	);
	const editable = visible.filter((field) => !opaque.has(field.name));
	const advanced = visible.filter((field) => opaque.has(field.name));

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
								busy={busy === field.name}
								field={field}
								isSet={Object.prototype.hasOwnProperty.call(
									state.current,
									field.name
								)}
								key={field.name}
								onSave={save(field.name)}
								value={state.current[field.name]}
							/>
						))}
					</section>
				)}
				{advanced.length > 0 && (
					<section className="section">
						<div className="section-head">
							<h2 className="section-title">Advanced</h2>
							<span className="section-files">
								values reference code — edit in the file
							</span>
						</div>
						{advanced.map((field) => (
							<div className="rule" key={field.name}>
								<div className="rule-main">
									<div className="rule-name-row">
										<span className="rule-name">
											{field.name}
										</span>
										<span className="badge dep">
											edit in file
										</span>
									</div>
									{field.description !== '' && (
										<p className="rule-desc">
											{field.description}
										</p>
									)}
								</div>
							</div>
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
