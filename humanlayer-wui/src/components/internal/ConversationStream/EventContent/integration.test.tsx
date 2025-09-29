import { describe, it, expect } from 'bun:test'
import { render } from '@testing-library/react'
import { EditToolCallContent } from './EditToolCallContent'

describe('Malformed tool input handling', () => {
  it('should handle Edit with missing fields', () => {
    const malformedToolInput = {
      file_path: '/test.js',
      old_string: undefined as any,
      new_string: undefined as any,
    }

    const { container } = render(
      <EditToolCallContent
        toolInput={malformedToolInput}
        approvalStatus="pending"
        isCompleted={false}
        isFocused={false}
      />,
    )
    expect(container).toBeDefined()
    // Should not throw
  })

  it('should handle Edit with null fields', () => {
    const malformedToolInput = {
      file_path: '/test.js',
      old_string: null as any,
      new_string: null as any,
    }

    const { container } = render(
      <EditToolCallContent
        toolInput={malformedToolInput}
        approvalStatus="pending"
        isCompleted={false}
        isFocused={false}
      />,
    )
    expect(container).toBeDefined()
    // Should not throw
  })
})
