import { type ReactNode, useState } from 'react'

import { Dialog } from '@/minimalist/components/Dialog'
import {
	PROVIDER_NAMES,
	type Ticket,
	type TicketProvider,
	useGitHubTicketPreview,
	useTicketPreview,
} from '@/minimalist/lib/tickets'

type Props = {
	provider: TicketProvider
	/** `owner/name` of the project's repository, which GitHub lookups start in. */
	projectRepository: string | null
	onAttach: (ticket: Ticket) => void
	onClose: () => void
}

/** Asks for an issue ID or link and shows the issue's title before you attach it. */
export function IssueDialog({ provider, projectRepository, onAttach, onClose }: Props) {
	return provider === 'github' ? (
		<GitHubIssueDialog projectRepository={projectRepository} onAttach={onAttach} onClose={onClose} />
	) : (
		<TrackerIssueDialog provider={provider} onAttach={onAttach} onClose={onClose} />
	)
}

function TrackerIssueDialog({
	provider,
	onAttach,
	onClose,
}: {
	provider: 'linear' | 'jira'
	onAttach: (ticket: Ticket) => void
	onClose: () => void
}) {
	const [value, setValue] = useState('')
	const preview = useTicketPreview(provider, value)
	return (
		<IssueForm
			provider={provider}
			placeholder={provider === 'linear' ? 'ENG-123 or a linear.app link' : 'ABC-123 or a Jira link'}
			value={value}
			onChange={setValue}
			preview={preview}
			onAttach={onAttach}
			onClose={onClose}
		/>
	)
}

/** GitHub issues need a repository; a pasted link brings its own, otherwise the project's is first. */
function GitHubIssueDialog({
	projectRepository,
	onAttach,
	onClose,
}: {
	projectRepository: string | null
	onAttach: (ticket: Ticket) => void
	onClose: () => void
}) {
	const [value, setValue] = useState('')
	const github = useGitHubTicketPreview({ input: value, setInput: setValue, projectRepository })
	const key = (repository: { connectionId: string; repositoryId: string }) =>
		`${repository.connectionId}:${repository.repositoryId}`
	return (
		<IssueForm
			provider="github"
			placeholder="Issue number or a github.com link"
			value={value}
			onChange={github.change}
			preview={github.preview}
			onAttach={onAttach}
			onClose={onClose}
		>
			{github.repositories.length > 1 && github.repository ? (
				<select
					className="select repo-select"
					aria-label="Repository"
					value={key(github.repository)}
					onChange={(event) => {
						const next = github.repositories.find((repository) => key(repository) === event.target.value)
						if (next) github.selectRepository(next)
					}}
				>
					{github.repositories.map((repository) => (
						<option key={key(repository)} value={key(repository)}>
							{repository.fullName}
						</option>
					))}
				</select>
			) : null}
		</IssueForm>
	)
}

function IssueForm({
	provider,
	placeholder,
	value,
	onChange,
	preview,
	onAttach,
	onClose,
	children,
}: {
	provider: TicketProvider
	placeholder: string
	value: string
	onChange: (value: string) => void
	preview: { ticket: Ticket | null; error: string | null; loading: boolean }
	onAttach: (ticket: Ticket) => void
	onClose: () => void
	/** Anything the lookup needs before the ID, such as GitHub's repository. */
	children?: ReactNode
}) {
	const name = PROVIDER_NAMES[provider]
	return (
		<Dialog
			title={`Start from a ${name} issue`}
			description="The agent reads the issue when the task starts."
			onClose={onClose}
			onSubmit={() => {
				if (!preview.ticket) return
				onAttach(preview.ticket)
				onClose()
			}}
		>
			{children}
			<input
				aria-label={`${name} issue ID or link`}
				placeholder={placeholder}
				autoFocus
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
			<div className={`issue-preview${preview.error ? ' error' : ''}`} aria-live="polite">
				{preview.ticket?.name ?? preview.error ?? (preview.loading && value.trim() ? 'Looking up…' : null)}
			</div>
			<div className="dialog-actions">
				<button type="button" className="btn" onClick={onClose}>
					Cancel
				</button>
				<button type="submit" className="btn primary" disabled={!preview.ticket}>
					Attach
				</button>
			</div>
		</Dialog>
	)
}
