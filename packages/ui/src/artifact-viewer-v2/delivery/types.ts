export type ArtifactDeliveryCapability =
  | { kind: 'send'; sessionId: string }
  | { kind: 'queue'; sessionId: string }
  | { kind: 'copy' }

export type ArtifactDeliveryMode = 'send' | 'send-and-resolve'

export type ArtifactDeliveryResult =
  | { kind: 'delivered' }
  | { kind: 'delivered-and-resolved' }
  | { kind: 'delivered-resolution-failed'; rootCommentIds: readonly string[] }
  | { kind: 'failed'; message: string }
  | { kind: 'copied' }

export function isSendCapable(
  capability: ArtifactDeliveryCapability,
): capability is Extract<ArtifactDeliveryCapability, { kind: 'send' | 'queue' }> {
  return capability.kind === 'send' || capability.kind === 'queue'
}
