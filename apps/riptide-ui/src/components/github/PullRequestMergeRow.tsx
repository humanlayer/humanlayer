import type {
	PullRequestMutation,
	PullRequestMutationType,
} from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/mutate'
import {
	type CheckRowType,
	MERGE_METHODS,
	type MergeMethod,
	type PullRequestMergeStateType,
	type PullRequestRowType,
} from '@humanlayer/streams/pr-status'
import { Button } from '@humanlayer/ui/components/button'
import { Input } from '@humanlayer/ui/components/input'
import { Textarea } from '@humanlayer/ui/components/textarea'
import { type FC, type ReactNode, useState } from 'react'

import { cn } from '@/lib/utils'

import {
	allowedMergeMethods,
	armedSentence,
	BUSY_LABELS,
	confirmLabel,
	confirmNote,
	deriveLifecycleLinks,
	deriveMergeRow,
	MERGE_METHOD_SHORT_LABELS,
	type MergeIntent,
	type MergeRowView,
	methodWritesCommit,
	prefilledCommitMessage,
} from './merge-row'

// `--terminal-success` has no `@theme` alias, so the green button stays an arbitrary value.
const PRIMARY_BUTTON =
	'border-[var(--terminal-success)] bg-[var(--terminal-success)]/15 text-[var(--terminal-success)] hover:bg-[var(--terminal-success)]/25 hover:text-[var(--terminal-success)]'
const DEFAULT_BUTTON =
	'border-muted-foreground/50 bg-transparent text-foreground hover:bg-accent/10 hover:border-accent hover:text-accent'
// The sidebar can be 200px wide, where GitHub's longer labels only fit on two lines.
const ROW_BUTTON = 'h-auto min-h-6 w-full whitespace-normal px-2 py-1 text-[11px] leading-tight'

const Reason: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="text-[10px] leading-snug text-muted-foreground" data-testid="merge-row-reason">
		{children}
	</div>
)

const MethodPicker: FC<{
	method: MergeMethod
	allowed: readonly MergeMethod[]
	onChange: (method: MergeMethod) => void
}> = ({ method, allowed, onChange }) => (
	<div role="radiogroup" aria-label="Merge method" className="flex border border-border/70">
		{MERGE_METHODS.map((candidate) => {
			const isAllowed = allowed.includes(candidate)
			const isSelected = candidate === method
			return (
				<button
					key={candidate}
					type="button"
					role="radio"
					aria-checked={isSelected}
					disabled={!isAllowed}
					onClick={() => onChange(candidate)}
					className={cn(
						'flex-1 border-l border-border/70 py-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground first:border-l-0',
						isSelected && 'bg-[var(--terminal-success)]/12 text-[var(--terminal-success)]',
						!isAllowed && 'cursor-not-allowed line-through opacity-35',
					)}
				>
					{MERGE_METHOD_SHORT_LABELS[candidate]}
				</button>
			)
		})}
	</div>
)

/** Keyed on the method by its parent, so switching method re-seeds GitHub's message for it. */
const CommitMessageFields: FC<{
	headline: string
	body: string
	onChange: (message: { headline: string; body: string }) => void
}> = ({ headline, body, onChange }) => {
	const [showBody, setShowBody] = useState(false)
	return (
		<>
			<label className="flex flex-col gap-0.5">
				<span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
					Commit message
				</span>
				<Input
					value={headline}
					onChange={(event) => onChange({ headline: event.target.value, body })}
					aria-label="Commit message"
					// The primitive sets `md:text-sm`, which outranks an unprefixed size at this width.
					className="h-6 px-1.5 text-[10px] md:text-[10px]"
				/>
			</label>
			{showBody ? (
				<Textarea
					value={body}
					onChange={(event) => onChange({ headline, body: event.target.value })}
					aria-label="Extended description"
					className="min-h-16 rounded-none border-border bg-background px-1.5 py-1 font-mono text-[10px] md:text-[10px]"
				/>
			) : (
				<button
					type="button"
					onClick={() => setShowBody(true)}
					className="self-start font-mono text-[9px] text-accent hover:underline"
				>
					+ extended description
				</button>
			)}
		</>
	)
}

