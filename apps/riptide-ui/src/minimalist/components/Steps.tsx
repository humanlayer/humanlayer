import { Check, ChevronDown, ChevronRight, Square, X } from 'lucide-react'
import { useState } from 'react'

import { StepGlyph } from '@/minimalist/components/icons'
import { Prose } from '@/minimalist/components/Prose'
import { formatDuration, plural, text } from '@/minimalist/lib/format'
import { isEditTool, summarizeStep } from '@/minimalist/lib/tools'
import {
	groupSteps,
	normalizeToolName,
	readDenial,
	type Step,
	type StepGroup,
	type ToolStep,
} from '@/minimalist/lib/transcript'
import { isSyntheticSkillPromptMessage } from '@/utils/sidebar-transforms'

/** An agent's steps, one row each, with runs of reads and searches folded into "Explored". */
export function StepList({ steps }: { steps: readonly Step[] }) {
	return (
		<>
			{groupSteps(steps).map((group) => (
				<StepGroupRow key={group.kind === 'explore' ? group.id : group.step.id} group={group} />
			))}
		</>
	)
}

function StepGroupRow({ group }: { group: StepGroup }) {
	const [open, setOpen] = useState(false)
	if (group.kind === 'single') return <StepRow step={group.step} />
	const reads = group.steps.filter((step) => normalizeToolName(step.name) === 'read').length
	const searches = group.steps.length - reads
	const facts = [reads ? `Read ${reads}` : null, searches ? `Searched ${searches}` : null].filter(Boolean).join(', ')
	return (
		<>
			<button type="button" className="step grp clickable" aria-expanded={open} onClick={() => setOpen(!open)}>
				{open ? <ChevronDown className="i sm" /> : <ChevronRight className="i sm" />}
				<span>Explored {plural(group.steps.length, 'item')}</span>
				<span className="muted">· {facts}</span>
			</button>
			{open ? (
				<div className="substeps">
					{group.steps.map((step) => (
						<StepRow key={step.id} step={step} />
					))}
				</div>
			) : null}
		</>
	)
}

function StepRow({ step }: { step: Step }) {
	const [open, setOpen] = useState(false)
	if (step.kind === 'thinking') {
		return (
			<button type="button" className="think clickable" aria-expanded={open} onClick={() => setOpen(!open)}>
				{open ? step.text : firstLine(step.text)}
			</button>
		)
	}
	if (step.kind === 'commentary') return <Prose text={step.text} />
	if (step.kind === 'skill') {
		return (
			<>
				<button
					type="button"
					className="step grp clickable"
					onClick={() => setOpen(!open)}
					aria-expanded={open}
				>
					<StepGlyph icon="list" />
					<span className="t">
						Loaded skill {step.name ? <span className="mono">{step.name}</span> : null}
					</span>
				</button>
				{open ? <SkillCard text={step.text} /> : null}
			</>
		)
	}
	const summary = summarizeStep(step)
	const name = normalizeToolName(step.name)
	const running = step.endedAt === null && step.approvalStatus !== 'pending'
	const denied = step.approvalStatus === 'denied'
	const feedback = denied ? readDenial(step.result)?.feedback : null
	if (name === 'todowrite') return null
	const isAgent = name === 'task' || name === 'agent'
	return (
		<>
			<button type="button" className="step grp clickable" onClick={() => setOpen(!open)} aria-expanded={open}>
				{running ? <span className="spin" /> : <StepGlyph icon={summary.icon} />}
				<span className="t">
					{isAgent ? <b>{summary.verb}</b> : summary.verb}{' '}
					{summary.target ? <span className="mono">{summary.target}</span> : null}
				</span>
				{summary.meta && isEditTool(step.name) ? <EditMeta meta={summary.meta} /> : null}
				{summary.meta && !isEditTool(step.name) ? <span className="muted">· {summary.meta}</span> : null}
				{step.approvalStatus === 'pending' ? <span className="muted">· Waiting for you</span> : null}
				{denied ? <span className="del">· Denied</span> : null}
				{step.isError && !denied ? <span className="del">· Failed</span> : null}
				{step.endedAt && !isAgent && !denied ? (
					<span className="muted">· {formatDuration(step.endedAt - step.startedAt)}</span>
				) : null}
			</button>
			{feedback ? <div className="denial">{feedback}</div> : null}
			{open ? <StepDetail step={step} /> : null}
		</>
	)
}

