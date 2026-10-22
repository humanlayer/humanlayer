import { describe, expect, test } from 'vitest'

import { formatCheckPrompt } from './export-check-prompt'

const pullRequest = { number: 2261 }

describe('formatCheckPrompt', () => {
  test('names the failing checks and hands the agent the two gh commands', () => {
    const prompt = formatCheckPrompt({
      pullRequest,
      checks: [{ name: 'ARM container build (Electric proxy)' }, { name: 'typecheck' }],
    })

    expect(prompt).toBe(
      [
        'Fix the failing checks on #2261:',
        '',
        '- ARM container build (Electric proxy)',
        '- typecheck',
        '',
        'Logs: `gh pr checks 2261`, then `gh run view <run-id> --log-failed`. If gh is missing or signed out, stop and tell me.',
      ].join('\n'),
    )
  })

  test('speaks of one check in the singular', () => {
    const prompt = formatCheckPrompt({ pullRequest, checks: [{ name: 'typecheck' }] })

    expect(prompt.split('\n')[0]).toBe('Fix the failing check on #2261:')
  })

  test('asks for no push and carries no log text or job links', () => {
    const prompt = formatCheckPrompt({ pullRequest, checks: [{ name: 'typecheck' }] })

    expect(prompt).not.toMatch(/push/i)
    expect(prompt).not.toContain('http')
    expect(prompt.split('\n')).toHaveLength(5)
  })
})
