import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import SessionTable from '@/components/internal/SessionTable'
import { Session } from '@/lib/daemon/types'
import { ThemeSelector } from '@/components/ThemeSelector'
// import { SessionLauncher } from '@/components/SessionLauncher' // Removed - using drafts now
import { DemoStoreProvider, useDemoStore } from '@/stores/demo/providers/DemoStoreProvider'
import { logger } from '@/lib/logging'
import {
  launcherWorkflowSequence,
  statusChangesSequence,
  themeShowcaseSequence,
} from '@/stores/demo/animations/sequences'

// Session table component wrapper using new composed store
function SessionTableWrapper() {
  const sessions = useDemoStore(state => state.sessions)
  const focusedSession = useDemoStore(state => state.focusedSession)
  const setFocusedSession = useDemoStore(state => state.setFocusedSession)
  const focusNextSession = useDemoStore(state => state.focusNextSession)
  const focusPreviousSession = useDemoStore(state => state.focusPreviousSession)

  const handleActivateSession = (session: Session) => {
    logger.log('Activating session:', session.id)
    // In demo mode, this would navigate to session detail
  }

  return (
    <div className="space-y-4">
      <div className="max-h-96 overflow-y-auto">
        <SessionTable
          sessions={sessions}
          handleFocusSession={setFocusedSession}
          handleBlurSession={() => setFocusedSession(null)}
          handleActivateSession={handleActivateSession}
          focusedSession={focusedSession}
          handleFocusNextSession={focusNextSession}
          handleFocusPreviousSession={focusPreviousSession}
          searchText={undefined}
          matchedSessions={undefined}
        />
      </div>
    </div>
  )
}


// Complete app wrapper with session table and launcher
function DemoAppWrapper({ label, variant }: { label: string; variant: 'default' | 'secondary' }) {
  return (
    <div className="space-y-2">
      <Badge variant={variant} className="text-sm">
        {label}
      </Badge>
      <Card className="w-full">
        <CardContent className="p-4">
          <SessionTableWrapper />
        </CardContent>
      </Card>
      {/* LauncherWrapper removed - using draft sessions now */}
    </div>
  )
}

// Main demo page
export default function WuiDemo() {
  const [sequenceType, setSequenceType] = useState<'launcher' | 'status' | 'themes'>('launcher')

  const sequence =
    sequenceType === 'launcher'
      ? launcherWorkflowSequence
      : sequenceType === 'status'
        ? statusChangesSequence
        : themeShowcaseSequence

  return (
    <div className="container mx-auto p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">WUI Session Table Demo</h1>
          <p className="text-muted-foreground">
            Session table component connected to demo store for synthetic product shots
          </p>
        </div>

        <div className="flex justify-center items-center gap-4">
          <Button
            onClick={() => setSequenceType('launcher')}
            variant={sequenceType === 'launcher' ? 'default' : 'outline'}
            size="sm"
          >
            Launcher Workflow
          </Button>
          <Button
            onClick={() => setSequenceType('status')}
            variant={sequenceType === 'status' ? 'default' : 'outline'}
            size="sm"
          >
            Status Changes
          </Button>
          <Button
            onClick={() => setSequenceType('themes')}
            variant={sequenceType === 'themes' ? 'default' : 'outline'}
            size="sm"
          >
            Theme Showcase
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Theme:</span>
            <ThemeSelector />
          </div>
        </div>

        <div className="flex justify-center">
          <div className="w-full max-w-4xl">
            <DemoStoreProvider sequence={sequence} key={sequenceType}>
              <DemoAppWrapper label="Complete WUI Demo with Launcher" variant="secondary" />
            </DemoStoreProvider>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Animation Sequence</CardTitle>
            <CardDescription>
              Current sequence:{' '}
              {sequenceType === 'launcher'
                ? 'Complete launcher workflow with session creation'
                : sequenceType === 'status'
                  ? 'Session status transitions'
                  : 'Theme switching demonstration'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
              {JSON.stringify(sequence, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Demo Features</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-1">Session Table Integration:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Full session table display</li>
                <li>Real-time status updates and animations</li>
                <li>Keyboard navigation and focus management</li>
                <li>Responsive design for different screen sizes</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-1">Demo Store Features:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Automated session loading and status transitions</li>
                <li>Configurable animation sequences via JSON</li>
                <li>Theme switching for different visual presentations</li>
                <li>Perfect for product demos and screenshots</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