const MergeConfirm: FC<{
	intent: MergeIntent
	pullRequest: PullRequestRowType
	merge: PullRequestMergeStateType
	method: MergeMethod
	onMethodChange: (method: MergeMethod) => void
	onConfirm: (mutation: PullRequestMutation) => void
	onCancel: () => void
}> = ({ intent, pullRequest, merge, method, onMethodChange, onConfirm, onCancel }) => {
	const [messages, setMessages] = useState<Partial<Record<MergeMethod, { headline: string; body: string }>>>({})
	const message = methodWritesCommit(method) ? (messages[method] ?? prefilledCommitMessage(merge, method)) : null

	const confirm = () => {
		const commit = message ? { commitHeadline: message.headline, commitBody: message.body } : {}
		onConfirm(
			intent === 'merge'
				? { type: 'merge', method, expectedHeadSha: pullRequest.headSha, ...commit }
				: { type: 'enable_auto_merge', method, ...commit },
		)
	}

	return (
		<div
			className="flex flex-col gap-1.5 border border-[var(--terminal-success)] bg-[var(--terminal-success)]/5 p-1.5"
			data-testid="merge-confirm"
		>
			<MethodPicker method={method} allowed={allowedMergeMethods(merge)} onChange={onMethodChange} />
			{message ? (
				<CommitMessageFields
					key={method}
					headline={message.headline}
					body={message.body}
					onChange={(next) => setMessages((current) => ({ ...current, [method]: next }))}
				/>
			) : null}
			<Reason>
				{confirmNote({ intent, method, commitCount: merge.commitCount, baseRef: pullRequest.baseRef })}
			</Reason>
			<div className="flex gap-1">
				<Button size="xs" onClick={confirm} className={cn(ROW_BUTTON, PRIMARY_BUTTON, 'flex-[2]')}>
					{confirmLabel(intent, method)}
				</Button>
				<Button size="xs" variant="ghost" onClick={onCancel} className={cn(ROW_BUTTON, 'flex-1')}>
					Cancel
				</Button>
			</div>
		</div>
	)
}

const DraftControl: FC<{ reason: string; onReady: () => void }> = ({ reason, onReady }) => (
	<>
		<Button size="xs" onClick={onReady} className={cn(ROW_BUTTON, DEFAULT_BUTTON)}>
			Ready for review
		</Button>
		<Reason>{reason}</Reason>
	</>
)

const ArmedControl: FC<{ view: Extract<MergeRowView, { kind: 'armed' }>; onDisable: () => void }> = ({
	view,
	onDisable,
}) => (
	<div
		className="flex items-center gap-2 border border-border/70 px-2 py-1 text-[10px] leading-snug"
		data-testid="merge-row-armed"
	>
		<span className="min-w-0 flex-1">
			{armedSentence(view.method)}
			{view.enabledByLogin ? (
				<span className="block font-mono text-[9px] text-muted-foreground">
					armed by @{view.enabledByLogin}
				</span>
			) : null}
		</span>
		{view.canDisable ? (
			<Button size="xs" variant="ghost" onClick={onDisable} className="h-5 shrink-0 px-1.5 text-[9px]">
				Disable
			</Button>
		) : null}
	</div>
)

const ButtonControl: FC<{
	view: Extract<MergeRowView, { kind: 'button' }>
	baseRef: string
	onUpdateBranch: () => void
	onPress: (intent: MergeIntent) => void
}> = ({ view, baseRef, onUpdateBranch, onPress }) => (
	<>
		{view.canUpdateBranch ? (
			<Button size="xs" variant="outline" onClick={onUpdateBranch} className={ROW_BUTTON}>
				Update branch from {baseRef}
			</Button>
		) : null}
		<Button
			size="xs"
			disabled={!view.enabled}
			onClick={() => onPress(view.intent)}
			className={cn(ROW_BUTTON, view.primary ? PRIMARY_BUTTON : DEFAULT_BUTTON)}
			data-testid="merge-row-button"
		>
			{view.label}
		</Button>
		{view.reason ? <Reason>{view.reason}</Reason> : null}
	</>
)

