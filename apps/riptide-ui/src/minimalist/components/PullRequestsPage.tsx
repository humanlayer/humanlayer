import type { PullRequestBranch } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/list-branches'
import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, GitMerge, GitPullRequest, Search } from 'lucide-react'
import { useState } from 'react'

import { PullRequestDetail } from '@/minimalist/components/PullRequestPanel'
import { Segmented } from '@/minimalist/components/SettingsControls'
import { type TaskRow, useTaskTree } from '@/minimalist/lib/data'
import { formatAge, plural } from '@/minimalist/lib/format'
import { pullRequestBranchesQuery } from '@/minimalist/lib/pull-requests'
import { useRiptideApi } from '@/orpc/client'

/** How many recent tasks the inbox asks about. Each is one cheap database read. */
const RECENT_TASKS = 40

type Entry = { row: TaskRow; branch: PullRequestBranch; pullRequest: NonNullable<PullRequestBranch['pullRequest']> }

const STATE_ORDER = { open: 0, merged: 1, closed: 2 } as const

/**
 * Every pull request your recent tasks opened, newest work first, with the
 * task's PR detail beside it. PRs HumanLayer never saw are not listed.
 */
const SCOPES: Array<{ value: 'open' | 'all'; label: string }> = [
	{ value: 'open', label: 'Open' },
	{ value: 'all', label: 'All' },
]

export function PullRequestsPage() {
	const { queryClient: orpc } = useRiptideApi()
	const { recent, isReady } = useTaskTree()
	const [filter, setFilter] = useState('')
	const [scope, setScope] = useState<'open' | 'all'>('open')
	const [selectedId, setSelectedId] = useState<string | null>(null)

	const rows = recent.slice(0, RECENT_TASKS)
	const results = useQueries({
		queries: rows.map((row) => pullRequestBranchesQuery(orpc, row.task.id)),
	})
	const loading = !isReady || results.some((result) => result.isLoading)
	// Tasks GitHub couldn't be asked about; their PRs are missing from the list, not absent.
	const failed = results.filter((result) => result.isError && !result.data)
	const allFailed = failed.length > 0 && failed.length === rows.length
	const retrying = failed.some((result) => result.isFetching)
	const retry = () => {
		for (const result of failed) void result.refetch()
	}

	const entries: Entry[] = rows.flatMap((row, index) =>
		(results[index]?.data?.branches ?? []).flatMap((branch) =>
			branch.pullRequest ? [{ row, branch, pullRequest: branch.pullRequest }] : [],
		),
	)
	const needle = filter.trim().toLowerCase()
	const visible = entries
		.filter((entry) => scope === 'all' || entry.pullRequest.state === 'open')
		.filter(
			(entry) =>
				!needle ||
				`${entry.pullRequest.title} ${entry.branch.repoFullName} ${entry.branch.branch} ${entry.row.task.name}`
					.toLowerCase()
					.includes(needle),
		)
		.sort(
			(a, b) =>
				STATE_ORDER[a.pullRequest.state] - STATE_ORDER[b.pullRequest.state] ||
				b.row.lastActivity - a.row.lastActivity,
		)
	const selected = visible.find((entry) => entry.pullRequest.id === selectedId) ?? visible[0] ?? null

	return (
		<main className="main prs">
			<div className="titlebar">
				<span className="title">Pull requests</span>
				<span className="sp" />
				{entries.length > 0 ? (
					<Segmented label="Show" value={scope} options={SCOPES} onChange={setScope} />
				) : null}
			</div>
			<div className="inbox-body">
				<div className="inbox-list">
					{entries.length > 0 ? (
						<label className="inbox-search">
							<Search className="i sm" strokeWidth={1.6} />
							<input
								placeholder="Search pull requests"
								value={filter}
								onChange={(event) => setFilter(event.target.value)}
								aria-label="Search pull requests"
							/>
						</label>
					) : null}
					{visible.length > 0 ? <div className="section">From your tasks</div> : null}
					{visible.map((entry) => (
						<button
							key={entry.pullRequest.id}
							type="button"
							className={`inbox-row${entry === selected ? ' sel' : ''}`}
							aria-current={entry === selected ? 'true' : undefined}
							onClick={() => setSelectedId(entry.pullRequest.id)}
						>
							<PullRequestIcon pullRequest={entry.pullRequest} />
							<span className="t">
								<b>{entry.pullRequest.title}</b>
								<span className="muted">
									{entry.branch.repoFullName} · {entry.branch.branch} · {describe(entry.pullRequest)}
								</span>
							</span>
							<span className="muted age">{formatAge(entry.row.lastActivity)}</span>
						</button>
					))}
					{loading && visible.length === 0 ? <div className="boot-mark" /> : null}
					{!loading && allFailed ? (
						<div className="inbox-empty" role="alert">
							<GitPullRequest className="i" strokeWidth={1.4} />
							<b>Could not load pull requests</b>
							<span className="muted">
								GitHub didn't answer. PRs from your tasks show up here once it does.
							</span>
							<button type="button" className="btn" disabled={retrying} onClick={retry}>
								{retrying ? 'Trying again…' : 'Try again'}
							</button>
						</div>
					) : null}
					{!loading && failed.length > 0 && !allFailed ? (
						<div className="inbox-failed" role="alert">
							Could not check {plural(failed.length, 'task', 'tasks')} with GitHub, so{' '}
							{failed.length === 1 ? 'its PRs are' : 'their PRs are'} missing.
							<button type="button" className="linkbtn" disabled={retrying} onClick={retry}>
								{retrying ? 'Trying again…' : 'Try again'}
							</button>
						</div>
					) : null}
					{!loading && visible.length === 0 && !allFailed ? (
						<div className="inbox-empty">
							<GitPullRequest className="i" strokeWidth={1.4} />
							<b>
								{needle
									? 'No matches'
									: scope === 'open' && entries.length > 0
										? 'No open pull requests'
										: 'No pull requests yet'}
							</b>
							{!needle && scope === 'open' && entries.length > 0 ? (
								<button type="button" className="btn" onClick={() => setScope('all')}>
									Show {plural(entries.length, 'merged or closed PR', 'merged or closed PRs')}
								</button>
							) : (
								<span className="muted">PRs the agent opens from your tasks show up here.</span>
							)}
						</div>
					) : null}
				</div>
				{selected ? <SelectedPullRequest key={selected.pullRequest.id} entry={selected} /> : null}
			</div>
		</main>
	)
}

