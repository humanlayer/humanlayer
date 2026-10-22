/**
 * Versioned email templates for access request notifications.
 * Pure functions — deterministic, no side effects.
 *
 * Each composer returns both `text` (plaintext fallback) and `html` so the
 * email is rendered as a multipart message by Resend.
 */

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
	month: 'long',
	day: 'numeric',
	year: 'numeric',
	timeZone: 'UTC',
})

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
	hour: 'numeric',
	minute: '2-digit',
	hour12: true,
	timeZone: 'UTC',
})

function formatTimestamp(date: Date): string {
	return `${DATE_FORMAT.format(date)} at ${TIME_FORMAT.format(date)} UTC`
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

type EmailInput = {
	organizationName: string
	recipientFirstName: string | null
	requesterDisplay: string
	requesterFirstName: string | null
	artifactTitle: string | null
	artifactUrl: string | null
	taskName: string | null
	taskUrl: string | null
	artifactOwnerName: string | null
	requestedAt: Date
	inviteUrl: string
}

/**
 * A fully-resolved view of an email, ready to render. Composers decide the
 * per-variant content (`subject` and `opener`); everything else is shared and
 * resolved once here, so the plaintext/html renderers only read from this model
 * rather than re-deriving content from the raw input.
 */
type EmailView = {
	subject: string
	opener: string
	/** Trailing clause of the call-to-action, e.g. "to invite Jane to Acme". */
	inviteSuffix: string
	inviteUrl: string
	metaRows: MetaRow[]
}

/** A single labeled detail line. When `href` is set the value links to it. */
type MetaRow = {
	label: string
	text: string
	href: string | null
}

type EmailMessage = { subject: string; text: string; html: string }

function greeting(recipientFirstName: string | null): string {
	return `Hi ${recipientFirstName ?? 'there'}`
}

function intro(input: EmailInput): string {
	const collaboratorClause = input.artifactTitle ? 'collaborate on an artifact in ' : ''
	return `${greeting(input.recipientFirstName)} - ${input.requesterDisplay} requested access to ${collaboratorClause}your HumanLayer organization ${input.organizationName}.`
}

function reminderIntro(input: EmailInput, daysAgo: number): string {
	const collaboratorClause = input.artifactTitle ? 'collaborate on an artifact in ' : ''
	return `${greeting(input.recipientFirstName)} - reminder: ${input.requesterDisplay} requested access to ${collaboratorClause}your HumanLayer organization ${input.organizationName} ${daysAgo} days ago.`
}

/** Resolves the detail rows shared by every access-request email variant. */
function buildMetaRows(input: EmailInput): MetaRow[] {
	const rows: MetaRow[] = []
	if (input.taskName) rows.push({ label: 'Task', text: input.taskName, href: input.taskUrl })
	if (input.artifactOwnerName) rows.push({ label: 'Artifact owner', text: input.artifactOwnerName, href: null })
	if (input.artifactTitle) rows.push({ label: 'Artifact', text: input.artifactTitle, href: input.artifactUrl })
	rows.push({ label: 'Requested', text: formatTimestamp(input.requestedAt), href: null })
	rows.push({ label: 'Full invite Url', text: input.inviteUrl, href: input.inviteUrl })
	return rows
}

function buildView(input: EmailInput, subject: string, opener: string): EmailView {
	return {
		subject,
		opener,
		inviteSuffix: `to invite ${input.requesterDisplay} to ${input.organizationName}`,
		inviteUrl: input.inviteUrl,
		metaRows: buildMetaRows(input),
	}
}

function renderMetaRowText(row: MetaRow): string {
	// Skip the redundant "(href)" suffix when the link target is already the text.
	return row.href && row.href !== row.text ? `${row.label}: ${row.text} (${row.href})` : `${row.label}: ${row.text}`
}

function renderMetaRowHtml(row: MetaRow): string {
	const value = row.href ? `<a href="${escapeHtml(row.href)}">${escapeHtml(row.text)}</a>` : escapeHtml(row.text)
	return `${escapeHtml(row.label)}: ${value}`
}

function renderPlaintext(view: EmailView): string {
	return [
		view.opener,
		``,
		`Click here ${view.inviteSuffix}: ${view.inviteUrl}`,
		``,
		...view.metaRows.map(renderMetaRowText),
	].join('\n')
}

function renderHtml(view: EmailView): string {
	const inviteHref = escapeHtml(view.inviteUrl)
	const cta = `<a href="${inviteHref}">Click Here</a> ${escapeHtml(view.inviteSuffix)}`
	const metaHtml = view.metaRows.map(renderMetaRowHtml).join('<br>')
	return [`<p>${escapeHtml(view.opener)}</p>`, `<p>${cta}</p>`, `<p>${metaHtml}</p>`].join('\n')
}

function renderEmail(view: EmailView): EmailMessage {
	return { subject: view.subject, text: renderPlaintext(view), html: renderHtml(view) }
}

export function composeInitialEmail(input: EmailInput): EmailMessage {
	const view = buildView(input, `HumanLayer - Access request for ${input.organizationName}`, intro(input))
	return renderEmail(view)
}

export function composeReminderEmail(input: EmailInput): EmailMessage {
	const daysAgo = Math.round((Date.now() - input.requestedAt.getTime()) / (24 * 60 * 60 * 1000))
	const view = buildView(
		input,
		`HumanLayer - Reminder: Access request for ${input.organizationName}`,
		reminderIntro(input, daysAgo),
	)
	return renderEmail(view)
}

export function initialIdempotencyKey(args: {
	accessRequestId: string
	requestGeneration: number
	adminUserId: string
}): string {
	return `access-request-initial/${args.accessRequestId}/${args.requestGeneration}/${args.adminUserId}`
}

export function reminderIdempotencyKey(args: {
	accessRequestId: string
	requestGeneration: number
	adminUserId: string
}): string {
	return `access-request-reminder/${args.accessRequestId}/${args.requestGeneration}/${args.adminUserId}`
}