export interface PullRequestMergeRowProps {
	pullRequest: PullRequestRowType
	/** The row's merge state; the row renders nothing until a panel query has filled it. */
	merge: PullRequestMergeStateType
	checks: CheckRowType[]
	method: MergeMethod
	onMethodChange: (method: MergeMethod) => void
	/** The mutation in flight, or null. The row is inert while one is. */
	busy: PullRequestMutationType | null
	/** What GitHub or the server said when the last mutation failed, or null. */
	error: string | null
	onMutate: (mutation: PullRequestMutation) => void
}

/**
 * GitHub's merge button at the bottom of the panel, with its label, colour and enabled rules,
 * the auto-merge form of it, the armed sentence, the draft row, and the lifecycle links under
 * it. Nothing is optimistic: the row re-derives from the stream once the write has landed.
 */
export const PullRequestMergeRow: FC<PullRequestMergeRowProps> = ({
	pullRequest,
	merge,
	checks,
	method,
	onMethodChange,
	busy,
	error,
	onMutate,
}) => {
	const [confirming, setConfirming] = useState<MergeIntent | null>(null)
	const view = deriveMergeRow({ pullRequest, merge, checks, method })
	const links = deriveLifecycleLinks(pullRequest)
	const isBusy = busy !== null

	const mutate = (mutation: PullRequestMutation) => {
		setConfirming(null)
		onMutate(mutation)
	}

	const link = (label: string, mutation: PullRequestMutation) => (
		<button
			type="button"
			disabled={isBusy}
			onClick={() => mutate(mutation)}
			className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
		>
			{label}
		</button>
	)

	const control = () => {
		if (busy) {
			return (
				<Button size="xs" disabled className={cn(ROW_BUTTON, DEFAULT_BUTTON)} data-testid="merge-row-busy">
					{BUSY_LABELS[busy]}
				</Button>
			)
		}
		if (view.kind === 'hidden') return null
		if (view.kind === 'draft') {
			return <DraftControl reason={view.reason} onReady={() => mutate({ type: 'ready_for_review' })} />
		}
		if (view.kind === 'armed') {
			return <ArmedControl view={view} onDisable={() => mutate({ type: 'disable_auto_merge' })} />
		}
		if (confirming) {
			return (
				<MergeConfirm
					intent={confirming}
					pullRequest={pullRequest}
					merge={merge}
					method={method}
					onMethodChange={onMethodChange}
					onConfirm={mutate}
					onCancel={() => setConfirming(null)}
				/>
			)
		}
		return (
			<ButtonControl
				view={view}
				baseRef={pullRequest.baseRef}
				onUpdateBranch={() => mutate({ type: 'update_branch', expectedHeadSha: pullRequest.headSha })}
				onPress={setConfirming}
			/>
		)
	}

	return (
		<div className="flex flex-col gap-1.5 px-1 pb-2 pt-1" data-testid="pull-request-merge-row">
			{control()}
			{error ? (
				<div role="alert" className="text-[10px] leading-snug text-destructive">
					{error}
				</div>
			) : null}
			{links.close || links.reopen ? (
				<div className="flex justify-center gap-3 border-t border-border/40 pt-1.5">
					{links.convertToDraft ? link('convert to draft', { type: 'convert_to_draft' }) : null}
					{links.close ? link('close pull request', { type: 'close' }) : null}
					{links.reopen ? link('reopen pull request', { type: 'reopen' }) : null}
				</div>
			) : null}
		</div>
	)
}