function SelectedPullRequest({ entry }: { entry: Entry }) {
	return (
		<div className="inbox-detail">
			<div className="inbox-acts">
				<Link className="btn" to="/tasks/$taskId" params={{ taskId: entry.row.task.id }}>
					Open task
				</Link>
				<a className="btn" href={entry.pullRequest.url} target="_blank" rel="noreferrer">
					GitHub <ArrowUpRight className="i sm" />
				</a>
			</div>
			<PullRequestDetail
				taskId={entry.row.task.id}
				branch={entry.branch}
				pullRequest={entry.pullRequest}
				sessionId={entry.row.latest?.id ?? null}
			/>
		</div>
	)
}

function PullRequestIcon({ pullRequest }: { pullRequest: Entry['pullRequest'] }) {
	const tone =
		pullRequest.state === 'merged'
			? 'merged'
			: pullRequest.state === 'closed' || pullRequest.isDraft
				? 'muted'
				: 'open'
	return pullRequest.state === 'merged' ? (
		<GitMerge className={`i sm pr-ico ${tone}`} />
	) : (
		<GitPullRequest className={`i sm pr-ico ${tone}`} />
	)
}

function describe(pullRequest: Entry['pullRequest']): string {
	if (pullRequest.state === 'merged') return 'merged'
	if (pullRequest.state === 'closed') return 'closed'
	if (pullRequest.isDraft) return 'draft'
	if (pullRequest.reviewDecision === 'APPROVED') return 'approved'
	if (pullRequest.reviewDecision === 'CHANGES_REQUESTED') return 'changes requested'
	if (pullRequest.merge?.mergeStateStatus === 'DIRTY') return 'has conflicts'
	return 'ready for review'
}
