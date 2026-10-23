import type {
	MergeMethod,
	PullRequestBranch,
} from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/list-branches'
import type { CheckRowType } from '@humanlayer/streams/pr-status'
import { ArrowUpRight, Circle, GitMerge, GitPullRequest, X } from 'lucide-react'

import { groupChecks } from '@/components/github/check-groups'
import { usePrStatusStream } from '@/hooks/session-detail/usePrStatusStream'
import { readGitPrefs } from '@/minimalist/lib/git-prefs'
import { pullRequestPrompt } from '@/minimalist/lib/git-prompts'
import { useTaskPullRequest } from '@/minimalist/lib/pull-requests'
import { askToast, useAskAgent } from '@/minimalist/lib/send'
import { useAction } from '@/minimalist/lib/use-action'
import { useRiptideApi } from '@/orpc/client'

import { CopyButton } from './CopyButton'

const MERGE_LABELS: Record<MergeMethod, string> = {
	SQUASH: 'Squash and merge',
	REBASE: 'Rebase and merge',
	MERGE: 'Merge',
}

function reviewSummary(decision: string | null | undefined): { label: string; tone: string } {
	switch (decision) {
		case 'APPROVED':
			return { label: 'Approved', tone: 'add' }
		case 'CHANGES_REQUESTED':
			return { label: 'Changes requested', tone: 'del' }
		case 'REVIEW_REQUIRED':
			return { label: 'Waiting for review', tone: 'muted' }
		default:
			return { label: 'No reviews yet', tone: 'muted' }
	}
}

function prStateLabel(state: string, draft: boolean): string {
	if (state === 'merged') return 'Merged'
	if (state === 'closed') return 'Closed'
	return draft ? 'Draft' : 'Open'
}

export function PullRequestPanel({ taskId, sessionId }: { taskId: string; sessionId: string | null }) {
	const { branch, isLoading, failed, retrying, retry } = useTaskPullRequest(taskId)
	if (isLoading) return <div className="boot-mark" />
	if (failed)
		return (
			<div className="pr-empty" role="alert">
				<GitPullRequest className="i" strokeWidth={1.4} />
				<b>Could not load the pull request</b>
				<div className="d">
					GitHub didn't answer for this task. Its PR, checks and reviews show here once it does.
				</div>
				<button type="button" className="btn" disabled={retrying} onClick={retry}>
					{retrying ? 'Trying again…' : 'Try again'}
				</button>
			</div>
		)
	if (!branch?.pullRequest) return <NoPullRequest branch={branch} sessionId={sessionId} />
	return <PullRequestDetail taskId={taskId} sessionId={sessionId} branch={branch} pullRequest={branch.pullRequest} />
}

function NoPullRequest({ branch, sessionId }: { branch: PullRequestBranch | null; sessionId: string | null }) {
	const agent = useAskAgent(sessionId)
	return (
		<div className="pr-empty">
			<GitPullRequest className="i" strokeWidth={1.4} />
			<b>No pull request yet</b>
			<div className="d">
				{branch
					? `The agent is working on ${branch.branch} in ${branch.repoFullName}. The PR shows up here once it opens.`
					: 'PRs the agent opens for this task show up here, with checks and reviews.'}
			</div>
			<button
				type="button"
				className="btn"
				disabled={!sessionId || agent.pending}
				onClick={() =>
					void agent.ask(pullRequestPrompt(readGitPrefs().draftPullRequests, ''), askToast('Open a PR'))
				}
			>
				Ask the agent to open one
			</button>
		</div>
	)
}

