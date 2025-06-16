# Developer Guide

## For Frontend Developers

This guide helps you build UI components that interact with the HumanLayer daemon.

### ✅ DO

#### Use Hooks for Everything

```tsx
import { useApprovals, useSessions } from '@/hooks'

function MyComponent() {
  const { approvals, loading, error, approve, deny } = useApprovals()
  const { sessions, launchSession } = useSessions()

  // Hooks handle all the complexity
}
```

#### Use UI Types for Props

```tsx
import { UnifiedApprovalRequest } from '@/types/ui'

interface Props {
  approval: UnifiedApprovalRequest // ✅ UI type
}
```

#### Import Enums When Needed

```tsx
import { ApprovalType, SessionStatus } from '@/lib/daemon/types'

if (approval.type === ApprovalType.FunctionCall) {
  // This is fine - enums are meant to be used
}
```

### ❌ DON'T

#### Don't Use the Daemon Client Directly

```tsx
// ❌ WRONG - Never do this in components
import { daemonClient } from '@/lib/daemon'
const approvals = await daemonClient.fetchApprovals()

// ✅ CORRECT - Use hooks instead
const { approvals } = useApprovals()
```

#### Don't Use Raw Protocol Types in Components

```tsx
// ❌ WRONG - FunctionCall is a protocol type
import { FunctionCall } from '@/lib/daemon/types'
interface Props {
  approval: FunctionCall
}

// ✅ CORRECT - Use UI types
import { UnifiedApprovalRequest } from '@/types/ui'
interface Props {
  approval: UnifiedApprovalRequest
}
```

## Common Patterns

### Handling Approvals

```tsx
function ApprovalCard({ approval }: { approval: UnifiedApprovalRequest }) {
  const { approve, deny, respond } = useApprovals()
  const [isProcessing, setIsProcessing] = useState(false)

  const handleApprove = async () => {
    setIsProcessing(true)
    try {
      await approve(approval.callId)
      toast.success('Approved!')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Card>
      <h3>{approval.title}</h3>
      <p>{approval.sessionQuery}</p>
      <Button onClick={handleApprove} disabled={isProcessing}>
        Approve
      </Button>
    </Card>
  )
}
```

### Launching Sessions

```tsx
function LaunchButton() {
  const { launchSession } = useSessions()
  const [query, setQuery] = useState('')

  const handleLaunch = async () => {
    try {
      const { sessionId } = await launchSession({
        query,
        model: 'sonnet',
        working_dir: '/path/to/project',
      })
      navigate(`/sessions/${sessionId}`)
    } catch (error) {
      alert(error.message)
    }
  }

  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <button onClick={handleLaunch}>Launch</button>
    </>
  )
}
```

### Real-time Updates

```tsx
function LiveApprovals() {
  // This hook automatically polls for updates
  const { approvals } = useApprovalsWithSubscription()

  return (
    <div>
      {approvals.map(approval => (
        <ApprovalCard key={approval.id} approval={approval} />
      ))}
    </div>
  )
}
```

## Understanding the Layers

### 1. Components (Your Code)

- Import hooks and UI types
- Handle user interactions
- Render UI

### 2. Hooks (React Layer)

- Manage state with useState
- Handle loading/error states
- Enrich data (join approvals + sessions)
- Format errors for display

### 3. Daemon Client (Protocol Layer)

- Type-safe Tauri invocations
- 1:1 mapping to Rust API
- No business logic

### 4. Rust/Daemon

- Handles actual daemon communication
- Manages Unix socket connection
- Protocol implementation

## Tips

- **Loading States**: All hooks provide `loading` - use it!
- **Error Handling**: Hooks format errors, just display `error` string
- **Refreshing**: Actions like `approve()` auto-refresh the list
- **Polling**: `useApprovalsWithSubscription` polls every 5 seconds
- **Types**: When in doubt, check what the hook returns

## Need Help?

- Check the [API Reference](API.md) for all available hooks
- Look at existing components for examples
- The TypeScript compiler will guide you - trust the types!
