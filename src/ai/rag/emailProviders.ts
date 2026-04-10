import { connect as connectTls } from 'node:tls';
import type {
	RAGEmailSyncAttachment,
	RAGEmailSyncClient,
	RAGEmailSyncListInput,
	RAGEmailSyncListResult,
	RAGEmailSyncMessage
} from '../../../types/ai';

export type GmailEmailSyncConfig = {
	accessToken: string;
	userId?: string;
	query?: string;
	labelIds?: string[];
	includeSpamTrash?: boolean;
	maxResults?: number;
	fetch?: typeof fetch;
};

export type GraphEmailSyncConfig = {
	accessToken: string;
	baseUrl?: string;
	userId?: string;
	folderId?: string;
	filter?: string;
	search?: string;
	top?: number;
	fetch?: typeof fetch;
};

export type IMAPEmailSyncConfig = {
	host: string;
	port?: number;
	secure?: boolean;
	username: string;
	password: string;
	mailbox?: string;
	search?: string[];
	maxResults?: number;
};

const defaultFetch = (...args: Parameters<typeof fetch>) => fetch(...args);

const stripHtml = (value: string) =>
	value
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/\s+/g, ' ')
		.trim();

const decodeBase64Url = (value: string) => {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padding =
		normalized.length % 4 === 0
			? ''
			: '='.repeat(4 - (normalized.length % 4));

	return Buffer.from(normalized + padding, 'base64');
};

const firstHeader = (
	headers: Array<{ name?: string; value?: string }> | undefined,
	name: string
) =>
	headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
		?.value;

type GmailPayload = {
	body?: { data?: string; attachmentId?: string };
	filename?: string;
	headers?: Array<{ name?: string; value?: string }>;
	mimeType?: string;
	partId?: string;
	parts?: GmailPayload[];
};

const collectGmailPayloadParts = (
	payload: GmailPayload | undefined
): GmailPayload[] => {
	if (!payload) {
		return [];
	}

	return [
		payload,
		...(payload.parts ?? []).flatMap((part) =>
			collectGmailPayloadParts(part)
		)
	];
};

const extractGmailBodyText = (payload: GmailPayload | undefined) => {
	const parts = collectGmailPayloadParts(payload);
	const plain = parts.find(
		(part) =>
			part.mimeType?.toLowerCase() === 'text/plain' && part.body?.data
	);
	if (plain?.body?.data) {
		return decodeBase64Url(plain.body.data).toString('utf8');
	}

	const html = parts.find(
		(part) =>
			part.mimeType?.toLowerCase() === 'text/html' && part.body?.data
	);
	if (html?.body?.data) {
		return stripHtml(decodeBase64Url(html.body.data).toString('utf8'));
	}

	if (payload?.body?.data) {
		return decodeBase64Url(payload.body.data).toString('utf8');
	}

	return '';
};

const toGraphAddressList = (
	value: Array<{ emailAddress?: { address?: string } }> | undefined
) =>
	value?.map((entry) => entry.emailAddress?.address).filter(Boolean) as
		| string[]
		| undefined;

const toGraphAttachment = (attachment: {
	id?: string;
	name?: string;
	contentType?: string;
	contentBytes?: string;
}) =>
	attachment.name && attachment.contentBytes
		? ({
				content: attachment.contentBytes,
				contentType: attachment.contentType,
				encoding: 'base64',
				id: attachment.id,
				name: attachment.name
			} satisfies RAGEmailSyncAttachment)
		: null;

const buildGraphPath = (config: GraphEmailSyncConfig) => {
	const base =
		config.userId && config.userId !== 'me'
			? `/users/${encodeURIComponent(config.userId)}`
			: '/me';

	return config.folderId
		? `${base}/mailFolders/${encodeURIComponent(config.folderId)}/messages`
		: `${base}/messages`;
};

