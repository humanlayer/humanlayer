import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from './theme-provider'

describe('ThemeProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('reports the theme to onThemeChange', () => {
    vi.useFakeTimers()
    const onThemeChange = vi.fn()
    render(
      <ThemeProvider defaultTheme="rose-pine-dawn" storageKey="test-theme" onThemeChange={onThemeChange}>
        <div />
      </ThemeProvider>,
    )
    vi.runAllTimers()
    expect(onThemeChange).toHaveBeenCalledWith('rose-pine-dawn')
  })

  // Another owner of the window theme takes over by removing the callback; a report still
  // pending from before must not land after it and overwrite what it set.
  it('drops a pending report once the callback is removed', () => {
    vi.useFakeTimers()
    const onThemeChange = vi.fn()
    const { rerender } = render(
      <ThemeProvider defaultTheme="rose-pine" storageKey="test-theme" onThemeChange={onThemeChange}>
        <div />
      </ThemeProvider>,
    )
    rerender(
      <ThemeProvider defaultTheme="rose-pine" storageKey="test-theme">
        <div />
      </ThemeProvider>,
    )
    vi.runAllTimers()
    expect(onThemeChange).not.toHaveBeenCalled()
  })
})
