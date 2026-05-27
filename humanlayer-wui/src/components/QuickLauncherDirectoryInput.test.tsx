import { describe, test, expect } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RecentPath } from '@/lib/daemon'

import { QuickLauncherDirectoryInput } from './QuickLauncherDirectoryInput'

const recentDirectories: RecentPath[] = [
  { path: '/Users/test/project-alpha', lastUsed: new Date('2026-01-01'), usageCount: 3 },
  { path: '/Users/test/project-beta', lastUsed: new Date('2026-01-02'), usageCount: 2 },
  { path: '/Users/test/zebra-work', lastUsed: new Date('2026-01-03'), usageCount: 1 },
]

const renderInput = (value: string, directories: RecentPath[] = recentDirectories) =>
  render(<QuickLauncherDirectoryInput value={value} onChange={() => {}} recentDirectories={directories} />)

const focusInput = () => {
  const input = screen.getByRole('textbox')
  fireEvent.focus(input)
  return input
}

const queryOption = (path: string) => document.querySelector(`[data-value="${path}"]`)

describe('QuickLauncherDirectoryInput', () => {
  test('focus with empty input shows recent directories dropdown', async () => {
    renderInput('')

    focusInput()

    await waitFor(() => {
      expect(screen.getByText('/Users/test/project-alpha')).toBeDefined()
    })
  })

  test('focus with default ~/ input shows recent directories dropdown', async () => {
    renderInput('~/')

    focusInput()

    await waitFor(() => {
      expect(screen.getByText('/Users/test/project-alpha')).toBeDefined()
    })
  })

  test('focus with explicit path does not auto-open dropdown', () => {
    renderInput('/some/explicit/path')

    focusInput()

    expect(screen.queryByText('/Users/test/project-alpha')).toBeNull()
  })

  test('typing after focus uses fuzzy search against recent directories', async () => {
    renderInput('')

    const input = focusInput()
    fireEvent.change(input, { target: { value: 'zebra' } })

    await waitFor(() => {
      expect(queryOption('/Users/test/zebra-work')).toBeDefined()
    })
    expect(queryOption('/Users/test/project-alpha')).toBeNull()
  })

  test('focus does not open dropdown when there are no recent directories', () => {
    renderInput('~/', [])

    focusInput()

    expect(screen.queryByText('No recent directories')).toBeNull()
  })
})