const parseRawEmail = (raw: string): RAGEmailSyncMessage => {
	const [headerBlock, ...bodyBlocks] = raw.split(/\r?\n\r?\n/);
	const body = bodyBlocks.join('\n\n').trim();
	const lines = (headerBlock ?? '').split(/\r?\n/);
	const headers = new Map<string, string>();
	let current = '';

	for (const line of lines) {
		if (/^\s/.test(line) && current) {
			headers.set(
				current,
				`${headers.get(current) ?? ''} ${line.trim()}`.trim()
			);
			continue;
		}

		const separator = line.indexOf(':');
		if (separator < 0) {
			continue;
		}

		current = line.slice(0, separator).trim().toLowerCase();
		headers.set(current, line.slice(separator + 1).trim());
	}

	const toList = (value: string | undefined) =>
		value
			?.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean);

	return {
		bodyText: body,
		cc: toList(headers.get('cc')),
		from: headers.get('from'),
		id:
			headers.get('message-id') ??
			headers.get('subject') ??
			crypto.randomUUID(),
		receivedAt: headers.get('date'),
		subject: headers.get('subject'),
		threadId:
			headers.get('thread-topic') ??
			headers.get('references') ??
			headers.get('subject'),
		to: toList(headers.get('to'))
	};
};

export const createRAGGmailEmailSyncClient = (
	config: GmailEmailSyncConfig
): RAGEmailSyncClient => ({
	listMessages: async (
		input?: RAGEmailSyncListInput
	): Promise<RAGEmailSyncListResult> => {
		const fetchImpl = config.fetch ?? defaultFetch;
		const userId = config.userId ?? 'me';
		const listUrl = new URL(
			`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userId)}/messages`
		);
		listUrl.searchParams.set(
			'maxResults',
			String(input?.maxResults ?? config.maxResults ?? 100)
		);
		if (input?.cursor) {
			listUrl.searchParams.set('pageToken', input.cursor);
		}
		if (config.query) {
			listUrl.searchParams.set('q', config.query);
		}
		for (const labelId of config.labelIds ?? []) {
			listUrl.searchParams.append('labelIds', labelId);
		}
		if (config.includeSpamTrash) {
			listUrl.searchParams.set('includeSpamTrash', 'true');
		}

		const listResponse = await fetchImpl(listUrl, {
			headers: { Authorization: `Bearer ${config.accessToken}` }
		});
		if (!listResponse.ok) {
			throw new Error(
				`Gmail list failed: ${listResponse.status} ${listResponse.statusText}`
			);
		}

		const listJson = (await listResponse.json()) as {
			messages?: Array<{ id: string; threadId?: string }>;
			nextPageToken?: string;
		};

		const messages = await Promise.all(
			(listJson.messages ?? []).map(async (messageRef) => {
				const getUrl = new URL(
					`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageRef.id)}`
				);
				getUrl.searchParams.set('format', 'full');
				const response = await fetchImpl(getUrl, {
					headers: { Authorization: `Bearer ${config.accessToken}` }
				});
				if (!response.ok) {
					throw new Error(
						`Gmail get failed for ${messageRef.id}: ${response.status} ${response.statusText}`
					);
				}

				const json = (await response.json()) as {
					id: string;
					threadId?: string;
					internalDate?: string;
					labelIds?: string[];
					payload?: GmailPayload;
					snippet?: string;
				};

				const attachments = await Promise.all(
					collectGmailPayloadParts(json.payload)
						.filter(
							(part) =>
								!!part.filename && !!part.body?.attachmentId
						)
						.map(async (part) => {
							const attachmentUrl = new URL(
								`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(json.id)}/attachments/${encodeURIComponent(part.body?.attachmentId ?? '')}`
							);
							const attachmentResponse = await fetchImpl(
								attachmentUrl,
								{
									headers: {
										Authorization: `Bearer ${config.accessToken}`
									}
								}
							);
							if (!attachmentResponse.ok) {
								return null;
							}

							const attachmentJson =
								(await attachmentResponse.json()) as {
									data?: string;
								};
							if (!attachmentJson.data || !part.filename) {
								return null;
							}

							return {
								content: decodeBase64Url(
									attachmentJson.data
								).toString('base64'),
								contentType: part.mimeType,
								encoding: 'base64',
								id: part.body?.attachmentId,
								name: part.filename
							} satisfies RAGEmailSyncAttachment;
						})
				);

				return {
					attachments: attachments.filter(
						Boolean
					) as RAGEmailSyncAttachment[],
					bodyText:
						extractGmailBodyText(json.payload) ||
						json.snippet ||
						'',
					cc: firstHeader(json.payload?.headers, 'Cc')
						?.split(',')
						.map((entry) => entry.trim())
						.filter(Boolean),
					from: firstHeader(json.payload?.headers, 'From'),
					id: json.id,
					metadata: {
						gmailLabelIds: json.labelIds,
						provider: 'gmail'
					},
					receivedAt: json.internalDate
						? Number(json.internalDate)
						: undefined,
					subject: firstHeader(json.payload?.headers, 'Subject'),
					threadId: json.threadId ?? messageRef.threadId,
					to: firstHeader(json.payload?.headers, 'To')
						?.split(',')
						.map((entry) => entry.trim())
						.filter(Boolean)
				} satisfies RAGEmailSyncMessage;
			})
		);

		return {
			messages,
			nextCursor: listJson.nextPageToken
		};
	}
});

