export const MIXED_MAILBOX_BRANCH_KEYS = ['alpha', 'beta', 'gamma'] as const;
export const MIXED_MAILBOX_BRANCH_PATHS = [
	['Ops', 'Recovered', 'Signalbox'],
	['Ops', 'Recovered', 'West', 'Quartzbay'],
	['Ops', 'Recovered', 'Hold', 'North', 'Embervault']
] as const;
export const MIXED_MAILBOX_ROOT_DRIFT_KEYS = [
	'lanternroot',
	'quartzroot',
	'emberroot'
] as const;
export const MIXED_MAILBOX_PARENT_DRIFT_KEYS = [
	'sunriseparent',
	'nightfallparent'
] as const;
export const MIXED_MAILBOX_NESTED_REPLY_KEYS = ['dawn', 'dusk'] as const;
export const MIXED_MAILBOX_NESTED_REPLY_ORDINALS = [1, 2] as const;
export const MIXED_MAILBOX_DEEP_CHILD_KEYS = [
	'ledger',
	'packet',
	'signal'
] as const;
export const MIXED_MAILBOX_REFERENCE_DRIFT_KEYS = [
	'anchorref',
	'bridgeref',
	'relayref'
] as const;
export const MIXED_MAILBOX_MESSAGE_DRIFT_KEYS = [
	'lanternmsg',
	'quartzmsg',
	'embermsg'
] as const;
export const MIXED_MAILBOX_CONVERSATION_ID_DRIFT_KEYS = [
	'conv-id-alpha',
	'conv-id-beta',
	'conv-id-gamma'
] as const;
export const MIXED_MAILBOX_CONVERSATION_DRIFT_KEYS = [
	'convalpha',
	'convbeta',
	'convgamma'
] as const;
export const MIXED_MAILBOX_THREAD_INDEX_DRIFT_KEYS = [
	'AQHDEEP.101',
	'AQHDEEP.205',
	'AQHDEEP.309'
] as const;
export const MIXED_MAILBOX_QUOTED_HISTORY_KEYS = ['recent', 'older'] as const;
export const MIXED_MAILBOX_INLINE_RESOURCE_KEYS = ['hero', 'badge'] as const;
export const MIXED_SHARED_MAILBOX_PATH_SEGMENTS = [
	'Ops',
	'Recovered',
	'Shared'
] as const;
export const MIXED_MAILBOX_BRANCH_STATE_FLAG_SETS = [
	['flagged'],
	['draft'],
	['trashed']
] as const;
export const MIXED_MAILBOX_REPLY_SPECS = [
	{
		containerSource: 'reply-emlx.emlx',
		fileName: 'reply-emlx.emlx',
		formatLabel: 'emlx',
		stateFlags: [] as string[]
	},
	{
		containerSource: 'thread-pst.pst',
		fileName: 'thread-pst.pst',
		formatLabel: 'pst',
		stateFlags: ['flagged', 'read'] as string[]
	},
	{
		containerSource: 'thread-ost.ost',
		fileName: 'thread-ost.ost',
		formatLabel: 'ost',
		stateFlags: ['passed', 'unread'] as string[]
	},
	{
		containerSource: 'thread.mbox',
		fileName: 'thread.mbox',
		formatLabel: 'mbox',
		stateFlags: [] as string[]
	},
	{
		containerSource: 'Ops/Recovered/Shared',
		fileName: '1713890015.M15P16.mailhost:2,FS',
		formatLabel: 'maildir',
		stateFlags: ['flagged', 'read'] as string[]
	}
] as const;

export type MixedMailboxReplySpec = (typeof MIXED_MAILBOX_REPLY_SPECS)[number];
export const RECOVERED_PST_CASE_KEYS = [
	'atlas',
	'beacon',
	'cipher',
	'delta',
	'ember',
	'fable'
] as const;
export const RECOVERED_PST_FAMILY_KEYS = ['alpha', 'beta'] as const;
export const RECOVERED_PST_BRANCH_KEYS = ['left', 'right'] as const;

export const mixedMailboxFolder = (
	formatLabel: MixedMailboxReplySpec['formatLabel']
) => (formatLabel === 'maildir' ? 'cur' : 'Shared');

export const recoveredPstStateFlags = (ordinal: number) =>
	(ordinal % 2 === 0
		? ['passed', 'unread']
		: ['flagged', 'read']) as string[];

