import { ExternalLink } from 'lucide-react'

import { useTaskArtifactUrl } from '@/hooks/useTaskArtifactUrl'
import { getArtifactDisplayName, isImageFileName, toTaskArtifactReference } from '@/lib/task-artifact-path'
import { useOpenInTask } from '@/minimalist/lib/thread-panel'

/**
 * A file from a task's directory shown in place: an image as itself, HTML and other files
 * in a sandboxed frame. The name opens the file in its task's side panel.
 */
export function TaskArtifactEmbed({ path }: { path: string }) {
	const reference = toTaskArtifactReference(path)
	const { artifact, url, isLoading, error } = useTaskArtifactUrl(reference)
	const openInTask = useOpenInTask()
	const name = getArtifactDisplayName(reference.fileName)
	const taskId = artifact?.task_id

	const head = (
		<div className="embed-head">
			{artifact && taskId ? (
				<button
					type="button"
					className="embed-name"
					title={`Open ${name}`}
					onClick={() => void openInTask(taskId, { artifactId: artifact.id })}
				>
					{name}
				</button>
			) : (
				<span className="embed-name" title={path}>
					{name}
				</span>
			)}
			{url ? (
				<a className="iconbtn" href={url} target="_blank" rel="noreferrer" title="Open in a new tab">
					<ExternalLink className="i sm" strokeWidth={1.6} />
				</a>
			) : null}
		</div>
	)

	if (error || (!isLoading && !artifact))
		return (
			<div className="embed">
				{head}
				<div className="embed-note">
					{error ? 'Could not load this file.' : 'This file has not synced yet.'}
				</div>
			</div>
		)
	if (isLoading || !artifact) return <div className="embed embed-wait">{head}</div>
	// Documents stored as text have no file to show; the name opens them.
	if (!url) return <div className="embed">{head}</div>

	return (
		<div className="embed">
			{head}
			{isImageFileName(reference.fileName) ? (
				<img className="embed-image" src={url} alt={name} />
			) : (
				<iframe
					key={artifact.last_updated_at?.toString()}
					className="embed-frame"
					src={url}
					title={name}
					sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
				/>
			)}
		</div>
	)
}
