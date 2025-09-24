import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Pencil, Check, X } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { useStore } from '@/AppStore'
import { daemonClient } from '@/lib/daemon/client'
import { useStealHotkeyScope } from '@/hooks/useStealHotkeyScope'
import { ViewMode } from '@/lib/daemon/types'

// Create a dedicated scope for title editing
const TitleEditingHotkeysScope = 'titleEditing'

export function Breadcrumbs() {
  const location = useLocation()
  const navigate = useNavigate()
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const pathSegments = location.pathname.split('/').filter(Boolean)
  const isHome = pathSegments.length === 0
  const isSessionDetail = pathSegments[0] === 'sessions' && pathSegments[1]
  const sessionId = isSessionDetail ? pathSegments[1] : null

  // Get session, viewMode, and editing state from store
  const session = useStore(state => (sessionId ? state.sessions.find(s => s.id === sessionId) : null))
  const viewMode = useStore(state => state.viewMode)
  const isEditingTitle = useStore(state => state.isEditingSessionTitle)
  const setIsEditingTitle = useStore(state => state.setIsEditingSessionTitle)

  // Steal all hotkey scopes when editing
  useStealHotkeyScope(TitleEditingHotkeysScope, isEditingTitle)

  // Add escape handler with the dedicated scope
  useHotkeys(
    'escape',
    e => {
      e.preventDefault()
      setEditValue(session?.title || session?.summary || '')
      setIsEditingTitle(false)
      inputRef.current?.blur()
    },
    {
      scopes: [TitleEditingHotkeysScope],
      enableOnFormTags: true,
      preventDefault: true,
    },
    [isEditingTitle, session],
  )

  const startEdit = () => {
    if (session) {
      setEditValue(session.title || session.summary || '')
      setIsEditingTitle(true)
    }
  }

  const saveEdit = async () => {
    if (!session || !editValue.trim()) return

    try {
      await daemonClient.updateSessionTitle(session.id, editValue)
      useStore.getState().updateSession(session.id, { title: editValue })
      setIsEditingTitle(false)
    } catch {
      toast.error('Failed to update session title')
    }
  }

  const cancelEdit = () => {
    setIsEditingTitle(false)
    setEditValue('')
  }

  // Watch for external triggers to start editing
  useEffect(() => {
    if (isEditingTitle && session && !editValue) {
      setEditValue(session.title || session.summary || '')
    }
  }, [isEditingTitle, session])

  // Determine breadcrumb text based on view mode
  const breadcrumbText = viewMode === ViewMode.Archived ? 'Archived Sessions' : 'Sessions'

  return (
    <Breadcrumb className="mb-4 font-mono text-sm tracking-wider">
      <BreadcrumbList>
        <BreadcrumbItem>
          {isHome ? (
            <BreadcrumbPage className="flex items-center gap-1">
              <Home className="w-4 h-4" />
              {breadcrumbText}
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              onClick={() => navigate('/')}
              className="flex items-center gap-1 cursor-pointer"
            >
              <Home className="w-4 h-4" />
              {breadcrumbText}
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {isSessionDetail && session && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {isEditingTitle ? (
                <div className="flex items-center gap-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveEdit()
                      }
                    }}
                    className="px-1 py-0.5 text-sm bg-background border rounded font-mono"
                    style={{
                      width: `${Math.max(20, editValue.length) * 0.7}em`,
                      minWidth: '20em',
                      maxWidth: '80em',
                    }}
                    autoFocus
                  />
                  <button onClick={saveEdit} className="p-0.5 hover:opacity-80">
                    <Check className="h-3 w-3" />
                  </button>
                  <button onClick={cancelEdit} className="p-0.5 hover:opacity-80">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <BreadcrumbPage className="flex items-center gap-1">
                  <span>{session.title || session.summary || `Session ${sessionId?.slice(0, 8)}`}</span>
                  <button
                    onClick={startEdit}
                    className="p-0.5 opacity-50 hover:opacity-100 transition-opacity"
                    aria-label="Edit session title"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
