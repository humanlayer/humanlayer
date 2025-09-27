import { describe, it, expect } from 'bun:test'
import { render } from '@testing-library/react'
import { DiffViewer } from './DiffViewer'

describe('DiffViewer edge cases', () => {
  it('should handle undefined oldContent gracefully', () => {
    const { container } = render(
      <DiffViewer oldContent={undefined as any} newContent="new content" mode="unified" />,
    )
    expect(container.textContent).toContain('new content')
  })

  it('should handle undefined newContent gracefully', () => {
    const { container } = render(
      <DiffViewer oldContent="old content" newContent={undefined as any} mode="unified" />,
    )
    expect(container.textContent).toContain('old content')
  })

  it('should handle both undefined gracefully', () => {
    const { container } = render(
      <DiffViewer oldContent={undefined as any} newContent={undefined as any} mode="unified" />,
    )
    expect(container).toBeDefined()
  })

  it('should handle null values gracefully', () => {
    const { container } = render(
      <DiffViewer oldContent={null as any} newContent={null as any} mode="unified" />,
    )
    expect(container).toBeDefined()
  })
})