/** A PR's checks, reviews and merge controls. The fix-it buttons ask the agent in `sessionId`, if there is one. */
export function PullRequestDetail({
	taskId,
	sessionId,
	branch,
	pullRequest,
}: {
	taskId: string
	sessionId: string | null
	branch: PullRequestBranch
	pullRequest: NonNullable<PullRequestBranch['pullRequest']>
}) {
	const { client: api } = useRiptideApi()
	const action = useAction()
	const agent = useAskAgent(sessionId)
	const busy = action.pending || agent.pending
	const live = usePrStatusStream({ scope: { taskId }, repoFullName: branch.repoFullName, branch: branch.branch })
	const pr = live.pullRequest ?? pullRequest
	const checks = groupChecks(live.checks)
	const merge = pr.merge
	const open = pr.state === 'open'
	const reviews = pr.changesRequestedReviews ?? []

	const mutate = (
		mutation: Parameters<typeof api.integrations.github.pullRequests.mutate>[0]['mutation'],
		failure: string,
	) =>
		action.run(
			() =>
				api.integrations.github.pullRequests.mutate({
					taskId,
					repoFullName: branch.repoFullName,
					branch: branch.branch,
					number: pr.number,
					mutation,
				}),
			failure,
		)
	const ask = (text: string, request: string) => agent.ask(text, askToast(request))

	const preferred = readGitPrefs().mergeMethod
	const method = preferred === 'github' ? (merge?.viewerDefaultMergeMethod ?? 'SQUASH') : preferred
	const methodLabel = MERGE_LABELS[method]
	const state = prStateLabel(pr.state, pr.isDraft)
	const review = reviewSummary(pr.reviewDecision)

	return (
		<div className="pr">
			<div className="pr-top">
				<span className={`pr-state ${pr.state}${pr.isDraft ? ' draft' : ''}`}>
					{pr.state === 'merged' ? <GitMerge className="i sm" /> : <GitPullRequest className="i sm" />}
					{state}
				</span>
				<a className="muted" href={pr.url} target="_blank" rel="noreferrer">
					{branch.repoFullName} #{pr.number}
					<ArrowUpRight className="i sm" />
				</a>
				<CopyButton className="iconbtn pr-copy" label="Copy pull request link" text={() => pr.url} />
			</div>
			<h2 className="pr-title">{pr.title}</h2>
			<div className="pr-branch">
				<code>{pr.baseRef}</code> ← <code>{pr.headRef}</code>
			</div>

			<div className="pr-sec">
				<div className="pr-k">Checks</div>
				{checks.total === 0 ? (
					<div className="muted">
						{live.status === 'hydrating' ? 'Loading…' : 'No checks on the latest commit'}
					</div>
				) : (
					<>
						<div className="pr-sum">
							{checks.failed.length ? <span className="del">{checks.failed.length} failing</span> : null}
							{checks.running.length ? <span>{checks.running.length} running</span> : null}
							{checks.passed.length ? <span className="add">{checks.passed.length} passing</span> : null}
						</div>
						{[...checks.failed, ...checks.running].map((check) => (
							<CheckLine key={check.id} check={check} />
						))}
						{checks.failed.length > 0 && open ? (
							<button
								type="button"
								className="btn"
								disabled={busy}
								onClick={() =>
									void ask(
										`These checks failed on the pull request: ${checks.failed.map((check) => check.name).join(', ')}. Look at the failures, fix them and push.`,
										'Fix the checks',
									)
								}
							>
								Ask the agent to fix them
							</button>
						) : null}
					</>
				)}
			</div>

			<div className="pr-sec">
				<div className="pr-k">Reviews</div>
				<div className={review.tone}>
					{review.label}
					{pr.unresolvedThreadCount ? (
						<span className="muted"> · {pr.unresolvedThreadCount} open threads</span>
					) : null}
				</div>
				{reviews.map((review, index) => (
					<blockquote key={index} className="pr-review">
						<b>{review.login ?? 'A reviewer'}</b> {review.body}
					</blockquote>
				))}
				{reviews.length > 0 && open ? (
					<button
						type="button"
						className="btn"
						disabled={busy}
						onClick={() =>
							void ask(
								`Address the review on the pull request:\n\n${reviews.map((review) => `${review.login ?? 'A reviewer'}: ${review.body}`).join('\n\n')}\n\nThen push.`,
								'Address the review',
							)
						}
					>
						Ask the agent to address it
					</button>
				) : null}
			</div>

			{open ? (
				<div className="pr-merge">
					{pr.isDraft ? (
						<button
							type="button"
							className="btn primary"
							disabled={busy}
							onClick={() =>
								void mutate(
									{ type: 'ready_for_review' },
									'Could not mark the PR ready. Try again or open it on GitHub.',
								)
							}
						>
							Mark ready for review
						</button>
					) : (
						<button
							type="button"
							className="btn primary"
							disabled={
								busy || merge?.mergeStateStatus === 'DIRTY' || merge?.mergeStateStatus === 'BLOCKED'
							}
							title={
								merge?.mergeStateStatus === 'DIRTY'
									? 'The branch has conflicts'
									: merge?.mergeStateStatus === 'BLOCKED'
										? 'Required checks or reviews are missing'
										: undefined
							}
							onClick={() =>
								void mutate(
									{ type: 'merge', method, expectedHeadSha: pr.headSha },
									'Could not merge the PR. The branch may have moved. Check it on GitHub.',
								)
							}
						>
							<GitMerge className="i sm" />
							{methodLabel}
						</button>
					)}
					{merge?.mergeStateStatus === 'BEHIND' && merge.viewerCanUpdateBranch ? (
						<button
							type="button"
							className="btn"
							disabled={busy}
							onClick={() =>
								void mutate(
									{ type: 'update_branch', expectedHeadSha: pr.headSha },
									'Could not update the branch. Try again or update it on GitHub.',
								)
							}
						>
							Update branch
						</button>
					) : null}
					{merge?.mergeStateStatus === 'DIRTY' ? (
						<button
							type="button"
							className="btn"
							disabled={busy}
							onClick={() =>
								void ask(
									`Merge ${pr.baseRef} into this branch, resolve the conflicts and push.`,
									'Resolve the conflicts',
								)
							}
						>
							Ask the agent to resolve conflicts
						</button>
					) : null}
				</div>
			) : null}
		</div>
	)
}

function CheckLine({ check }: { check: CheckRowType }) {
	const failed = check.conclusion !== null
	return (
		<div className="pr-check">
			{failed ? <X className="i sm del" /> : <Circle className="i sm muted" />}
			<span className="t">{check.name}</span>
			{check.detailsUrl ? (
				<a
					className="muted"
					href={check.detailsUrl}
					target="_blank"
					rel="noreferrer"
					aria-label={`Open ${check.name}`}
				>
					<ArrowUpRight className="i sm" />
				</a>
			) : null}
		</div>
	)
}