export const recoveredPstStateCue = (ordinal: number) =>
	recoveredPstStateFlags(ordinal).includes('unread') ? 'unread' : 'flagged';

export const recoveredPstMailboxPathSegments = (caseKey: string) =>
	['Ops', 'Recovered', caseKey] as const;

export const mixedMailboxFamilyKey = (segments: readonly string[]) =>
	segments.map((segment) => segment.toLowerCase()).join('/');

export const recoveredPstMailboxMetadata = ({
	caseKey,
	containerSource,
	formatLabel = 'pst',
	ordinal,
	stateFlags = recoveredPstStateFlags(ordinal)
}: {
	caseKey: string;
	containerSource: string;
	formatLabel?: string;
	ordinal: number;
	stateFlags?: string[];
}) => {
	const pathSegments = recoveredPstMailboxPathSegments(caseKey);
	return {
		emailMailboxContainerSource: containerSource,
		emailMailboxFamilyKey: mixedMailboxFamilyKey(pathSegments),
		emailMailboxFolder: caseKey,
		emailMailboxFormat: formatLabel,
		emailMailboxLeaf: caseKey,
		emailMailboxMessageOrdinal: ordinal,
		emailMailboxPathDepth: pathSegments.length,
		emailMailboxPathSegments: [...pathSegments],
		emailMailboxStateFlags: [...stateFlags]
	};
};

export const recoveredPstMessageSource = ({
	containerSource,
	ordinal
}: {
	containerSource: string;
	ordinal: number;
}) => `${containerSource}#messages/${ordinal}`;

export const recoveredPstMessageAttachmentSource = ({
	attachmentName,
	containerSource,
	ordinal
}: {
	attachmentName: string;
	containerSource: string;
	ordinal: number;
}) =>
	`${recoveredPstMessageSource({
		containerSource,
		ordinal
	})}#attachments/${attachmentName}`;

export type RecoveredPstAttachmentSpec = {
	content: string | Uint8Array;
	contentId?: string;
	contentLocation?: string;
	contentType: string;
	disposition?: string;
	name: string;
	transferEncoding?: 'base64' | '7bit' | '8bit';
};

const buildRecoveredPstAttachmentBlock = ({
	content,
	contentId,
	contentLocation,
	contentType,
	disposition,
	name,
	transferEncoding = 'base64'
}: RecoveredPstAttachmentSpec) => {
	const contentBuffer =
		typeof content === 'string'
			? Buffer.from(content, 'utf8')
			: Buffer.from(content);
	return [
		`Attachment: ${name}`,
		`Attachment-Content-Type: ${contentType}`,
		...(disposition ? [`Attachment-Disposition: ${disposition}`] : []),
		...(contentId ? [`Attachment-Content-ID: ${contentId}`] : []),
		...(contentLocation
			? [`Attachment-Content-Location: ${contentLocation}`]
			: []),
		`Attachment-Transfer-Encoding: ${transferEncoding}`,
		`Attachment-Data: ${
			transferEncoding === 'base64'
				? contentBuffer.toString('base64')
				: contentBuffer.toString('utf8')
		}`
	];
};

export const buildRecoveredPstMailboxMessage = ({
	attachments = [],
	bodyLines = [],
	decoratorLines = [],
	folder,
	from,
	inReplyTo,
	messageId,
	references,
	stateFlags = [],
	subject,
	to = 'ops@example.com'
}: {
	attachments?: RecoveredPstAttachmentSpec[];
	bodyLines?: string[];
	decoratorLines?: string[];
	folder: readonly string[] | string;
	from?: string;
	inReplyTo?: string;
	messageId?: string;
	references?: string;
	stateFlags?: string[];
	subject?: string;
	to?: readonly string[] | string;
}) => {
	const folderValue = Array.isArray(folder) ? folder.join('/') : folder;
	const toValue = Array.isArray(to) ? to.join(', ') : to;

	return [
		`Folder: ${folderValue}`,
		...(stateFlags.length > 0 ? [`Flags: ${stateFlags.join(' ')}`] : []),
		...attachments.flatMap((attachment) =>
			buildRecoveredPstAttachmentBlock(attachment)
		),
		...decoratorLines,
		...(subject ? [`Subject: ${subject}`] : []),
		...(from ? [`From: ${from}`] : []),
		...(toValue ? [`To: ${toValue}`] : []),
		...(messageId ? [`Message-ID: ${messageId}`] : []),
		...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
		...(references ? [`References: ${references}`] : []),
		...(bodyLines.length > 0 ? ['', ...bodyLines] : [])
	].join('\n');
};

