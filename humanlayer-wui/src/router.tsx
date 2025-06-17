import { createHashRouter } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { SessionTablePage } from '@/pages/SessionTablePage'
import { SessionDetailPage } from '@/pages/SessionDetailPage'

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
])
