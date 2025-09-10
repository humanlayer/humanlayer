import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Pencil, Check, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
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

export function Breadcrumbs() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editValue, setEditValue] = useState('')

  const pathSegments = location.pathname.split('/').filter(Boolean)
  const isHome = pathSegments.length === 0
  const isSessionDetail = pathSegments[0] === 'sessions' && pathSegments[1]
  const sessionId = isSessionDetail ? pathSegments[1] : null

  // Get session from store
  const session = useStore(state => (sessionId ? state.sessions.find(s => s.id === sessionId) : null))

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

  return (
    <Breadcrumb className="mb-4 font-mono text-sm uppercase tracking-wider">
      <BreadcrumbList>
        <BreadcrumbItem>
          {isHome ? (
            <BreadcrumbPage className="flex items-center gap-1">
              <Home className="w-4 h-4" />
              Sessions
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              onClick={() => navigate('/')}
              className="flex items-center gap-1 cursor-pointer"
            >
              <Home className="w-4 h-4" />
              Sessions
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
                    type="text"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveEdit()
                      if (e.key === 'Escape') cancelEdit()
                    }}
                    className="px-1 py-0.5 text-sm bg-background border rounded font-mono uppercase tracking-wider"
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
