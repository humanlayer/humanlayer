import { describe, test, expect } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QuickLauncherDirectoryInput } from './QuickLauncherDirectoryInput'
import type { RecentPath } from '@/lib/daemon'

const recentDirectories = [
  { path: '/Users/mvanhorn/project-alpha' },
  { path: '/Users/mvanhorn/project-beta' },
  { path: '/Users/mvanhorn/docs' },
] as RecentPath[]

const renderInput = (value?: string, recents: RecentPath[] = recentDirectories) => {
  render(
    <QuickLauncherDirectoryInput
      value={value}
      onChange={() => {}}
      placeholder="Working directory"
      recentDirectories={recents}
    />,
  )

  const input = screen.getByPlaceholderText('Working directory')
  fireEvent.focus(input)
  return input
}

describe('QuickLauncherDirectoryInput', () => {
  test('shows recent directories on focus when input is empty', async () => {
    renderInput('')

    expect(await screen.findByText('/Users/mvanhorn/project-alpha')).toBeInTheDocument()
    expect(screen.getByText('/Users/mvanhorn/project-beta')).toBeInTheDocument()
  })

  test('shows recent directories on focus when input contains default ~/ value', async () => {
    renderInput('~/')

    expect(await screen.findByText('/Users/mvanhorn/project-alpha')).toBeInTheDocument()
    expect(screen.getByText('/Users/mvanhorn/project-beta')).toBeInTheDocument()
  })

  test('does not auto-open recent directories for an explicit path', async () => {
    renderInput('/some/explicit/path')

    await waitFor(() => {
      expect(screen.queryByText('/Users/mvanhorn/project-alpha')).not.toBeInTheDocument()
    })
  })

  test('typing after focus uses fuzzy search against recent directories', async () => {
    const input = renderInput('')

    fireEvent.change(input, { target: { value: 'beta' } })

    await waitFor(() => {
      expect(document.querySelector('[data-value="/Users/mvanhorn/project-beta"]')).toBeInTheDocument()
    })
    expect(screen.queryByText('/Users/mvanhorn/project-alpha')).not.toBeInTheDocument()
  })

  test('does not open dropdown when recent directories are empty', async () => {
    renderInput('~/', [])

    await waitFor(() => {
      expect(screen.queryByText('No recent directories')).not.toBeInTheDocument()
    })
  })
})
