import React from 'react'

const Kbd = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <kbd className={`px-1 py-0.5 bg-muted rounded ${className}`}>{children}</kbd>
)

export const getSessionStatusText = (status: string): string => {
  if (status === 'completed') return 'Continue this conversation with a new message'
  if (status === 'interrupted') return 'Session was interrupted - continue with a new message'
  if (status === 'running' || status === 'starting')
    return 'Claude is working - you can interrupt with a new message'
  return 'Session must be completed to continue'
}

export const getInputPlaceholder = (status: string): string => {
  if (status === 'failed') return 'Session failed - cannot continue...'
  if (status === 'running' || status === 'starting') return 'Enter message to interrupt...'
  return 'Enter your message to continue the conversation...'
}

export const getHelpText = (status: string): React.ReactNode => {
  if (status === 'failed') return 'Session failed - cannot continue'
  const sendKey = navigator.platform.includes('Mac') ? '⌘+Enter' : 'Ctrl+Enter'
  if (status === 'running' || status === 'starting') {
    return (
      <>
        <Kbd>{sendKey}</Kbd> to interrupt and send
      </>
    )
  }
  return (
    <>
      <Kbd>{sendKey}</Kbd> to send
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
