import { useState } from 'react';
import { isRecord } from '../guards';
import type { FieldSchema } from '../../../../types/config';

type EditorProps = {
	onChange: (value: unknown) => void;
	schema: FieldSchema;
	value: unknown;
};

// A sensible empty value for a schema, used when adding array items / setting
// optional object fields.
export const emptyValue = (schema: FieldSchema): unknown => {
	switch (schema.kind) {
		case 'string':
			return '';
		case 'number':
			return 0;
		case 'boolean':
			return false;
		case 'enum':
			return schema.choices[0] ?? '';
		case 'array':
			return [];
		case 'tuple':
			return schema.items.map(emptyValue);
		case 'record':
			return {};
		case 'object':
			return {};
		case 'union':
			return schema.variants[0] ? emptyValue(schema.variants[0]) : null;
		default:
			return null;
	}
};

const StringField = ({ onChange, value }: EditorProps) => (
	<input
		className="ts-input"
		onChange={(event) => onChange(event.target.value)}
		spellCheck={false}
		value={typeof value === 'string' ? value : ''}
	/>
);

const NumberField = ({ onChange, value }: EditorProps) => (
	<input
		className="ts-input"
		onChange={(event) =>
			onChange(
				event.target.value === '' ? '' : Number(event.target.value)
			)
		}
		type="number"
		value={typeof value === 'number' ? value : ''}
	/>
);

const BooleanField = ({ onChange, value }: EditorProps) => (
	<div className="seg">
		<button
			data-on={value === false}
			onClick={() => onChange(false)}
			type="button"
		>
			false
		</button>
		<button
			data-on={value === true}
			onClick={() => onChange(true)}
			type="button"
		>
			true
		</button>
	</div>
);

const EnumField = ({ onChange, schema, value }: EditorProps) => {
	if (schema.kind !== 'enum') return null;

	return (
		<select
			className="ts-select"
			onChange={(event) => {
				const next = schema.choices.find(
					(choice) => String(choice) === event.target.value
				);
				onChange(next ?? event.target.value);
			}}
			value={String(value ?? '')}
		>
			{schema.choices.map((choice) => (
				<option key={String(choice)} value={String(choice)}>
					{String(choice)}
				</option>
			))}
		</select>
	);
};

const RawField = ({ onChange, schema, value }: EditorProps) => {
	const [draft, setDraft] = useState(
		value === undefined ? '' : JSON.stringify(value, null, 2)
	);
	const [error, setError] = useState<string | null>(null);

	return (
		<div className="fe-raw">
			<textarea
				className={error ? 'opts-input err' : 'opts-input'}
				onChange={(event) => {
					setDraft(event.target.value);
					try {
						onChange(
							event.target.value === ''
								? undefined
								: JSON.parse(event.target.value)
						);
						setError(null);
					} catch (parseError) {
						setError(String(parseError));
					}
				}}
				rows={4}
				spellCheck={false}
				value={draft}
			/>
			{schema.kind === 'opaque' && (
				<div className="fe-type">{schema.typeText}</div>
			)}
			{error && <div className="ts-err">{error}</div>}
		</div>
	);
};

const ArrayField = ({ onChange, schema, value }: EditorProps) => {
	if (schema.kind !== 'array') return null;
	const items = Array.isArray(value) ? value : [];

	return (
		<div className="fe-array">
			{items.map((item, index) => (
				<div className="fe-item" key={index}>
					<FieldEditor
						onChange={(next) =>
							onChange(
								items.map((existing, i) =>
									i === index ? next : existing
								)
							)
						}
						schema={schema.item}
						value={item}
					/>
					<button
						className="fe-remove"
						onClick={() =>
							onChange(items.filter((_, i) => i !== index))
						}
						type="button"
					>
						×
					</button>
				</div>
			))}
			<button
				className="fe-add"
				onClick={() => onChange([...items, emptyValue(schema.item)])}
				type="button"
			>
				+ add
			</button>
		</div>
	);
};

const TupleField = ({ onChange, schema, value }: EditorProps) => {
	if (schema.kind !== 'tuple') return null;
	const items = Array.isArray(value) ? value : [];

	return (
		<div className="fe-array">
			{schema.items.map((itemSchema, index) => (
				<div className="fe-item" key={index}>
					<FieldEditor
						onChange={(next) =>
							onChange(
								schema.items.map((_, i) =>
									i === index ? next : items[i]
								)
							)
						}
						schema={itemSchema}
						value={items[index]}
					/>
				</div>
			))}
		</div>
	);
};

