import { createHashRouter } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { SessionTablePage } from '@/pages/SessionTablePage'
import { SessionDetailPage } from '@/pages/SessionDetailPage'
import { DraftSessionPage } from '@/pages/DraftSessionPage'
import { QuickLauncher } from '@/components/QuickLauncher'
import StoreDemo from '@/pages/StoreDemo'
import WuiDemo from '@/pages/WuiDemo'
import StackedCardsDemo from '@/pages/StackedCardsDemo'
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary'

export const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <SessionTablePage />,
      },
      {
        path: 'sessions/draft',
        element: <DraftSessionPage />,
      },
      {
        path: 'sessions/:sessionId',
        element: <SessionDetailPage />,
      },
    ],
  },
  {
    path: '/_store_demo',
    element: <StoreDemo />,
  },
  {
    path: '/_wui_demo',
    element: <WuiDemo />,
  },
  {
    path: '/demo/stacked_cards',
    element: <StackedCardsDemo />,
  },
  {
    path: '/quick-launcher',
    element: <QuickLauncher />,
  },
])