export const createRAGGraphEmailSyncClient = (
	config: GraphEmailSyncConfig
): RAGEmailSyncClient => ({
	listMessages: async (
		input?: RAGEmailSyncListInput
	): Promise<RAGEmailSyncListResult> => {
		const fetchImpl = config.fetch ?? defaultFetch;
		const url = new URL(
			`${config.baseUrl ?? 'https://graph.microsoft.com/v1.0'}${buildGraphPath(config)}`
		);
		url.searchParams.set(
			'$select',
			'id,conversationId,subject,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,body,hasAttachments,internetMessageId'
		);
		url.searchParams.set(
			'$top',
			String(input?.maxResults ?? config.top ?? 100)
		);
		if (config.filter) {
			url.searchParams.set('$filter', config.filter);
		}
		if (config.search) {
			url.searchParams.set('$search', config.search);
		}
		if (input?.cursor) {
			return {
				messages: [],
				nextCursor: input.cursor
			};
		}

		const listResponse = await fetchImpl(url, {
			headers: {
				Authorization: `Bearer ${config.accessToken}`,
				Prefer: 'outlook.body-content-type="text"'
			}
		});
		if (!listResponse.ok) {
			throw new Error(
				`Graph message list failed: ${listResponse.status} ${listResponse.statusText}`
			);
		}

		const listJson = (await listResponse.json()) as {
			value?: Array<Record<string, unknown>>;
			'@odata.nextLink'?: string;
		};

		const messages = await Promise.all(
			(listJson.value ?? []).map(async (message) => {
				const attachments =
					message.hasAttachments === true
						? await (async () => {
								const attachmentsResponse = await fetchImpl(
									`${config.baseUrl ?? 'https://graph.microsoft.com/v1.0'}${buildGraphPath(config)}/${encodeURIComponent(String(message.id))}/attachments`,
									{
										headers: {
											Authorization: `Bearer ${config.accessToken}`
										}
									}
								);
								if (!attachmentsResponse.ok) {
									return [] as RAGEmailSyncAttachment[];
								}

								const attachmentsJson =
									(await attachmentsResponse.json()) as {
										value?: Array<{
											id?: string;
											name?: string;
											contentType?: string;
											contentBytes?: string;
										}>;
									};

								return (attachmentsJson.value ?? [])
									.map((attachment) =>
										toGraphAttachment(attachment)
									)
									.filter(
										Boolean
									) as RAGEmailSyncAttachment[];
							})()
						: [];

				return {
					attachments,
					bodyText:
						typeof (message.body as { content?: unknown })
							?.content === 'string'
							? String(
									(message.body as { content?: string })
										.content
								)
							: '',
					cc: toGraphAddressList(
						message.ccRecipients as Array<{
							emailAddress?: { address?: string };
						}>
					),
					from: (
						message.from as { emailAddress?: { address?: string } }
					)?.emailAddress?.address,
					id: String(message.id),
					metadata: {
						internetMessageId: message.internetMessageId,
						provider: 'graph'
					},
					receivedAt: message.receivedDateTime as string | undefined,
					sentAt: message.sentDateTime as string | undefined,
					subject: message.subject as string | undefined,
					threadId: message.conversationId as string | undefined,
					to: toGraphAddressList(
						message.toRecipients as Array<{
							emailAddress?: { address?: string };
						}>
					)
				} satisfies RAGEmailSyncMessage;
			})
		);

		return {
			messages,
			nextCursor: listJson['@odata.nextLink']
		};
	}
});