export const mixedMailboxBranchPath = (
	branchKey: (typeof MIXED_MAILBOX_BRANCH_KEYS)[number]
) => MIXED_MAILBOX_BRANCH_PATHS[MIXED_MAILBOX_BRANCH_KEYS.indexOf(branchKey)]!;

export const mixedMailboxBranchLeaf = (
	branchKey: (typeof MIXED_MAILBOX_BRANCH_KEYS)[number]
) => {
	const segments = mixedMailboxBranchPath(branchKey);
	return segments[segments.length - 1]!;
};

export const mixedMailboxBranchFamilyKey = (
	branchKey: (typeof MIXED_MAILBOX_BRANCH_KEYS)[number]
) => mixedMailboxFamilyKey(mixedMailboxBranchPath(branchKey));

export const mixedMailboxBranchStateFlags = (
	branchKey: (typeof MIXED_MAILBOX_BRANCH_KEYS)[number]
) =>
	MIXED_MAILBOX_BRANCH_STATE_FLAG_SETS[
		MIXED_MAILBOX_BRANCH_KEYS.indexOf(branchKey)
	]!;

export const mixedMailboxExpectedChildSource = (
	spec: MixedMailboxReplySpec,
	branchKey: (typeof MIXED_MAILBOX_BRANCH_KEYS)[number]
) =>
	spec.formatLabel === 'emlx'
		? `reply-emlx.emlx#attachments/shared-child-${branchKey}.eml`
		: spec.formatLabel === 'pst'
			? `thread-pst.pst#messages/1#attachments/shared-child-${branchKey}.eml`
			: spec.formatLabel === 'ost'
				? `thread-ost.ost#messages/1#attachments/shared-child-${branchKey}.eml`
				: spec.formatLabel === 'mbox'
					? `thread.mbox#messages/1#attachments/shared-child-${branchKey}.eml`
					: `Ops/Recovered/Shared/cur/1713890015.M15P16.mailhost:2,FS#attachments/shared-child-${branchKey}.eml`;

export const mixedMailboxExpectedNestedReplySource = (
	spec: MixedMailboxReplySpec,
	branchKey: (typeof MIXED_MAILBOX_BRANCH_KEYS)[number],
	replyKeyOrOrdinal: (typeof MIXED_MAILBOX_NESTED_REPLY_KEYS)[number] | number
) =>
	`${mixedMailboxExpectedChildSource(spec, branchKey)}#attachments/nested-reply-${branchKey}-${replyKeyOrOrdinal}.eml`;

export const mixedMailboxExpectedDeepChildSource = (
	spec: MixedMailboxReplySpec,
	branchKey: (typeof MIXED_MAILBOX_BRANCH_KEYS)[number],
	replyKeyOrOrdinal:
		| (typeof MIXED_MAILBOX_NESTED_REPLY_KEYS)[number]
		| number,
	childKey: (typeof MIXED_MAILBOX_DEEP_CHILD_KEYS)[number]
) =>
	`${mixedMailboxExpectedNestedReplySource(spec, branchKey, replyKeyOrOrdinal)}#attachments/deep-child-${childKey}.eml`;

export const mixedMailboxExpectedDeepInlineSource = (
	spec: MixedMailboxReplySpec,
	branchKey: (typeof MIXED_MAILBOX_BRANCH_KEYS)[number],
	replyKeyOrOrdinal:
		| (typeof MIXED_MAILBOX_NESTED_REPLY_KEYS)[number]
		| number,
	childKey: (typeof MIXED_MAILBOX_DEEP_CHILD_KEYS)[number],
	inlineKey: (typeof MIXED_MAILBOX_INLINE_RESOURCE_KEYS)[number]
) =>
	`${mixedMailboxExpectedDeepChildSource(spec, branchKey, replyKeyOrOrdinal, childKey)}#attachments/deep-inline-${branchKey}-${replyKeyOrOrdinal}-${childKey}-${inlineKey}.txt`;
