import React, { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { ToolHeader } from './ToolHeader'
import { daemonClient } from '@/lib/daemon/client'
import { logger } from '@/lib/logging'
import type { Question } from '@/lib/daemon/types'
import type { ConversationEvent } from '@humanlayer/hld-sdk'
import { Check, X } from 'lucide-react'

interface QuestionOption {
  label: string
  description: string
}

interface QuestionItem {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

interface QuestionContentProps {
  event: ConversationEvent
  sessionId: string
}

export function QuestionContent({ event, sessionId }: QuestionContentProps) {
  const [question, setQuestion] = useState<Question | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  // Answers: keyed by question index, value is label or array of labels
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({})
  // "Other" text inputs keyed by question index
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({})
  // Track which questions have "Other" selected
  const [otherSelected, setOtherSelected] = useState<Record<number, boolean>>({})

  // Parse questions from the tool input
  const questionsInput: QuestionItem[] = React.useMemo(() => {
    try {
      const toolInput = event.toolInputJson ? JSON.parse(event.toolInputJson) : null
      return toolInput?.questions || []
    } catch {
      return []
    }
  }, [event.toolInputJson])

  // Fetch the question entity from hld
  const fetchQuestion = useCallback(async () => {
    try {
      const questions = await daemonClient.listQuestions(sessionId)
      // Match by tool_use_id if available
      // Match by tool_use_id first, fall back to first pending question for the session
      const matched =
        questions.find(q => q.toolUseId && q.toolUseId === event.toolId) ||
        questions.find(q => q.status === 'pending')
      if (matched) {
        setQuestion(matched)
      }
    } catch (err) {
      logger.error('Failed to fetch question:', err)
    } finally {
      setLoading(false)
    }
  }, [sessionId, event.toolId])

  useEffect(() => {
    fetchQuestion()
  }, [fetchQuestion])

  // Refresh when conversation updates (question may have been answered)
  useEffect(() => {
    if (event.isCompleted && question?.status === 'pending') {
      fetchQuestion()
    }
  }, [event.isCompleted, question?.status, fetchQuestion])

  const handleSingleSelect = (questionIndex: number, value: string) => {
    setAnswers(prev => ({ ...prev, [questionIndex]: value }))
    setOtherSelected(prev => ({ ...prev, [questionIndex]: false }))
  }

  const handleMultiSelect = (questionIndex: number, label: string, checked: boolean) => {
    setAnswers(prev => {
      const current = (prev[questionIndex] as string[]) || []
      if (checked) {
        return { ...prev, [questionIndex]: [...current, label] }
      } else {
        return { ...prev, [questionIndex]: current.filter(l => l !== label) }
      }
    })
  }

  const handleOtherToggle = (questionIndex: number, isMulti: boolean) => {
    if (isMulti) {
      // For multi-select, "Other" is just another checkbox
      setOtherSelected(prev => ({ ...prev, [questionIndex]: !prev[questionIndex] }))
    } else {
      // For single-select, "Other" replaces the current selection
      setOtherSelected(prev => ({ ...prev, [questionIndex]: true }))
      setAnswers(prev => ({ ...prev, [questionIndex]: '' }))
    }
  }

  const handleSubmit = async () => {
    if (!question) return
    setSubmitting(true)

    try {
      // Build the answers object in Claude's expected format
      const answersJson: Record<string, unknown> = {}
      questionsInput.forEach((q, idx) => {
        if (otherSelected[idx] && otherTexts[idx]) {
          answersJson[q.header || `question_${idx}`] = otherTexts[idx]
        } else {
          answersJson[q.header || `question_${idx}`] = answers[idx]
        }
      })

      await daemonClient.answerQuestion(question.id, answersJson)
      // Fetch the specific question by ID to get the updated status
      const updated = await daemonClient.getQuestion(question.id)
      setQuestion(updated)
    } catch (err) {
      logger.error('Failed to answer question:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDecline = async () => {
    if (!question) return
    setSubmitting(true)

    try {
      await daemonClient.answerQuestion(question.id, undefined, true)
      const updated = await daemonClient.getQuestion(question.id)
      setQuestion(updated)
    } catch (err) {
      logger.error('Failed to decline question:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = questionsInput.every((q, idx) => {
    if (otherSelected[idx]) {
      return !!otherTexts[idx]?.trim()
    }
    const answer = answers[idx]
    if (q.multiSelect) {
      return Array.isArray(answer) && answer.length > 0
    }
    return !!answer
  })

  // Answered state
  if (question?.status === 'answered') {
    return (
      <div>
        <ToolHeader name="Ask User Question" />
        <div className="mt-2 space-y-3">
          {questionsInput.map((q, idx) => (
            <div key={idx}>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline">{q.header}</Badge>
                <span className="text-sm">{q.question}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                <Check className="size-3.5" />
                <span>
                  {question.answersJson?.[q.header || `question_${idx}`] != null
                    ? String(question.answersJson[q.header || `question_${idx}`])
                    : 'Answered'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Declined state
  if (question?.status === 'declined') {
    return (
      <div>
        <ToolHeader name="Ask User Question" />
        <div className="mt-2 space-y-3">
          {questionsInput.map((q, idx) => (
            <div key={idx}>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline">{q.header}</Badge>
                <span className="text-sm">{q.question}</span>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <X className="size-3.5" />
            <span>User declined to answer</span>
          </div>
        </div>
      </div>
    )
  }

  // Loading or no question entity yet
  if (loading || !question) {
    return (
      <div>
        <ToolHeader name="Ask User Question" />
        <div className="mt-2 text-sm text-muted-foreground">
          {loading ? 'Loading question...' : 'Waiting for question...'}
        </div>
      </div>
    )
  }

  // Pending state - interactive form
  return (
    <div onClick={e => e.stopPropagation()}>
      <ToolHeader name="Ask User Question" />
      <div className="mt-3 space-y-4">
        {questionsInput.map((q, idx) => (
          <div key={idx} className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{q.header}</Badge>
              <span className="text-sm font-medium">{q.question}</span>
            </div>

            {q.multiSelect ? (
              // Multi-select with checkboxes
              <div className="space-y-2 pl-1">
                {q.options.map((opt, optIdx) => (
                  <div key={optIdx} className="flex items-start gap-2">
                    <Checkbox
                      id={`q${idx}-opt${optIdx}`}
                      checked={((answers[idx] as string[]) || []).includes(opt.label)}
                      onCheckedChange={(checked: boolean) =>
                        handleMultiSelect(idx, opt.label, !!checked)
                      }
                    />
                    <Label
                      htmlFor={`q${idx}-opt${optIdx}`}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="text-sm">{opt.label}</span>
                      {opt.description && (
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      )}
                    </Label>
                  </div>
                ))}
                {/* Other option */}
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={`q${idx}-other`}
                    checked={!!otherSelected[idx]}
                    onCheckedChange={() => handleOtherToggle(idx, true)}
                  />
                  <Label htmlFor={`q${idx}-other`} className="flex flex-col items-start gap-0.5">
                    <span className="text-sm">Other</span>
                  </Label>
                </div>
                {otherSelected[idx] && (
                  <Input
                    className="mt-1 h-8 text-sm"
                    placeholder="Type your answer..."
                    value={otherTexts[idx] || ''}
                    onChange={e => setOtherTexts(prev => ({ ...prev, [idx]: e.target.value }))}
                  />
                )}
              </div>
            ) : (
              // Single-select with radio buttons
              <RadioGroup
                className="pl-1"
                value={otherSelected[idx] ? '' : (answers[idx] as string) || ''}
                onValueChange={value => handleSingleSelect(idx, value)}
              >
                {q.options.map((opt, optIdx) => (
                  <div key={optIdx} className="flex items-start gap-2">
                    <RadioGroupItem value={opt.label} id={`q${idx}-opt${optIdx}`} />
                    <Label
                      htmlFor={`q${idx}-opt${optIdx}`}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="text-sm">{opt.label}</span>
                      {opt.description && (
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      )}
                    </Label>
                  </div>
                ))}
                {/* Other option */}
                <div className="flex items-start gap-2">
                  <RadioGroupItem
                    value=""
                    id={`q${idx}-other`}
                    checked={!!otherSelected[idx]}
                    onClick={() => handleOtherToggle(idx, false)}
                  />
                  <Label htmlFor={`q${idx}-other`} className="flex flex-col items-start gap-0.5">
                    <span className="text-sm">Other</span>
                  </Label>
                </div>
                {otherSelected[idx] && (
                  <Input
                    className="mt-1 h-8 text-sm"
                    placeholder="Type your answer..."
                    value={otherTexts[idx] || ''}
                    onChange={e => setOtherTexts(prev => ({ ...prev, [idx]: e.target.value }))}
                  />
                )}
              </RadioGroup>
            )}
          </div>
        ))}

        <div className="flex gap-2">
          <Button size="sm" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? 'Submitting...' : 'Submit'}
          </Button>
          <Button size="sm" variant="outline" disabled={submitting} onClick={handleDecline}>
            Decline
          </Button>
        </div>
      </div>
    </div>
  )
}
