import { type PermissionUpdate, parseSuggestions } from '@humanlayer/db/zodschemas/permission-update'
import { FileText, ListChecks, MessageCircle, SquareTerminal } from 'lucide-react'
import { useRef, useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { Prose } from '@/minimalist/components/Prose'
import { DiffCard } from '@/minimalist/components/Steps'
import { basename, text } from '@/minimalist/lib/format'
import { isEditTool } from '@/minimalist/lib/tools'
import { normalizeToolName } from '@/minimalist/lib/transcript'
import { useUi } from '@/minimalist/lib/ui-state'
import { useRiptideApi } from '@/orpc/client'

/** The fields of a synced approvals row this card reads. */
type PendingApproval = {
	id: string
	tool_name: string | null
	tool_input: unknown
	tool_use_id: string | null
	suggestions: unknown
}

type Question = {
	question: string
	header?: string
	multiSelect?: boolean
	options: Array<{ label: string; description?: string }>
}

function readQuestions(input: unknown): Question[] {
	const questions = (input as { questions?: unknown } | null)?.questions
	if (!Array.isArray(questions)) return []
	return questions.filter(
		(question): question is Question =>
			typeof question === 'object' && question !== null && typeof (question as Question).question === 'string',
	)
}

/** Describe a standing "always allow" rule in words, e.g. `Bash(bun test:*)`. */
function ruleText(suggestions: PermissionUpdate[] | undefined): string | null {
	const rule = suggestions?.find((update) => update.type === 'addRules')
	if (!rule || rule.type !== 'addRules') return null
	const first = rule.rules[0]
	if (!first) return null
	return first.ruleContent ? first.ruleContent : first.toolName
}

/**
 * Take keyboard focus when a card appears, unless the user is partway through a message.
 * Single-key shortcuts then act on the card and nowhere else.
 */
function useClaimFocus() {
	const ref = useRef<HTMLDivElement>(null)
	useMountEffect(() => {
		const active = document.activeElement
		const typing =
			(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
			active.value.trim().length > 0
		if (!typing) ref.current?.focus({ preventScroll: true })
	})
	return ref
}

/**
 * Everything the agent waits on docks here, above the composer: tool approvals,
 * AskUserQuestion, and plan review. One pending item at a time, oldest first.
 */
export function AskCard({
	approval,
	total,
	onDenyWithFeedback,
}: {
	approval: PendingApproval
	total: number
	onDenyWithFeedback: (approvalId: string, what: string) => void
}) {
	const { client: api } = useRiptideApi()
	const { showToast } = useUi()
	const [sending, setSending] = useState(false)
	const [resolved, setResolved] = useState(false)
	const lock = useRef(false)
	const busy = sending || resolved
	const name = normalizeToolName(approval.tool_name ?? '')
	const input = (approval.tool_input ?? {}) as Record<string, unknown>
	const suggestions = parseSuggestions(approval.suggestions)
	const root = useClaimFocus()

	const resolve = async (
		decision: 'approve' | 'deny',
		extra?: { comment?: string; applied?: PermissionUpdate[] },
	) => {
		if (lock.current || resolved) return
		lock.current = true
		setSending(true)
		try {
			await api.approvals.resolve({
				approvalId: approval.id,
				decision,
				comment: extra?.comment,
				appliedSuggestions: extra?.applied,
			})
			setResolved(true)
		} catch {
			showToast('Could not send your answer. The agent is still waiting.')
		} finally {
			lock.current = false
			setSending(false)
		}
	}

	if (name === 'askuserquestion') {
		return (
			<QuestionCard
				questions={readQuestions(input)}
				busy={busy}
				onAnswer={(text) => resolve('deny', { comment: text })}
			/>
		)
	}
	if (name === 'exitplanmode') {
		return (
			<div ref={root} className="ask" role="group" aria-label="Plan review" tabIndex={-1}>
				<div className="q">
					<ListChecks className="i sm" strokeWidth={1.6} />
					Ready to build this plan?
				</div>
				<div className="plan">
					<Prose text={text(input.plan)} />
				</div>
				<div className="acts">
					<button
						type="button"
						className="btn"
						disabled={busy}
						onClick={() => onDenyWithFeedback(approval.id, 'the plan')}
					>
						Keep planning
					</button>
					<span className="sp" />
					<button
						type="button"
						className="btn primary"
						disabled={busy}
						onClick={() => void resolve('approve')}
					>
						Build it
					</button>
				</div>
			</div>
		)
	}

	const isEdit = isEditTool(approval.tool_name ?? '')
	const target = text(input.file_path, input.path)
	const rule = ruleText(suggestions)
	return (
		<div
			ref={root}
			className="ask"
			role="group"
			aria-label="Tool approval"
			tabIndex={-1}
			onKeyDown={(event) => {
				if (busy || event.target !== event.currentTarget) return
				if (event.metaKey || event.ctrlKey || event.altKey) return
				if (event.key === 'Enter') {
					event.preventDefault()
					void resolve('approve')
				}
				if (event.key.toLowerCase() === 'd') {
					event.preventDefault()
					onDenyWithFeedback(approval.id, isEdit ? `edit to ${basename(target)}` : 'command')
				}
			}}
		>
			<div className="q">
				{isEdit ? (
					<FileText className="i sm" strokeWidth={1.6} />
				) : (
					<SquareTerminal className="i sm" strokeWidth={1.6} />
				)}
				{name === 'bash' ? (
					'Run this command?'
				) : isEdit ? (
					<>
						Edit <span className="mono">{basename(target)}</span>?
					</>
				) : (
					<>
						Use <span className="mono">{approval.tool_name}</span>?
					</>
				)}
				{total > 1 ? <span className="muted">· 1 of {total}</span> : null}
			</div>
			{name === 'bash' ? <pre>{text(input.command)}</pre> : null}
			{isEdit ? (
				<DiffCard
					step={{
						kind: 'tool',
						id: approval.id,
						toolCallId: approval.tool_use_id ?? approval.id,
						name: approval.tool_name ?? 'Edit',
						input,
						result: null,
						isError: false,
						approvalStatus: 'pending',
						approvalId: approval.id,
						startedAt: 0,
						endedAt: null,
						children: [],
					}}
				/>
			) : null}
			{name !== 'bash' && !isEdit ? <pre>{JSON.stringify(input, null, 2)}</pre> : null}
			<div className="acts">
				<button
					type="button"
					className="btn"
					disabled={busy}
					onClick={() => onDenyWithFeedback(approval.id, isEdit ? `edit to ${basename(target)}` : 'command')}
				>
					Deny<span className="kbd">D</span>
				</button>
				<span className="sp" />
				{rule && suggestions ? (
					<button
						type="button"
						className="btn allow"
						title={`Always allow ${rule}`}
						disabled={busy}
						onClick={() => void resolve('approve', { applied: suggestions })}
					>
						{rule === text(input.command) ? (
							'Always allow this command'
						) : (
							<>
								Always allow <span className="mono">{rule}</span>
							</>
						)}
					</button>
				) : null}
				<button type="button" className="btn primary" disabled={busy} onClick={() => void resolve('approve')}>
					Approve<span className="kbd inv">⏎</span>
				</button>
			</div>
		</div>
	)
}

function QuestionCard({
	questions,
	busy,
	onAnswer,
}: {
	questions: Question[]
	busy: boolean
	onAnswer: (text: string) => void
}) {
	const [index, setIndex] = useState(0)
	const [answers, setAnswers] = useState<Record<number, string[]>>({})
	const [other, setOther] = useState('')
	const root = useClaimFocus()
	const question = questions[index]
	if (!question) return null
	const selected = answers[index] ?? []
	const toggle = (label: string) =>
		setAnswers((prev) => ({
			...prev,
			[index]: question.multiSelect
				? selected.includes(label)
					? selected.filter((item) => item !== label)
					: [...selected, label]
				: [label],
		}))
	const isLast = index === questions.length - 1
	const finish = () => {
		// The daemon has no native answer path yet; the answers go back as the tool's feedback.
		const lines = questions.map((item, itemIndex) => {
			const picked = answers[itemIndex] ?? []
			const extra = itemIndex === index && other.trim() ? [other.trim()] : []
			return `${item.question}\n→ ${[...picked, ...extra].join(', ') || '(skipped)'}`
		})
		onAnswer(`The user answered your questions:\n\n${lines.join('\n\n')}`)
	}
	const canContinue = !busy && (selected.length > 0 || other.trim().length > 0)
	const next = () => (isLast ? finish() : setIndex(index + 1))
	return (
		<div
			ref={root}
			className="ask"
			role="group"
			aria-label="Question from the agent"
			tabIndex={-1}
			onKeyDown={(event) => {
				if (busy || event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey)
					return
				const picked = Number.isInteger(Number(event.key)) ? question.options[Number(event.key) - 1] : undefined
				if (picked) {
					event.preventDefault()
					toggle(picked.label)
				} else if (event.key === 'Enter' && canContinue) {
					event.preventDefault()
					next()
				}
			}}
		>
			<div className="q">
				<MessageCircle className="i sm" strokeWidth={1.6} />
				{question.question}
			</div>
			{question.header ? <div className="sub">{question.header}</div> : null}
			{question.options.map((option, optionIndex) => (
				<button
					type="button"
					key={option.label}
					className={`opt ${selected.includes(option.label) ? 'sel' : ''}`}
					aria-pressed={selected.includes(option.label)}
					onClick={() => toggle(option.label)}
				>
					<span className="n">{optionIndex + 1}</span>
					<div>
						<div>{option.label}</div>
						{option.description ? <div className="d">{option.description}</div> : null}
					</div>
				</button>
			))}
			<div className="opt other">
				<span className="n">{question.options.length + 1}</span>
				<input
					aria-label="Your own answer"
					placeholder="Something else"
					value={other}
					onChange={(event) => setOther(event.target.value)}
				/>
			</div>
			<div className="acts">
				{questions.length > 1 ? (
					<span className="muted">
						{index + 1} of {questions.length} questions
					</span>
				) : null}
				<span className="sp" />
				<button type="button" className="btn primary" disabled={!canContinue} onClick={next}>
					{isLast ? 'Answer' : 'Next'}
					<span className="kbd inv">⏎</span>
				</button>
			</div>
		</div>
	)
}
