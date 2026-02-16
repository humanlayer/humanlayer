export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionItem {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

/**
 * Determines whether all questions have valid answers and the form can be submitted.
 *
 * Rules:
 * - Single-select: must have a regular option selected, OR "Other" with non-empty trimmed text
 * - Multi-select: must have at least one regular option selected, OR "Other" with non-empty trimmed text
 *   (if "Other" is checked without text but regular options are selected, submit is allowed)
 */
export function canSubmitQuestions(
  questions: QuestionItem[],
  answers: Record<number, string | string[]>,
  otherSelected: Record<number, boolean>,
  otherTexts: Record<number, string>,
): boolean {
  return questions.every((q, idx) => {
    if (q.multiSelect) {
      const selected = (answers[idx] as string[]) || []
      const hasSelections = selected.length > 0
      // If "Other" is also checked, require non-empty text OR at least one regular selection
      if (otherSelected[idx]) {
        return !!otherTexts[idx]?.trim() || hasSelections
      }
      return hasSelections
    }
    // Single-select
    if (otherSelected[idx]) {
      return !!otherTexts[idx]?.trim()
    }
    return !!answers[idx]
  })
}

/**
 * Builds the answers object in the format expected by Claude's AskUserQuestion tool.
 * Keys are the question header (or `question_{idx}` as fallback).
 * Values are the selected option label(s), or the "Other" text if "Other" was chosen.
 */
export function buildAnswersJson(
  questions: QuestionItem[],
  answers: Record<number, string | string[]>,
  otherSelected: Record<number, boolean>,
  otherTexts: Record<number, string>,
): Record<string, unknown> {
  const answersJson: Record<string, unknown> = {}
  questions.forEach((q, idx) => {
    const key = q.header || `question_${idx}`
    if (otherSelected[idx] && otherTexts[idx]) {
      answersJson[key] = otherTexts[idx]
    } else {
      answersJson[key] = answers[idx]
    }
  })
  return answersJson
}
