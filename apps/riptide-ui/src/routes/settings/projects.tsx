import { createFileRoute } from '@tanstack/react-router'

import { ProjectSettingsPage } from '@/components/projects/ProjectSettingsPage'

export const Route = createFileRoute('/settings/projects')({ component: ProjectSettingsPage })
