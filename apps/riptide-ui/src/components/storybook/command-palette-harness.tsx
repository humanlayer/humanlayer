import { Button } from '@humanlayer/ui/components/button'
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from '@humanlayer/ui/components/command'
import { cn } from '@humanlayer/ui/lib/utils'
import { FolderKanban, List, Pause, Play, RotateCcw, Settings, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const MAX_VISIBLE_RESULTS = 5
const _ACTION_COUNT = 8
const DEFAULT_QUERY_TEXT = 'auth'

type PayloadMode = 'composite-value' | 'split-keywords'
type ChurnMode = 'none' | 'matched-sessions' | 'dataset-wide'

interface FakeTask {
	id: string
	name: string
	updatedAt: number
	searchText: string
}

interface FakeSession {
	id: string
	title: string
	summary: string
	prompt: string
	workingDirectory: string
	model: string
	taskName: string
	lastActivityAt: number
	searchText: string
	isMatching: boolean
	isLargePrompt: boolean
}

interface TimingSummary {
	lastInputToPaintMs: number | null
	worstInputToPaintMs: number | null
	meanInputToPaintMs: number | null
	lastRefreshToPaintMs: number | null
	worstRefreshToPaintMs: number | null
	meanRefreshToPaintMs: number | null
	inputSampleCount: number
	refreshSampleCount: number
}

export interface CommandPaletteHarnessProps {
	taskCount?: number
	sessionCount?: number
	largePromptChars?: number
	matchingSessionCount?: number
	payloadMode?: PayloadMode
	churnMode?: ChurnMode
	churnIntervalMs?: number
	churnOnMount?: boolean
	simulateDebounceMs?: number
	queryText?: string
	autoTypeCadenceMs?: number
	autoTypeOnMount?: boolean
	showPromptPreview?: boolean
}

const ACTION_ITEMS = [
	{ id: 'create-session', label: 'Create Session', shortcut: 'C' },
	{ id: 'create-task', label: 'Create Task', shortcut: 'T' },
	{ id: 'settings', label: 'Settings', shortcut: 'S' },
	{ id: 'go-sessions', label: 'Go to Sessions', shortcut: 'G' },
	{ id: 'go-tasks', label: 'Go to Tasks', shortcut: 'A' },
	{ id: 'go-drafts', label: 'Go to Drafts', shortcut: 'D' },
	{ id: 'archive', label: 'Archive Session', shortcut: 'E' },
	{ id: 'starred', label: 'Starred Items', shortcut: 'R' },
] as const

function normalizeSearch(value: string) {
	return value.trim().toLowerCase()
}

function createLargePrompt(sizeInChars: number, token: string) {
	if (sizeInChars <= 0) return `${token} short prompt`
	const base = `${token} context block includes stack traces, notes, file paths, and reproduction hints. `
	let output = ''
	while (output.length < sizeInChars) {
		output += base
	}
	return output.slice(0, sizeInChars)
}

function makeFakeTasks(count: number, queryText: string): FakeTask[] {
	const normalizedQuery = normalizeSearch(queryText) || DEFAULT_QUERY_TEXT
	return Array.from({ length: count }, (_, index) => {
		const isMatching = index < 20
		const name = isMatching
			? `Auth recovery task ${index + 1} for ${normalizedQuery}`
			: `Background maintenance task ${index + 1}`
		const updatedAt = Date.now() - index * 1_000
		return {
			id: `task-${index + 1}`,
			name,
			updatedAt,
			searchText: normalizeSearch(name),
		}
	})
}

function makeFakeSessions({
	count,
	queryText,
	matchingSessionCount,
	largePromptChars,
}: {
	count: number
	queryText: string
	matchingSessionCount: number
	largePromptChars: number
}): FakeSession[] {
	const normalizedQuery = normalizeSearch(queryText) || DEFAULT_QUERY_TEXT
	const largePromptCount = Math.min(Math.max(matchingSessionCount, MAX_VISIBLE_RESULTS), count)

	return Array.from({ length: count }, (_, index) => {
		const isMatching = index < Math.max(20, matchingSessionCount)
		const isLargePrompt = index < largePromptCount
		const title = isMatching
			? `Auth investigation session ${index + 1} for ${normalizedQuery}`
			: `Background sync session ${index + 1}`
		const summary = isMatching
			? `Triaging ${normalizedQuery} regression and approval churn`
			: `Routine infrastructure checks for unrelated workflows`
		const prompt = isLargePrompt
			? createLargePrompt(largePromptChars, `${normalizedQuery}-${index + 1}`)
			: `${normalizedQuery} short prompt ${index + 1}`
		const taskName = isMatching ? `Auth task ${index + 1}` : `General task ${index + 1}`
		const workingDirectory = `/Users/dev/projects/${isMatching ? 'auth-service' : 'ops-tools'}/${index + 1}`
		const model = index % 2 === 0 ? 'claude-opus-4-7' : 'claude-sonnet-5'
		const lastActivityAt = Date.now() - index * 750
		return {
			id: `session-${index + 1}`,
			title,
			summary,
			prompt,
			workingDirectory,
			model,
			taskName,
			lastActivityAt,
			searchText: normalizeSearch(`${title} ${summary} ${taskName}`),
			isMatching,
			isLargePrompt,
		}
	})
}

function computeVisibleTasks(tasks: FakeTask[], debouncedSearch: string) {
	const normalizedSearch = normalizeSearch(debouncedSearch)
	const matches = normalizedSearch ? tasks.filter((task) => task.searchText.includes(normalizedSearch)) : tasks
	return [...matches].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_VISIBLE_RESULTS)
}

