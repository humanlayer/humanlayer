import { describe, expect, it } from 'vitest'

import { isSendCapable, type ArtifactDeliveryCapability } from './types'

describe('artifact delivery types', () => {
  it.each<ArtifactDeliveryCapability>([
    { kind: 'send', sessionId: 's' },
    { kind: 'queue', sessionId: 's' },
  ])('recognizes $kind capability', (capability) => {
    expect(isSendCapable(capability)).toBe(true)
  })

  it('keeps copy capability explicit', () => {
    expect(isSendCapable({ kind: 'copy' })).toBe(false)
  })
})
