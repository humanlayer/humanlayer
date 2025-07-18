import { createHashRouter } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { SessionTablePage } from '@/pages/SessionTablePage'
import { SessionDetailPage } from '@/pages/SessionDetailPage'
import StoreDemo from '@/pages/StoreDemo'
import WuiDemo from '@/pages/WuiDemo'

export const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <SessionTablePage />,
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
])