function computeVisibleSessions(sessions: FakeSession[], debouncedSearch: string) {
	const normalizedSearch = normalizeSearch(debouncedSearch)
	const matches = normalizedSearch
		? sessions.filter((session) => session.searchText.includes(normalizedSearch))
		: sessions
	return [...matches].sort((left, right) => right.lastActivityAt - left.lastActivityAt).slice(0, MAX_VISIBLE_RESULTS)
}

function getSessionValue(session: FakeSession, payloadMode: PayloadMode) {
	if (payloadMode === 'composite-value') {
		return `session-${session.id}-${session.title}-${session.summary}-${session.prompt}`
	}
	return session.id
}

function getSessionKeywords(session: FakeSession, payloadMode: PayloadMode) {
	if (payloadMode === 'composite-value') {
		return [session.taskName, session.workingDirectory, session.model]
	}
	return [session.title, session.summary, session.taskName, session.workingDirectory, session.model]
}

function getInterpretation({
	payloadMode,
	largePromptChars,
	churnMode,
	timing,
}: {
	payloadMode: PayloadMode
	largePromptChars: number
	churnMode: ChurnMode
	timing: TimingSummary
}) {
	const worstInput = timing.worstInputToPaintMs ?? 0
	const worstRefresh = timing.worstRefreshToPaintMs ?? 0
	if (worstInput > 100 && payloadMode === 'composite-value' && largePromptChars > 0) {
		return 'Large matched session payloads look like the likely source of input lag.'
	}
	if (worstRefresh > 100 && churnMode !== 'none') {
		return 'High-churn result replacement is amplifying repaint cost.'
	}
	if (worstInput < 16 && worstRefresh < 16) {
		return 'This scenario looks healthy; large dataset alone is not causing visible lag.'
	}
	if (worstInput > 50) {
		return 'Typing is noticeably delayed; compare against split-keywords mode to isolate cmdk payload cost.'
	}
	return 'This scenario is mildly degraded; compare against the churn and payload toggles.'
}

function updateTimingSample(previous: number | null, next: number) {
	if (previous === null) return next
	return previous > next ? previous : next
}

function formatMs(value: number | null) {
	if (value === null) return '--'
	return `${value.toFixed(1)}ms`
}

function buildMean(total: number, count: number) {
	if (count === 0) return null
	return total / count
}

