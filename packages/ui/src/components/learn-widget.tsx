'use client'

import type { LearnQuestion } from '@humanlayer/db/zodschemas/learn-questions'
import { cn } from '@humanlayer/ui/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type FC, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from './button'
import { MarkdownRenderer } from './markdown-renderer'

export interface LearnWidgetProps {
	questions: LearnQuestion[]
}

const COUNTDOWN_SECONDS = 3

export const LearnWidget: FC<LearnWidgetProps> = ({ questions }) => {
	const [currentIndex, setCurrentIndex] = useState(0)
	const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null)
	const [stats, setStats] = useState({ correct: 0, incorrect: 0 })
	const [countdown, setCountdown] = useState<number | null>(null)
	const [barFilling, setBarFilling] = useState(false)
	const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null)
	const barRaf = useRef<number | null>(null)

	const question = questions[currentIndex]
	const isAnswered = selectedAnswer !== null
	const isCorrect = selectedAnswer === question?.correctIndex
	const hasNext = currentIndex < questions.length - 1

	const clearTimers = useCallback(() => {
		if (countdownInterval.current) clearInterval(countdownInterval.current)
		if (barRaf.current) cancelAnimationFrame(barRaf.current)
		countdownInterval.current = null
		barRaf.current = null
		setCountdown(null)
		setBarFilling(false)
	}, [])

	const doAdvance = useCallback(() => {
		clearTimers()
		if (currentIndex < questions.length - 1) {
			setCurrentIndex((i) => i + 1)
			setSelectedAnswer(null)
		}
	}, [currentIndex, questions.length, clearTimers])

	const goBack = useCallback(() => {
		clearTimers()
		if (currentIndex > 0) {
			setCurrentIndex((i) => i - 1)
			setSelectedAnswer(null)
		}
	}, [currentIndex, clearTimers])

	const handleAnswer = useCallback(
		(optionIndex: number) => {
			if (isAnswered) return
			setSelectedAnswer(optionIndex)
			const correct = optionIndex === question?.correctIndex
			setStats((s) =>
				correct ? { ...s, correct: s.correct + 1 } : { ...s, incorrect: s.incorrect + 1 },
			)
			// Start countdown auto-advance on correct
			if (correct && currentIndex < questions.length - 1) {
				setCountdown(COUNTDOWN_SECONDS)
				setBarFilling(false)
				// Double rAF ensures the browser paints 0% width before we transition to 100%
				barRaf.current = requestAnimationFrame(() => {
					barRaf.current = requestAnimationFrame(() => {
						setBarFilling(true)
					})
				})
				countdownInterval.current = setInterval(() => {
					setCountdown((prev) => {
						if (prev === null) return null
						return prev - 1
					})
				}, 1000)
			}
		},
		[isAnswered, question?.correctIndex, currentIndex, questions.length],
	)

	// Advance when countdown reaches 0
	useEffect(() => {
		if (countdown === 0) {
			if (countdownInterval.current) clearInterval(countdownInterval.current)
			countdownInterval.current = null
			setCountdown(null)
			setBarFilling(false)
			setCurrentIndex((i) => {
				if (i < questions.length - 1) {
					setSelectedAnswer(null)
					return i + 1
				}
				return i
			})
		}
	}, [countdown, questions.length])

	// Clean up timers on unmount
	useEffect(() => {
		return () => {
			if (countdownInterval.current) clearInterval(countdownInterval.current)
			if (barRaf.current) cancelAnimationFrame(barRaf.current)
		}
	}, [])

	if (!question || questions.length === 0) {
		return <div className="text-muted-foreground text-sm font-mono p-2">No questions available</div>
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center justify-between mb-2 flex-shrink-0">
				<span className="text-sm font-mono">
					<span className="text-[var(--terminal-fg-dim)]">{currentIndex + 1}/{questions.length}</span>
					<span className="text-[var(--terminal-fg-dim)]"> &middot; </span>
					<span className="text-[var(--terminal-success)]">{stats.correct}</span>
					<span className="text-[var(--terminal-fg-dim)]"> / </span>
					<span className="text-[var(--terminal-error)]">{stats.incorrect}</span>
				</span>
				<div className="flex items-center gap-1">
					<Button type="button" variant="ghost" size="icon" className="w-7 h-7" onClick={goBack} disabled={currentIndex === 0}>
						<ChevronLeft className="w-4 h-4" />
					</Button>
					<Button type="button" variant="ghost" size="icon" className="w-7 h-7" onClick={doAdvance} disabled={!hasNext}>
						<ChevronRight className="w-4 h-4" />
					</Button>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto min-h-0 pr-1">
				{question.context && (
					<p className="text-sm text-[var(--terminal-fg-dim)] font-mono mb-2">{question.context}</p>
				)}
				<p className="text-sm font-mono mb-3">{question.question}</p>

				{/* Options */}
				<div className="flex flex-col gap-1">
					{question.options.map((option, i) => {
						const isCorrectOption = i === question.correctIndex
						const isSelected = i === selectedAnswer

						return (
							<div key={`option-${i}`} className="flex flex-col">
								<button
									type="button"
									onClick={() => handleAnswer(i)}
									disabled={isAnswered}
									className={cn(
										'w-full text-left px-2 py-1.5 text-sm font-mono transition-[background-color,border-color,transform] border-l-4 border-transparent',
										!isAnswered &&
											'bg-[color-mix(in_srgb,var(--terminal-fg-dim)_8%,transparent)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--terminal-accent)_20%,transparent)] hover:border-l-[var(--terminal-accent)] active:scale-[0.99]',
										isAnswered && 'cursor-default',
										isAnswered &&
											isCorrectOption &&
											'bg-[color-mix(in_srgb,var(--terminal-success)_20%,transparent)] border-l-[var(--terminal-success)]',
										isAnswered &&
											isCorrectOption &&
											isSelected &&
											'animate-pulse-success text-[var(--terminal-success)]',
										isAnswered &&
											isSelected &&
											!isCorrectOption &&
											'bg-[color-mix(in_srgb,var(--terminal-error)_20%,transparent)] border-l-[var(--terminal-error)]',
										isAnswered && !isCorrectOption && !isSelected && 'opacity-30',
									)}
								>
									<div className="text-sm [&_pre]:text-sm [&_pre]:my-1 [&_p]:my-0.5">
										<MarkdownRenderer content={option.label} variant="terminal" />
									</div>
								</button>
								{isAnswered && isSelected && (
									<div className={cn(
										'px-2 py-1.5 text-sm font-mono border-l-4',
										isCorrect
											? 'bg-[color-mix(in_srgb,var(--terminal-success)_10%,transparent)] border-l-[var(--terminal-success)]'
											: 'bg-[color-mix(in_srgb,var(--terminal-error)_10%,transparent)] border-l-[var(--terminal-error)]',
									)}>
										<span
											className={cn(
												'font-bold uppercase',
												isCorrect
													? 'text-[var(--terminal-success)]'
													: 'text-[var(--terminal-error)]',
											)}
										>
											{isCorrect ? 'correct' : 'incorrect'}
										</span>
										<span className="text-[var(--terminal-fg-dim)]"> — {question.explanation}</span>
									</div>
								)}
							</div>
						)
					})}
				</div>
			</div>

			{/* Auto-advance countdown bar */}
			{countdown !== null && countdown > 0 && (
				<div className="flex-shrink-0 mt-2">
					<div className="flex items-center justify-between text-sm font-mono text-[var(--terminal-success)] mb-1">
						<span>next in {countdown}</span>
						<button
							type="button"
							onClick={doAdvance}
							className="uppercase tracking-wider hover:text-foreground hover:bg-[color-mix(in_srgb,var(--terminal-success)_15%,transparent)] cursor-pointer rounded px-2 py-0.5 transition-colors"
						>
							go now
						</button>
					</div>
					<div className="h-0.5 w-full bg-[color-mix(in_srgb,var(--terminal-fg-dim)_15%,transparent)]">
						<div
							className="h-full bg-[var(--terminal-success)] transition-[width] ease-linear"
							style={{
								width: barFilling ? '100%' : '0%',
								transitionDuration: `${COUNTDOWN_SECONDS * 1000}ms`,
							}}
						/>
					</div>
				</div>
			)}

		</div>
	)
}
