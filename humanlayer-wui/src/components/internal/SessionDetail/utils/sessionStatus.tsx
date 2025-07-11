import React from 'react'

const Kbd = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <kbd className={`px-1 py-0.5 bg-muted rounded ${className}`}>{children}</kbd>
)

export const getSessionStatusText = (status: string): string => {
  if (status === 'completed') return 'Continue this conversation with a new message'
  if (status === 'running' || status === 'starting')
    return 'Claude is working - you can interrupt with a new message'
  return 'Session must be completed to continue'
}

export const getSessionButtonText = (status: string, archived?: boolean): React.ReactNode => {
  if (status === 'running' || status === 'starting')
    return (
      <>
        Interrupt & Reply <Kbd className="ml-2 text-xs">R</Kbd>
      </>
    )
  if (status === 'completed')
    return (
      <>
        {archived ? 'Send & Unarchive' : 'Continue Session'} <Kbd className="ml-2 text-xs">R</Kbd>
      </>
    )
  return 'Not Available'
}

export const getInputPlaceholder = (status: string): string => {
  if (status === 'failed') return 'Session failed - cannot continue...'
  if (status === 'running' || status === 'starting') return 'Enter message to interrupt...'
  return 'Enter your message to continue the conversation...'
}

export const getHelpText = (status: string): React.ReactNode => {
  if (status === 'failed') return 'Session failed - cannot continue'
  if (status === 'running' || status === 'starting') {
    return (
      <>
        <Kbd>Enter</Kbd> to interrupt and send, <Kbd className="ml-1">Escape</Kbd> to cancel
      </>
    )
  }
  return (
    <>
      <Kbd>Enter</Kbd> to send, <Kbd className="ml-1">Escape</Kbd> to cancel
    </>
  )
}