function applySessionChurn({
	sessions,
	churnMode,
	rotation,
}: {
	sessions: FakeSession[]
	churnMode: ChurnMode
	rotation: number
}) {
	if (churnMode === 'none' || sessions.length === 0) return sessions

	const nextSessions = sessions.map((session) => ({ ...session }))
	const candidateIndexes = nextSessions
		.map((session, index) => ({ session, index }))
		.filter(({ session }) => (churnMode === 'matched-sessions' ? session.isMatching : true))
		.map(({ index }) => index)

	if (candidateIndexes.length === 0) return nextSessions

	const windowSize = Math.min(churnMode === 'matched-sessions' ? 4 : 12, candidateIndexes.length)
	for (let offset = 0; offset < windowSize; offset += 1) {
		const candidateIndex = candidateIndexes[(rotation + offset) % candidateIndexes.length]
		if (candidateIndex === undefined) continue
		const current = nextSessions[candidateIndex]
		if (current === undefined) continue
		const jitter = offset * 7
		nextSessions[candidateIndex] = {
			...current,
			lastActivityAt: Date.now() + jitter,
		}
	}

	return nextSessions
}

function DebugMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded border bg-background/80 px-2 py-1">
			<div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
			<div className="font-mono text-xs text-foreground">{value}</div>
		</div>
	)
}

