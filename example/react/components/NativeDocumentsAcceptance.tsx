import { documents, type DeviceDocument } from '@absolutejs/devices';
import { useState } from 'react';

const errorCode = (error: unknown) => {
	if (typeof error === 'object' && error !== null) {
		const code = Reflect.get(error, 'code');
		if (typeof code === 'string') return code;
	}

	return 'unknown';
};

const safeMetadata = (document: DeviceDocument) =>
	`${document.name} · ${document.mimeType} · ${document.sizeBytes} bytes`;

export const NativeDocumentsAcceptance = () => {
	const [capability, setCapability] = useState('not-queried');
	const [detail, setDetail] = useState('Ready');
	const [error, setError] = useState('none');
	const [picked, setPicked] = useState('none');

	const run = async (action: () => Promise<void>, success: string) => {
		try {
			await action();
			setDetail(success);
			setError('none');
		} catch (caught) {
			setDetail(`${success} failed`);
			setError(errorCode(caught));
		}
	};

	return (
		<main>
			<h1>AbsoluteJS Documents</h1>
			<p id="documents-detail">{detail}</p>
			<dl id="documents-status">
				<dt>Capability</dt>
				<dd data-capability={capability}>{capability}</dd>
				<dt>Selected metadata</dt>
				<dd data-picked={picked === 'none' ? 'none' : 'received'}>
					{picked}
				</dd>
				<dt>Error</dt>
				<dd data-error={error}>{error}</dd>
			</dl>
			<button
				id="documents-query"
				onClick={() =>
					void run(async () => {
						const status = await documents.capability('pick');
						setCapability(
							status.available ? status.fidelity : status.reason
						);
					}, 'Documents capability queried')
				}
			>
				Query capability
			</button>
			<button
				id="documents-pick"
				onClick={() =>
					void run(async () => {
						const selected = await documents.pick({
							accept: ['application/pdf', 'text/plain', '.csv'],
							limit: 2
						});
						setPicked(selected.map(safeMetadata).join(' | '));
					}, 'Document selection completed')
				}
			>
				Pick documents
			</button>
			<button
				id="documents-export"
				onClick={() =>
					void run(async () => {
						await documents.export({
							content: 'AbsoluteJS portable document export\n',
							name: 'absolutejs-document-test.txt'
						});
					}, 'Document export sheet completed')
				}
			>
				Export document
			</button>
			<button
				id="documents-open"
				onClick={() =>
					void run(async () => {
						await documents.open({
							content: 'AbsoluteJS portable document preview\n',
							name: 'absolutejs-document-preview.txt'
						});
					}, 'Document preview completed')
				}
			>
				Open document
			</button>
		</main>
	);
};
