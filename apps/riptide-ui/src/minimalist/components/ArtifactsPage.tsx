import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { Link } from '@tanstack/react-router'
import { FileText, Image, MessageSquare, Search } from 'lucide-react'
import { useState } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { ArtifactView } from '@/minimalist/components/ArtifactPanel'
import { artifactName, isImageArtifact, isListedArtifact, isPromptArtifact } from '@/minimalist/lib/artifacts'
import { type RecentArtifact, type TaskRow, useRecentArtifacts, useTaskTree } from '@/minimalist/lib/data'
import { formatAge, plural, toMs } from '@/minimalist/lib/format'

type Entry = { artifact: RecentArtifact; row: TaskRow; project: string }

/**
 * Every document the agent wrote across your tasks, newest first, with the
 * selected one open beside the list to read and comment on. Task prompts and attachments are left out.
 */
export function ArtifactsPage() {
	const { recent, isReady: tasksReady } = useTaskTree()
	const { artifacts, isReady: artifactsReady } = useRecentArtifacts()
	const isReady = tasksReady && artifactsReady
	const threads = useOpenThreadCounts()
	const [filter, setFilter] = useState('')
	const [selectedId, setSelectedId] = useState<string | null>(null)

	const tasks = new Map(recent.map((row) => [row.task.id, { row, project: row.projectName }] as const))
	const needle = filter.trim().toLowerCase()
	const entries: Entry[] = artifacts.flatMap((artifact) => {
		const owner = tasks.get(artifact.task_id)
		if (!owner || isPromptArtifact(artifact) || !isListedArtifact(artifact)) return []
		const entry = { artifact, ...owner }
		const haystack = `${artifactName(artifact.file_name)} ${owner.row.task.name} ${owner.project}`.toLowerCase()
		return !needle || haystack.includes(needle) ? [entry] : []
	})
	const selected = entries.find((entry) => entry.artifact.id === selectedId) ?? entries[0] ?? null

	return (
		<main className="main">
			<div className="titlebar">
				<span className="title">Artifacts</span>
			</div>
			<div className="inbox-body docs">
				<div className="inbox-list">
					{needle || entries.length > 0 ? (
						<label className="inbox-search">
							<Search className="i sm" strokeWidth={1.6} />
							<input
								placeholder="Search artifacts"
								value={filter}
								onChange={(event) => setFilter(event.target.value)}
								aria-label="Search artifacts"
							/>
						</label>
					) : null}
					{entries.map((entry) => (
						<button
							key={entry.artifact.id}
							type="button"
							className={`inbox-row${entry === selected ? ' sel' : ''}`}
							aria-current={entry === selected ? 'true' : undefined}
							onClick={() => setSelectedId(entry.artifact.id)}
						>
							{isImageArtifact(entry.artifact) ? (
								<Image className="i sm pr-ico muted" strokeWidth={1.6} />
							) : (
								<FileText className="i sm pr-ico muted" strokeWidth={1.6} />
							)}
							<span className="t">
								<b>{artifactName(entry.artifact.file_name)}</b>
								<span className="muted">
									{entry.row.task.name} · {entry.project}
								</span>
							</span>
							<span className="side">
								<span className="muted age">
									{formatAge(toMs(entry.artifact.last_updated_at ?? 0))}
								</span>
								{threads.get(entry.artifact.id) ? (
									<span
										className="muted threads"
										title={plural(threads.get(entry.artifact.id) ?? 0, 'open thread')}
									>
										<MessageSquare className="i xs" strokeWidth={1.8} />
										{threads.get(entry.artifact.id)}
									</span>
								) : null}
							</span>
						</button>
					))}
					{!isReady && entries.length === 0 ? <div className="boot-mark" /> : null}
					{isReady && entries.length === 0 ? (
						<div className="inbox-empty">
							<FileText className="i" strokeWidth={1.4} />
							<b>{needle ? 'No matches' : 'No artifacts yet'}</b>
							<span className="muted">
								Research, plans and other documents the agent writes show up here.
							</span>
						</div>
					) : null}
				</div>
				{selected ? <SelectedArtifact key={selected.artifact.id} entry={selected} /> : null}
			</div>
		</main>
	)
}

/** Open comment threads per document: unresolved first comments, since replies belong to them. */
function useOpenThreadCounts(): Map<string, number> {
	const { artifactCommentsCollection: comments } = useSync()
	const { data } = useLiveQuery(
		(q) =>
			q
				.from({ comments })
				.where(({ comments }) => and(eq(comments.is_resolved, false), eq(comments.is_deleted, false)))
				.select(({ comments }) => ({
					artifactId: comments.artifact_id,
					replyTo: comments.reply_to_comment_id,
				})),
		[comments],
	)
	const counts = new Map<string, number>()
	for (const row of data ?? []) {
		if (!row.replyTo) counts.set(row.artifactId, (counts.get(row.artifactId) ?? 0) + 1)
	}
	return counts
}

function SelectedArtifact({ entry }: { entry: Entry }) {
	const { artifact, row } = entry
	return (
		<div className="inbox-detail">
			{row.latest ? (
				<ArtifactView task={row.task} artifact={artifact} sessionId={row.latest.id}>
					<Link
						className="btn sm"
						to="/tasks/$taskId"
						params={{ taskId: row.task.id }}
						search={{ artifactId: artifact.id }}
						title={row.task.name ?? undefined}
					>
						Open in task
					</Link>
				</ArtifactView>
			) : null}
		</div>
	)
}
