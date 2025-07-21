import { useNavigate } from 'react-router-dom'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { useRegisteredHotkey } from '@/hooks/useRegisteredHotkey'

export function useGlobalHotkeys() {
  const { isOpen, open, close, createNewSession } = useSessionLauncher()
  const navigate = useNavigate()

  // Cmd+K - Command palette (works everywhere including inputs)
  useRegisteredHotkey(
    'COMMAND_PALETTE',
    (e) => {
      e.preventDefault()
      if (isOpen) {
        close()
      } else {
        open('command')
      }
    },
    {
      enableOnFormTags: true,
      enableOnContentEditable: true,
    }
  )

  // C - Create new session
  useRegisteredHotkey(
    'CREATE_SESSION',
    (e) => {
      e.preventDefault()
      if (!isOpen) {
        open('command')
      }
      createNewSession()
    }
  )

  // / - Search
  useRegisteredHotkey(
    'SEARCH',
    (e) => {
      e.preventDefault()
      open('search')
    }
  )

  // G+A - Go to approvals
  useRegisteredHotkey(
    'NAVIGATE_APPROVALS',
    (e) => {
      e.preventDefault()
      // TODO: Navigate to approvals view
      console.log('Navigate to approvals')
    }
  )

  // G+S - Go to sessions
  useRegisteredHotkey(
    'NAVIGATE_SESSIONS',
    (e) => {
      e.preventDefault()
      navigate('/')
    }
  )
}