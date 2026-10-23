import { ChevronDown, GitCommitHorizontal, GitPullRequest } from 'lucide-react'
import { useRef, useState } from 'react'

import { Menu, MenuLabel } from '@/minimalist/components/Menu'
import { readGitPrefs } from '@/minimalist/lib/git-prefs'
import { commitPrompt, pullRequestPrompt } from '@/minimalist/lib/git-prompts'
import { askToast, useAskAgent } from '@/minimalist/lib/send'

/**
 * Commit, push and open a PR. Each button sends the agent a plain message, so
 * git runs on the host under the usual approvals and the transcript shows it.
 */
export function ShipActions({ sessionId }: { sessionId: string }) {
	const agent = useAskAgent(sessionId)
	const commitAnchor = useRef<HTMLButtonElement>(null)
	const prAnchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState<'commit' | 'pr' | null>(null)
	const [message, setMessage] = useState('')
	const [instructions, setInstructions] = useState('')
	const [draft, setDraft] = useState(() => readGitPrefs().draftPullRequests)

	const run = async (text: string, request: string) => {
		if (!(await agent.ask(text, askToast(request)))) return
		setOpen(null)
		setMessage('')
		setInstructions('')
	}

	return (
		<span className="ship">
			<button type="button" ref={commitAnchor} className="btn" onClick={() => setOpen('commit')}>
				<GitCommitHorizontal className="i sm" strokeWidth={1.6} />
				Commit
				<ChevronDown className="i sm" />
			</button>
			<button
				type="button"
				ref={prAnchor}
				className="btn"
				onClick={() => {
					setDraft(readGitPrefs().draftPullRequests)
					setOpen('pr')
				}}
			>
				<GitPullRequest className="i sm" strokeWidth={1.6} />
				Open PR
			</button>
			<Menu
				anchor={commitAnchor}
				open={open === 'commit'}
				onClose={() => setOpen(null)}
				placement="below-end"
				width={320}
			>
				<form
					className="ship-form"
					onSubmit={(event) => {
						event.preventDefault()
						void run(commitPrompt(message, false), 'Commit')
					}}
				>
					<MenuLabel>Commit message</MenuLabel>
					<textarea
						rows={3}
						aria-label="Commit message"
						placeholder="Leave blank and the agent writes one"
						value={message}
						onChange={(event) => setMessage(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
								event.preventDefault()
								event.currentTarget.form?.requestSubmit()
							}
						}}
					/>
					<div className="acts">
						<button
							type="button"
							className="btn ghost"
							disabled={agent.pending}
							onClick={() => void run('Push the current branch.', 'Push')}
						>
							Push
						</button>
						<span className="sp" />
						<button
							type="button"
							className="btn"
							disabled={agent.pending}
							onClick={() => void run(commitPrompt(message, true), 'Commit and push')}
						>
							Commit and push
						</button>
						<button type="submit" className="btn primary" disabled={agent.pending}>
							Commit <span className="kbd inv">⌘⏎</span>
						</button>
					</div>
				</form>
			</Menu>
			<Menu
				anchor={prAnchor}
				open={open === 'pr'}
				onClose={() => setOpen(null)}
				placement="below-end"
				width={320}
			>
				<form
					className="ship-form"
					onSubmit={(event) => {
						event.preventDefault()
						void run(pullRequestPrompt(draft, instructions), 'Open a PR')
					}}
				>
					<MenuLabel>Instructions for the PR</MenuLabel>
					<textarea
						rows={3}
						aria-label="Instructions for the PR"
						placeholder="Optional. For example, link the ticket."
						value={instructions}
						onChange={(event) => setInstructions(event.target.value)}
					/>
					<label className="check-row">
						<input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />
						Open as a draft
					</label>
					<div className="acts">
						<span className="sp" />
						<button type="submit" className="btn primary" disabled={agent.pending}>
							Open PR
						</button>
					</div>
				</form>
			</Menu>
		</span>
	)
}
