import { useLocation, useNavigate } from 'react-router-dom'
import { Home } from 'lucide-react'
import { useStore } from '@/App'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

export function Breadcrumbs() {
  const location = useLocation()
  const navigate = useNavigate()
  const sessions = useStore(state => state.sessions)

  const pathSegments = location.pathname.split('/').filter(Boolean)
  const isHome = pathSegments.length === 0
  const isSessionDetail = pathSegments[0] === 'sessions' && pathSegments[1]

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

        {isSessionDetail && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {(() => {
                  const sessionId = pathSegments[1]
                  const session = sessions.find(s => s.id === sessionId)
                  return session?.query || `Session ${sessionId.slice(0, 8)}`
                })()}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
