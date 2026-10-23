import { describe, expect, test } from 'vitest'

import { getForwardedDecorationClasses } from './CodeBlock'

describe('getForwardedDecorationClasses', () => {
  test('leaves keyboard focus ownership with ProseMirror', () => {
    expect(
      getForwardedDecorationClasses(
        'commented-block artifact-viewer-v2-block-focused active-comment-block',
      ),
    ).toBe('commented-block active-comment-block')
  })

  test('forwards other decoration classes', () => {
    expect(getForwardedDecorationClasses(' pending-block  approved-block ')).toBe(
      'pending-block approved-block',
    )
  })
})