function EditMeta({ meta }: { meta: string }) {
	const [added, removed] = meta.split(' ')
	return (
		<span className="counts">
			<span className="add">{added}</span> <span className="del">{removed}</span>
		</span>
	)
}

function StepDetail({ step }: { step: ToolStep }) {
	const name = normalizeToolName(step.name)
	if (name === 'bash') return <CommandCard step={step} />
	if (name === 'skill' && step.result && isSyntheticSkillPromptMessage(step.result))
		return <SkillCard text={step.result} />
	if (isEditTool(step.name)) return <DiffCard step={step} />
	if (name === 'task' || name === 'agent') {
		return (
			<div className="subtree">
				{step.children.length === 0 ? <div className="muted">No steps yet</div> : null}
				<StepList steps={step.children} />
				{step.result ? <Prose text={truncate(step.result, 4000)} /> : null}
			</div>
		)
	}
	return (
		<div className="cmd">
			<div className="h">Input</div>
			<pre>{JSON.stringify(step.input, null, 2)}</pre>
			{step.result ? (
				<>
					<div className="h">Result</div>
					<pre>{truncate(step.result, 6000)}</pre>
				</>
			) : null}
		</div>
	)
}

/** The instructions a skill gave the agent, read as a document rather than a raw result. */
function SkillCard({ text }: { text: string }) {
	return (
		<div className="skill-card">
			{/* Claude Code's first line only names the skill's directory; the row already names the skill. */}
			<Prose text={text.replace(/^Base directory for this skill:[^\n]*\n+/, '')} />
		</div>
	)
}

function CommandCard({ step }: { step: ToolStep }) {
	const command = text(step.input.command)
	return (
		<div className="cmd">
			<div className="h">Shell{text(step.input.description) ? ` · ${text(step.input.description)}` : ''}</div>
			<pre>
				<span className="p">$ </span>
				{command}
				{'\n'}
				{step.result ? truncate(step.result, 8000) : step.endedAt ? 'No output' : ''}
			</pre>
			<div className={step.isError ? 'f err' : 'f'}>
				{step.endedAt === null ? (
					<>
						<Square className="i sm" /> Running
					</>
				) : step.isError ? (
					<>
						<X className="i sm" /> Failed
					</>
				) : (
					<>
						<Check className="i sm" /> Success
					</>
				)}
			</div>
		</div>
	)
}

export function DiffCard({ step }: { step: ToolStep }) {
	const input = step.input
	const edits: Array<{ old: string; next: string }> =
		normalizeToolName(step.name) === 'multiedit' && Array.isArray(input.edits)
			? (input.edits as Array<Record<string, unknown>>).map((edit) => ({
					old: text(edit.old_string),
					next: text(edit.new_string),
				}))
			: [{ old: text(input.old_string), next: text(input.new_string, input.content) }]
	return (
		<div className="diffcard">
			<div className="h">
				<span className="mono">{text(input.file_path, input.path)}</span>
			</div>
			{edits.map((edit, index) => (
				<div key={index}>
					{edit.old
						? edit.old.split('\n').map((line, lineIndex) => (
								<div key={`d${lineIndex}`} className="dl d">
									<span className="n" />
									<span className="c">{line}</span>
								</div>
							))
						: null}
					{edit.next.split('\n').map((line, lineIndex) => (
						<div key={`a${lineIndex}`} className="dl a">
							<span className="n" />
							<span className="c">{line}</span>
						</div>
					))}
				</div>
			))}
		</div>
	)
}

function firstLine(text: string): string {
	const line = text.trim().split('\n')[0] ?? ''
	return line.length > 140 ? `${line.slice(0, 140)}…` : line
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}\n… ${plural(text.length - max, 'more character')}` : text
}
