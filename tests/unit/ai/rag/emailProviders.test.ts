import { describe, expect, it } from 'bun:test';
import {
	createRAGGmailEmailSyncClient,
	createRAGGraphEmailSyncClient
} from '../../../../src/ai/rag/emailProviders';

const createFetch = (
	handler: (url: string) => Response | Promise<Response>
): typeof fetch =>
	Object.assign(
		(input: RequestInfo | URL) =>
			handler(String(input)) as ReturnType<typeof fetch>,
		{ preconnect: fetch.preconnect }
	) as typeof fetch;

describe('RAG email provider adapters', () => {
	it('maps Gmail messages and attachments into email sync messages', async () => {
		const client = createRAGGmailEmailSyncClient({
			accessToken: 'token',
			fetch: createFetch((url) => {
				if (url.includes('/messages?')) {
					return new Response(
						JSON.stringify({
							messages: [{ id: 'msg-1', threadId: 'thread-1' }]
						}),
						{ status: 200 }
					);
				}

				if (url.includes('/attachments/att-1')) {
					return new Response(
						JSON.stringify({
							data: Buffer.from('# Refund Attachment', 'utf8')
								.toString('base64')
								.replace(/\+/g, '-')
								.replace(/\//g, '_')
								.replace(/=+$/g, '')
						}),
						{ status: 200 }
					);
				}

				return new Response(
					JSON.stringify({
						id: 'msg-1',
						labelIds: ['INBOX'],
						payload: {
							headers: [
								{ name: 'Subject', value: 'Refund workflow' },
								{ name: 'From', value: 'ops@example.com' },
								{ name: 'To', value: 'support@example.com' }
							],
							mimeType: 'multipart/mixed',
							parts: [
								{
									body: {
										data: Buffer.from(
											'Refund approvals should preserve sender identity.',
											'utf8'
										)
											.toString('base64')
											.replace(/\+/g, '-')
											.replace(/\//g, '_')
											.replace(/=+$/g, '')
									},
									mimeType: 'text/plain'
								},
								{
									body: { attachmentId: 'att-1' },
									filename: 'refund.md',
									mimeType: 'text/markdown'
								}
							]
						},
						threadId: 'thread-1'
					}),
					{ status: 200 }
				);
			})
		});

		const result = await client.listMessages();
		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]).toMatchObject({
			attachments: [{ name: 'refund.md' }],
			bodyText: 'Refund approvals should preserve sender identity.',
			from: 'ops@example.com',
			subject: 'Refund workflow',
			threadId: 'thread-1',
			to: ['support@example.com']
		});
	});

	it('maps Graph messages and file attachments into email sync messages', async () => {
		const client = createRAGGraphEmailSyncClient({
			accessToken: 'token',
			fetch: createFetch((url) => {
				if (url.endsWith('/attachments')) {
					return new Response(
						JSON.stringify({
							value: [
								{
									contentBytes: Buffer.from(
										'# Policy Attachment',
										'utf8'
									).toString('base64'),
									contentType: 'text/markdown',
									id: 'att-1',
									name: 'policy.md'
								}
							]
						}),
						{ status: 200 }
					);
				}

				return new Response(
					JSON.stringify({
						value: [
							{
								body: { content: 'Graph email body text' },
								ccRecipients: [],
								conversationId: 'thread-graph',
								from: {
									emailAddress: { address: 'ops@example.com' }
								},
								hasAttachments: true,
								id: 'msg-1',
								internetMessageId: '<msg-1@example.com>',
								receivedDateTime: '2026-04-09T00:00:00Z',
								sentDateTime: '2026-04-09T00:00:00Z',
								subject: 'Graph workflow',
								toRecipients: [
									{
										emailAddress: {
											address: 'support@example.com'
										}
									}
								]
							}
						]
					}),
					{ status: 200 }
				);
			})
		});

		const result = await client.listMessages();
		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]).toMatchObject({
			attachments: [{ name: 'policy.md' }],
			bodyText: 'Graph email body text',
			from: 'ops@example.com',
			subject: 'Graph workflow',
			threadId: 'thread-graph',
			to: ['support@example.com']
		});
	});
});