const RecordField = ({ onChange, schema, value }: EditorProps) => {
	if (schema.kind !== 'record') return null;
	const entries = isRecord(value) ? Object.entries(value) : [];

	const rename = (from: string, to: string) => {
		const next: Record<string, unknown> = {};
		for (const [key, val] of entries) next[key === from ? to : key] = val;
		onChange(next);
	};
	const setValue = (key: string, val: unknown) =>
		onChange(
			Object.fromEntries(
				entries.map((e) => (e[0] === key ? [key, val] : e))
			)
		);
	const remove = (key: string) =>
		onChange(Object.fromEntries(entries.filter((e) => e[0] !== key)));

	return (
		<div className="fe-record">
			{entries.map(([key, val]) => (
				<div className="fe-entry" key={key}>
					<input
						className="ts-input fe-key"
						onChange={(event) => rename(key, event.target.value)}
						spellCheck={false}
						value={key}
					/>
					<FieldEditor
						onChange={(next) => setValue(key, next)}
						schema={schema.value}
						value={val}
					/>
					<button
						className="fe-remove"
						onClick={() => remove(key)}
						type="button"
					>
						×
					</button>
				</div>
			))}
			<button
				className="fe-add"
				onClick={() =>
					onChange({
						...Object.fromEntries(entries),
						'': emptyValue(schema.value)
					})
				}
				type="button"
			>
				+ add key
			</button>
		</div>
	);
};

const ObjectField = ({ onChange, schema, value }: EditorProps) => {
	if (schema.kind !== 'object') return null;
	const current = isRecord(value) ? value : {};

	const setField = (name: string, next: unknown) => {
		if (next === undefined) {
			const rest: Record<string, unknown> = { ...current };
			delete rest[name];
			onChange(rest);

			return;
		}
		onChange({ ...current, [name]: next });
	};

	return (
		<div className="fe-object">
			{schema.fields.map((field) => {
				const present = Object.prototype.hasOwnProperty.call(
					current,
					field.name
				);

				return (
					<div className="fe-field" key={field.name}>
						<div className="fe-label">
							<span className="fe-name">{field.name}</span>
							{field.optional && present && (
								<button
									className="fe-remove"
									onClick={() =>
										setField(field.name, undefined)
									}
									type="button"
								>
									unset
								</button>
							)}
						</div>
						{field.optional && !present ? (
							<button
								className="fe-add"
								onClick={() =>
									setField(
										field.name,
										emptyValue(field.schema)
									)
								}
								type="button"
							>
								+ set {field.name}
							</button>
						) : (
							<FieldEditor
								onChange={(next) => setField(field.name, next)}
								schema={field.schema}
								value={current[field.name]}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
};

const UnionField = ({ onChange, schema, value }: EditorProps) => {
	if (schema.kind !== 'union') return null;
	const matches = (variant: FieldSchema) => {
		if (variant.kind === 'string' || variant.kind === 'enum')
			return typeof value === 'string';
		if (variant.kind === 'number') return typeof value === 'number';
		if (variant.kind === 'boolean') return typeof value === 'boolean';
		if (variant.kind === 'array') return Array.isArray(value);
		if (variant.kind === 'object' || variant.kind === 'record')
			return isRecord(value);

		return false;
	};
	const activeIndex = Math.max(0, schema.variants.findIndex(matches));
	const active = schema.variants[activeIndex];

	return (
		<div className="fe-union">
			<select
				className="ts-select"
				onChange={(event) => {
					const variant = schema.variants[Number(event.target.value)];
					if (variant) onChange(emptyValue(variant));
				}}
				value={String(activeIndex)}
			>
				{schema.variants.map((variant, index) => (
					<option key={index} value={String(index)}>
						{variant.kind}
					</option>
				))}
			</select>
			{active && (
				<FieldEditor
					onChange={onChange}
					schema={active}
					value={value}
				/>
			)}
		</div>
	);
};

export const FieldEditor = (props: EditorProps) => {
	switch (props.schema.kind) {
		case 'string':
			return <StringField {...props} />;
		case 'number':
			return <NumberField {...props} />;
		case 'boolean':
			return <BooleanField {...props} />;
		case 'enum':
			return <EnumField {...props} />;
		case 'array':
			return <ArrayField {...props} />;
		case 'tuple':
			return <TupleField {...props} />;
		case 'record':
			return <RecordField {...props} />;
		case 'object':
			return <ObjectField {...props} />;
		case 'union':
			return <UnionField {...props} />;
		default:
			return <RawField {...props} />;
	}
};
