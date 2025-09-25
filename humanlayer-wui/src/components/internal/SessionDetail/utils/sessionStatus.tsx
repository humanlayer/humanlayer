import React from 'react'

export const Kbd = ({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) => <kbd className={`px-1 py-0.5 bg-muted rounded ${className}`}>{children}</kbd>

export const getSessionStatusText = (status: string): string => {
  if (status === 'completed') return 'Continue this conversation with a new message'
  if (status === 'interrupted') return 'Session was interrupted - continue with a new message'
  if (status === 'failed') return 'Session failed - continue with a new message to retry'
  if (status === 'running' || status === 'starting')
    return 'Claude is working - you can interrupt with a new message'
  return 'Session must be completed to continue'
}

export const getInputPlaceholder = (status: string): string => {
  if (status === 'failed') return 'Enter your message to retry from where it failed...'
  if (status === 'running' || status === 'starting') return 'Enter message to interrupt...'
  return 'Enter your message to continue the conversation...'
}

export const getHelpText = (status: string): React.ReactNode => {
  const isMac = navigator.platform.includes('Mac')
  const sendKey = isMac ? '⌘+Enter' : 'Ctrl+Enter'
  const skipKey = isMac ? '⌥+Y' : 'Alt+Y'
  if (status === 'running' || status === 'starting') {
    return (
      <>
        <Kbd>Ctrl+X</Kbd> to interrupt / <Kbd>{sendKey}</Kbd> to interrupt and send /{' '}
        <Kbd>{skipKey}</Kbd> to bypass permissions / <Kbd>⌥A</Kbd> for auto-accept edits
      </>
    )
  }
  return (
    <>
      <Kbd>{sendKey}</Kbd> to send / <Kbd>{skipKey}</Kbd> to bypass permissions / <Kbd>⌥A</Kbd> for
      auto-accept edits
    </>
  )
}

// Add a new function for fork-specific placeholders
export const getForkInputPlaceholder = (status: string): string => {
  if (status === 'failed') {
    return 'Edit this message to fork from selected point...'
  }
  // Fall back to regular placeholder for other statuses
  return getInputPlaceholder(status)
}
