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
import { HotkeyScopeBoundary } from './HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { ViewMode } from '@/lib/daemon/types'

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
  const activeSessionDetail = useStore(state => state.activeSessionDetail)
  const getViewMode = useStore(state => state.getViewMode)
  const isEditingTitle = useStore(state => state.isEditingSessionTitle)
  const setIsEditingTitle = useStore(state => state.setIsEditingSessionTitle)

  const viewMode = getViewMode()

  // Add escape handler with the dedicated scope
  useHotkeys(
    'escape',
    e => {
      e.preventDefault()
      setEditValue(activeSessionDetail?.session?.title || activeSessionDetail?.session?.summary || '')
      setIsEditingTitle(false)
      inputRef.current?.blur()
    },
    {
      scopes: [HOTKEY_SCOPES.TITLE_EDITING],
      enableOnFormTags: true,
      preventDefault: true,
    },
    [isEditingTitle, activeSessionDetail?.session],
  )

  const startEdit = () => {
    if (activeSessionDetail?.session) {
      // Don't allow editing via breadcrumb if session is a draft
      if (activeSessionDetail.session.status === 'draft') {
        return
      }
      setEditValue(activeSessionDetail.session.title || activeSessionDetail.session.summary || '')
      setIsEditingTitle(true)
    }
  }

  const saveEdit = async () => {
    if (!activeSessionDetail?.session || !editValue.trim()) return

    try {
      await daemonClient.updateSessionTitle(activeSessionDetail.session.id, editValue)
      useStore.getState().updateSession(activeSessionDetail.session.id, { title: editValue })
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
    if (isEditingTitle && activeSessionDetail?.session) {
      setEditValue(activeSessionDetail.session.title || activeSessionDetail.session.summary || '')
    }
  }, [isEditingTitle, activeSessionDetail?.session])

  const viewModeToBreadcrumbText = {
    [ViewMode.Normal]: 'sessions',
    [ViewMode.Archived]: 'archived',
    [ViewMode.Drafts]: 'drafts',
  }

  const breadcrumbText = viewModeToBreadcrumbText[viewMode]

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

        {isSessionDetail && activeSessionDetail && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <HotkeyScopeBoundary
                scope={HOTKEY_SCOPES.TITLE_EDITING}
                isActive={isEditingTitle}
                rootScopeDisabled={true}
                componentName="Breadcrumbs-TitleEditing"
              >
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
                      className="px-1 py-0.5 text-sm bg-background border rounded font-mono focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
                      style={{
                        width: `${Math.max(20, editValue.length) * 0.7}em`,
                        minWidth: '20em',
                        maxWidth: '80em',
                      }}
                      autoFocus
                    />
                    <button
                      onClick={saveEdit}
                      className="p-0.5 hover:opacity-80 focus-visible:ring-ring/50 focus-visible:ring-[2px] focus-visible:outline-none rounded"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="p-0.5 hover:opacity-80 focus-visible:ring-ring/50 focus-visible:ring-[2px] focus-visible:outline-none rounded"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <BreadcrumbPage className="flex items-center gap-1">
                    <span>
                      {activeSessionDetail.session.title ||
                        activeSessionDetail.session.summary ||
                        `session ${sessionId?.slice(0, 8)}`}
                    </span>
                    {/* Don't show edit button for draft sessions */}
                    {activeSessionDetail.session.status !== 'draft' && (
                      <button
                        onClick={startEdit}
                        className="p-0.5 opacity-50 hover:opacity-100 transition-opacity focus-visible:ring-ring/50 focus-visible:ring-[2px] focus-visible:outline-none rounded"
                        aria-label="Edit session title"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </BreadcrumbPage>
                )}
              </HotkeyScopeBoundary>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