export const createRAGIMAPEmailSyncClient = (
	config: IMAPEmailSyncConfig
): RAGEmailSyncClient => ({
	listMessages: async (
		input?: RAGEmailSyncListInput
	): Promise<RAGEmailSyncListResult> => {
		const mailbox = config.mailbox ?? 'INBOX';
		const searchTerms = config.search?.length ? config.search : ['ALL'];
		const maxResults = input?.maxResults ?? config.maxResults ?? 100;
		const socket = connectTls({
			host: config.host,
			port: config.port ?? 993,
			rejectUnauthorized: true
		});
		socket.setEncoding('utf8');

		let buffer = '';
		const readUntil = async (predicate: (chunk: string) => boolean) =>
			await new Promise<string>((resolve, reject) => {
				const onData = (chunk: string) => {
					buffer += chunk;
					if (predicate(buffer)) {
						socket.off('data', onData);
						resolve(buffer);
					}
				};
				const onError = (error: Error) => {
					socket.off('data', onData);
					reject(error);
				};
				socket.on('data', onData);
				socket.once('error', onError);
			});

		const send = async (tag: string, command: string) => {
			socket.write(`${tag} ${command}\r\n`);
			const response = await readUntil(
				(chunk) =>
					chunk.includes(`\r\n${tag} OK`) ||
					chunk.startsWith(`${tag} OK`)
			);
			buffer = '';
			return response;
		};

		await readUntil(
			(chunk) => chunk.includes('\r\n') || chunk.startsWith('*')
		);
		buffer = '';
		await send('A001', `LOGIN "${config.username}" "${config.password}"`);
		await send('A002', `SELECT "${mailbox}"`);
		const searchResponse = await send(
			'A003',
			`UID SEARCH ${searchTerms.join(' ')}`
		);
		const uidLine = searchResponse
			.split(/\r?\n/)
			.find((line) => line.startsWith('* SEARCH'));
		const uids = (
			uidLine?.replace('* SEARCH', '').trim().split(/\s+/) ?? []
		)
			.filter(Boolean)
			.slice(-maxResults);

		const messages: RAGEmailSyncMessage[] = [];
		for (const uid of uids) {
			const response = await send(
				`F${uid}`,
				`UID FETCH ${uid} BODY.PEEK[]`
			);
			const rawMatch = response.match(
				/\{(\d+)\}\r\n([\s\S]*?)\r\nF[^\r\n]+ OK/
			);
			const raw = rawMatch?.[2]?.trim();
			if (!raw) {
				continue;
			}

			const parsed = parseRawEmail(raw);
			messages.push({
				...parsed,
				metadata: {
					...(parsed.metadata ?? {}),
					imapMailbox: mailbox,
					imapUid: uid,
					provider: 'imap'
				}
			});
		}

		socket.end('ZZZZ LOGOUT\r\n');
		return { messages };
	}
});
