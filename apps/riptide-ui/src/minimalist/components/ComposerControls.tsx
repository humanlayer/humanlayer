import { File, Gauge, Paperclip, Plus, Ticket, Users, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { useConnectIntegrationAction } from '@/hooks/useConnectIntegrationAction'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/minimalist/components/Menu'
import { formatTokens } from '@/minimalist/lib/format'
import type { ContextUsage } from '@/minimalist/lib/send'
import { PROVIDER_NAMES, type TicketProvider, useIssueSourceConnected } from '@/minimalist/lib/tickets'
import type { ComposerAttachments } from '@/minimalist/lib/use-attachments'

/** Chips for the files about to be sent: a thumbnail or file icon, upload state, and remove. */
export function AttachmentChips({ attachments, disabled }: { attachments: ComposerAttachments; disabled: boolean }) {
	return (
		<div className="attachments" aria-live="polite">
			{attachments.files.map((entry) => (
				<div key={entry.id} className="attachment">
					{entry.preview ? (
						<img className="thumb" src={entry.preview} alt="" />
					) : (
						<File className="i sm" strokeWidth={1.6} />
					)}
					<span title={entry.file.name}>{entry.file.name}</span>
					{entry.status === 'uploading' ? <span className="muted">Uploading…</span> : null}
					{entry.status === 'failed' ? (
						<button type="button" onClick={() => attachments.retry(entry)}>
							Retry upload
						</button>
					) : null}
					<button
						type="button"
						aria-label={`Remove ${entry.file.name}`}
						disabled={disabled}
						onClick={() => attachments.remove(entry.id)}
					>
						<X className="i sm" />
					</button>
				</div>
			))}
		</div>
	)
}

/**
 * The `+` button. It picks files, or, where the page takes an issue, opens a menu of files and
 * the issue trackers.
 */
export function AddButton({
	attachments,
	disabled,
	onAddIssue,
	multiplayer,
}: {
	attachments?: ComposerAttachments
	disabled: boolean
	onAddIssue: ((provider: TicketProvider) => void) | undefined
	multiplayer?: { active: boolean; detail: string; disabled: boolean; onSelect: () => void }
}) {
	const fileInput = useRef<HTMLInputElement>(null)
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const hasMenu = Boolean(onAddIssue || multiplayer)
	const label = multiplayer ? 'Open composer options' : onAddIssue ? 'Add files or an issue' : 'Add files'
	return (
		<>
			<input
				ref={fileInput}
				type="file"
				multiple
				hidden
				aria-label="Choose files"
				onChange={(event) => {
					attachments?.add(Array.from(event.target.files ?? []))
					event.target.value = ''
				}}
			/>
			<button
				type="button"
				ref={anchor}
				className="iconbtn"
				title={label}
				aria-label={label}
				disabled={disabled}
				onClick={() => (hasMenu ? setOpen(true) : fileInput.current?.click())}
			>
				<Plus className="i" />
			</button>
			{hasMenu ? (
				<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="above-start">
					{attachments ? (
						<MenuItem
							icon={<Paperclip className="i sm" strokeWidth={1.6} />}
							label="Files"
							onSelect={() => {
								setOpen(false)
								fileInput.current?.click()
							}}
						/>
					) : null}
					{onAddIssue ? (
						<>
							<IssueItem provider="linear" onAddIssue={onAddIssue} onDone={() => setOpen(false)} />
							<IssueItem provider="github" onAddIssue={onAddIssue} onDone={() => setOpen(false)} />
							<IssueItem provider="jira" onAddIssue={onAddIssue} onDone={() => setOpen(false)} />
						</>
					) : null}
					{multiplayer ? (
						<>
							{attachments || onAddIssue ? <MenuSeparator /> : null}
							<MenuItem
								icon={<Users className="i sm" strokeWidth={1.6} />}
								label="Multiplayer prompting"
								checked={multiplayer.active}
								detail={multiplayer.detail}
								disabled={multiplayer.disabled}
								onSelect={() => {
									setOpen(false)
									multiplayer.onSelect()
								}}
							/>
						</>
					) : null}
				</Menu>
			) : null}
		</>
	)
}

/** "Linear issue" when connected; otherwise "Connect Linear", which starts the install and then opens the dialog. */
function IssueItem({
	provider,
	onAddIssue,
	onDone,
}: {
	provider: TicketProvider
	onAddIssue: (provider: TicketProvider) => void
	onDone: () => void
}) {
	const connected = useIssueSourceConnected(provider)
	const connect = useConnectIntegrationAction()
	const name = PROVIDER_NAMES[provider]
	const pick = async () => {
		onDone()
		if (connected || (await connect(provider)) === 'already-connected') onAddIssue(provider)
	}
	return (
		<MenuItem
			icon={<Ticket className="i sm" strokeWidth={1.6} />}
			label={connected ? `${name} issue` : `Connect ${name}`}
			detail={connected ? undefined : `Start tasks from ${name} issues`}
			onSelect={() => void pick()}
		/>
	)
}

/**
 * How much of the context window is used, once the agent reports it: quiet below 60%, amber from 80%.
 * Its menu shows the meter and the token counts and offers to compact.
 */
export function ContextMeter({
	usage,
	running,
	disabled,
	onCompact,
}: {
	usage: ContextUsage | null | undefined
	/** Compacting waits for the agent to finish. */
	running: boolean
	disabled: boolean
	onCompact: (() => void) | undefined
}) {
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	if (!usage) return null
	const { percent } = usage
	const high = percent >= 80
	return (
		<>
			<button
				type="button"
				ref={anchor}
				className={`pill${percent < 60 ? ' quiet' : ''}`}
				title="Context used"
				aria-label={`Context ${percent}% used`}
				onClick={() => setOpen(true)}
			>
				<Gauge className={high ? 'i sm caution' : 'i sm'} strokeWidth={1.6} />
				{percent}%
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="above-start" width={260}>
				<MenuLabel>Context window</MenuLabel>
				<div className="ctx">
					<div>
						{percent}% used · {formatTokens(usage.tokens)} of {formatTokens(usage.limit)} tokens
					</div>
					<span className={`meter${high ? ' high' : ''}`}>
						<i style={{ width: `${Math.min(100, percent)}%` }} />
					</span>
					<div className="d">The agent compacts on its own when the window fills up.</div>
				</div>
				{onCompact ? (
					<>
						<MenuSeparator />
						<MenuItem
							label="Compact now"
							detail={
								running
									? 'Available when the agent finishes'
									: 'Summarize the session so far to free up context'
							}
							disabled={running || disabled}
							onSelect={() => {
								setOpen(false)
								onCompact()
							}}
						/>
					</>
				) : null}
			</Menu>
		</>
	)
}