export function CommandPaletteHarness({
	taskCount = 1_000,
	sessionCount = 1_000,
	largePromptChars = 25_000,
	matchingSessionCount = 8,
	payloadMode = 'composite-value',
	churnMode = 'none',
	churnIntervalMs = 250,
	churnOnMount = false,
	simulateDebounceMs = 150,
	queryText = DEFAULT_QUERY_TEXT,
	autoTypeCadenceMs = 50,
	autoTypeOnMount = false,
	showPromptPreview = false,
}: CommandPaletteHarnessProps) {
	const initialTasks = useMemo(() => makeFakeTasks(taskCount, queryText), [taskCount, queryText])
	const initialSessions = useMemo(
		() =>
			makeFakeSessions({
				count: sessionCount,
				queryText,
				matchingSessionCount,
				largePromptChars,
			}),
		[sessionCount, queryText, matchingSessionCount, largePromptChars],
	)

	const [tasks, setTasks] = useState(initialTasks)
	const [sessions, setSessions] = useState(initialSessions)
	const [search, setSearch] = useState('')
	const [debouncedSearch, setDebouncedSearch] = useState('')
	const [autoTyping, setAutoTyping] = useState(false)
	const [churnActive, setChurnActive] = useState(churnOnMount && churnMode !== 'none')
	const [churnTick, setChurnTick] = useState(0)
	const [selectedItem, setSelectedItem] = useState<string | null>(null)
	const [timingSummary, setTimingSummary] = useState<TimingSummary>({
		lastInputToPaintMs: null,
		worstInputToPaintMs: null,
		meanInputToPaintMs: null,
		lastRefreshToPaintMs: null,
		worstRefreshToPaintMs: null,
		meanRefreshToPaintMs: null,
		inputSampleCount: 0,
		refreshSampleCount: 0,
	})

	const inputTotalRef = useRef(0)
	const refreshTotalRef = useRef(0)
	const pendingRefreshStartRef = useRef<number | null>(null)
	const autoTypeStartedRef = useRef(false)
	const churnRotationRef = useRef(0)

	useEffect(() => {
		setTasks(initialTasks)
		setSessions(initialSessions)
		setSearch('')
		setDebouncedSearch('')
		setAutoTyping(false)
		setChurnActive(churnOnMount && churnMode !== 'none')
		setChurnTick(0)
		setSelectedItem(null)
		inputTotalRef.current = 0
		refreshTotalRef.current = 0
		pendingRefreshStartRef.current = null
		autoTypeStartedRef.current = false
		churnRotationRef.current = 0
		setTimingSummary({
			lastInputToPaintMs: null,
			worstInputToPaintMs: null,
			meanInputToPaintMs: null,
			lastRefreshToPaintMs: null,
			worstRefreshToPaintMs: null,
			meanRefreshToPaintMs: null,
			inputSampleCount: 0,
			refreshSampleCount: 0,
		})
	}, [churnMode, churnOnMount, initialTasks, initialSessions])

	const recordInputPaint = useCallback((startedAt: number) => {
		requestAnimationFrame(() => {
			const delta = performance.now() - startedAt
			inputTotalRef.current += delta
			setTimingSummary((previous) => {
				const inputSampleCount = previous.inputSampleCount + 1
				return {
					...previous,
					lastInputToPaintMs: delta,
					worstInputToPaintMs: updateTimingSample(previous.worstInputToPaintMs, delta),
					meanInputToPaintMs: buildMean(inputTotalRef.current, inputSampleCount),
					inputSampleCount,
				}
			})
		})
	}, [])

	const handleSearchChange = useCallback(
		(value: string) => {
			const startedAt = performance.now()
			setSearch(value)
			recordInputPaint(startedAt)
		},
		[recordInputPaint],
	)

	useEffect(() => {
		if (simulateDebounceMs <= 0) {
			pendingRefreshStartRef.current = performance.now()
			setDebouncedSearch(search)
			return
		}

		const timeoutId = window.setTimeout(() => {
			pendingRefreshStartRef.current = performance.now()
			setDebouncedSearch(search)
		}, simulateDebounceMs)

		return () => window.clearTimeout(timeoutId)
	}, [search, simulateDebounceMs])

	useEffect(() => {
		if (churnMode === 'none' || !churnActive) return
		const intervalId = window.setInterval(() => {
			pendingRefreshStartRef.current = performance.now()
			churnRotationRef.current += 1
			setSessions((previous) =>
				applySessionChurn({
					sessions: previous,
					churnMode,
					rotation: churnRotationRef.current,
				}),
			)
			setChurnTick((previous) => previous + 1)
		}, churnIntervalMs)

		return () => window.clearInterval(intervalId)
	}, [churnActive, churnMode, churnIntervalMs])

	const visibleTasks = useMemo(() => computeVisibleTasks(tasks, debouncedSearch), [tasks, debouncedSearch])
	const visibleSessions = useMemo(
		() => computeVisibleSessions(sessions, debouncedSearch),
		[sessions, debouncedSearch],
	)

	const visibleSignature = useMemo(
		() =>
			[
				debouncedSearch,
				visibleTasks.map((task) => `${task.id}:${task.updatedAt}`).join(','),
				visibleSessions.map((session) => `${session.id}:${session.lastActivityAt}`).join(','),
			].join('|'),
		[debouncedSearch, visibleTasks, visibleSessions],
	)

	useEffect(() => {
		const startedAt = pendingRefreshStartRef.current
		if (startedAt === null) return
		pendingRefreshStartRef.current = null

		requestAnimationFrame(() => {
			const delta = performance.now() - startedAt
			refreshTotalRef.current += delta
			setTimingSummary((previous) => {
				const refreshSampleCount = previous.refreshSampleCount + 1
				return {
					...previous,
					lastRefreshToPaintMs: delta,
					worstRefreshToPaintMs: updateTimingSample(previous.worstRefreshToPaintMs, delta),
					meanRefreshToPaintMs: buildMean(refreshTotalRef.current, refreshSampleCount),
					refreshSampleCount,
				}
			})
		})
	}, [visibleSignature])

	useEffect(() => {
		if (!autoTypeOnMount || autoTypeStartedRef.current) return
		autoTypeStartedRef.current = true
		setAutoTyping(true)
	}, [autoTypeOnMount])

	useEffect(() => {
		if (!autoTyping) return

		let index = 0
		setSearch('')
		setDebouncedSearch('')
		const query = queryText

		const intervalId = window.setInterval(() => {
			index += 1
			handleSearchChange(query.slice(0, index))
			if (index >= query.length) {
				window.clearInterval(intervalId)
				setAutoTyping(false)
			}
		}, autoTypeCadenceMs)

		return () => window.clearInterval(intervalId)
	}, [autoTyping, autoTypeCadenceMs, handleSearchChange, queryText])

	const renderedSearchableChars = useMemo(() => {
		const taskChars = visibleTasks.reduce((total, task) => total + task.name.length + task.id.length, 0)
		const sessionChars = visibleSessions.reduce((total, session) => {
			const valueChars = getSessionValue(session, payloadMode).length
			const keywordChars = getSessionKeywords(session, payloadMode).join(' ').length
			return total + valueChars + keywordChars
		}, 0)
		return taskChars + sessionChars
	}, [payloadMode, visibleSessions, visibleTasks])

	const interpretation = useMemo(
		() => getInterpretation({ payloadMode, largePromptChars, churnMode, timing: timingSummary }),
		[churnMode, largePromptChars, payloadMode, timingSummary],
	)

	const selectedSession = visibleSessions.find((session) => session.id === selectedItem) ?? null

	return (
		<div className="min-h-[840px] w-full bg-[radial-gradient(circle_at_top,_rgba(120,119,198,0.08),_transparent_45%),linear-gradient(180deg,_rgba(255,255,255,0.92),_rgba(248,250,252,0.96))] p-6">
			<div className="mx-auto flex max-w-6xl flex-col gap-4">
				<div className="rounded-2xl border bg-background/95 p-4 shadow-sm">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="space-y-1">
							<div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
								Fuzzy-Finding Isolation Harness
							</div>
							<h2 className="text-xl font-semibold text-foreground">Command Palette repro harness</h2>
							<p className="max-w-3xl text-sm text-muted-foreground">
								This harness keeps the visible result cap fixed at 5 tasks and 5 sessions while varying
								the backing dataset size, prompt-search scope, matched prompt size, and synthetic
								last-activity churn.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => setAutoTyping((previous) => !previous)}
							>
								{autoTyping ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
								{autoTyping ? 'Stop auto type' : 'Auto type query'}
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={churnMode === 'none'}
								onClick={() => setChurnActive((previous) => !previous)}
							>
								{churnActive ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
								{churnMode === 'none'
									? 'No churn configured'
									: churnActive
										? 'Pause churn'
										: 'Start churn'}
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setAutoTyping(false)
									setChurnActive(false)
									setSelectedItem(null)
									setSearch('')
									setDebouncedSearch('')
								}}
							>
								<RotateCcw className="mr-2 h-4 w-4" />
								Reset query
							</Button>
						</div>
					</div>

					<div className="mt-4 grid gap-2 md:grid-cols-4 xl:grid-cols-6">
						<DebugMetric label="Dataset" value={`${taskCount} tasks / ${sessionCount} sessions`} />
						<DebugMetric
							label="Rendered"
							value={`${visibleTasks.length} tasks / ${visibleSessions.length} sessions`}
						/>
						<DebugMetric label="Payload mode" value={payloadMode} />
						<DebugMetric label="Prompt size" value={`${largePromptChars.toLocaleString()} chars`} />
						<DebugMetric label="Churn" value={`${churnMode} @ ${churnIntervalMs}ms`} />
						<DebugMetric
							label="Churn state"
							value={churnMode === 'none' ? 'disabled' : churnActive ? 'running' : 'paused'}
						/>
						<DebugMetric label="Searchable chars" value={renderedSearchableChars.toLocaleString()} />
						<DebugMetric label="Query" value={search || '(empty)'} />
						<DebugMetric label="Debounced query" value={debouncedSearch || '(empty)'} />
						<DebugMetric
							label="Input latency"
							value={`${formatMs(timingSummary.lastInputToPaintMs)} / worst ${formatMs(timingSummary.worstInputToPaintMs)}`}
						/>
						<DebugMetric
							label="Refresh latency"
							value={`${formatMs(timingSummary.lastRefreshToPaintMs)} / worst ${formatMs(timingSummary.worstRefreshToPaintMs)}`}
						/>
						<DebugMetric
							label="Means"
							value={`${formatMs(timingSummary.meanInputToPaintMs)} input / ${formatMs(timingSummary.meanRefreshToPaintMs)} refresh`}
						/>
						<DebugMetric label="Churn tick" value={churnTick.toString()} />
					</div>

					<div className="mt-4 rounded-xl border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
						<Sparkles className="mr-2 inline h-4 w-4 align-text-bottom text-foreground" />
						{interpretation}
					</div>
				</div>

				<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
					<div className="rounded-2xl border bg-background/95 p-4 shadow-sm">
						<Command className="overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-sm">
							<CommandInput
								placeholder="Type to simulate Cmd+K filtering..."
								value={search}
								onValueChange={handleSearchChange}
							/>
							<CommandList className="max-h-[540px]">
								<CommandEmpty>
									No results for the current raw input. Wait for debounce or adjust the payload mode.
								</CommandEmpty>
								<CommandGroup heading="Actions">
									{ACTION_ITEMS.map((action) => (
										<CommandItem
											key={action.id}
											value={action.id}
											onSelect={() => setSelectedItem(action.id)}
										>
											<Settings className="mr-2 h-4 w-4" />
											<span>{action.label}</span>
											<CommandShortcut>{action.shortcut}</CommandShortcut>
										</CommandItem>
									))}
								</CommandGroup>

								<CommandGroup heading="Tasks">
									{visibleTasks.map((task) => (
										<CommandItem
											key={task.id}
											value={task.id}
											keywords={[task.name]}
											onSelect={() => setSelectedItem(task.id)}
										>
											<FolderKanban className="mr-2 h-4 w-4 shrink-0" />
											<span className="truncate">{task.name}</span>
										</CommandItem>
									))}
								</CommandGroup>

								<CommandGroup heading="Sessions">
									{visibleSessions.map((session) => (
										<CommandItem
											key={session.id}
											value={getSessionValue(session, payloadMode)}
											keywords={getSessionKeywords(session, payloadMode)}
											onSelect={() => setSelectedItem(session.id)}
										>
											<List className="mr-2 h-4 w-4 shrink-0" />
											<div className="flex min-w-0 flex-1 items-center gap-2">
												<span className="truncate">{session.title}</span>
												<span
													className={cn(
														'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
														session.isLargePrompt
															? 'bg-orange-100 text-orange-700'
															: 'bg-muted text-muted-foreground',
													)}
												>
													{session.isLargePrompt ? 'huge prompt' : 'short prompt'}
												</span>
											</div>
										</CommandItem>
									))}
								</CommandGroup>
							</CommandList>
						</Command>
					</div>

					<div className="rounded-2xl border bg-background/95 p-4 shadow-sm">
						<div className="space-y-3">
							<div>
								<div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
									How this scenario works
								</div>
								<p className="mt-2 text-sm text-muted-foreground">
									The backing store is large, but only the top {MAX_VISIBLE_RESULTS} matching tasks
									and sessions are rendered. Cmdk still filters the rendered set using the raw input
									while the visible rows update off the debounced query.
								</p>
							</div>

							<div className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
								<div className="font-medium text-foreground">Isolation target</div>
								<div className="mt-1">
									{payloadMode === 'composite-value'
										? 'This intentionally mimics the risky behavior: session value includes the full prompt payload. Compare this against split-keywords to see why prompt text should not be handed to cmdk.'
										: 'This mirrors the intended production fix: session value stays as a small stable ID and prompt text is excluded from the cmdk payload.'}
								</div>
							</div>

							<div className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
								<div className="font-medium text-foreground">Prompt search scope</div>
								<div className="mt-1">
									The production palette now searches title and summary only. This harness keeps the
									prompt payload available in the fake data so we can see that excluding it from cmdk
									made the big difference.
								</div>
							</div>

							<div className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
								<div className="font-medium text-foreground">Churn model</div>
								<div className="mt-1">
									{churnMode === 'none'
										? 'No synthetic last-activity updates. This is the clean fuzzy-finding isolation pass.'
										: churnMode === 'matched-sessions'
											? 'Only matching sessions get their lastActivityAt bumped, forcing the visible top-5 session rows to reshuffle during typing.'
											: 'The whole dataset churns. This emulates noisy session activity across the broader app and forces repeated top-result recalculation.'}
								</div>
								<div className="mt-2 text-xs font-mono text-foreground">
									State: {churnMode === 'none' ? 'disabled' : churnActive ? 'running' : 'paused'}
								</div>
							</div>

							<div className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
								<div className="font-medium text-foreground">Selected item</div>
								<div className="mt-1 font-mono text-xs text-foreground">
									{selectedItem ?? 'Nothing selected yet'}
								</div>
							</div>

							{showPromptPreview && selectedSession ? (
								<div className="rounded-xl border bg-muted/20 p-3">
									<div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
										Selected session prompt preview
									</div>
									<pre className="mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded border bg-background p-2 text-[11px] text-muted-foreground">
										{selectedSession.prompt.slice(0, 2_000)}
										{selectedSession.prompt.length > 2_000 ? '\n\n...[truncated]' : ''}
									</pre>
								</div>
							) : null}
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
