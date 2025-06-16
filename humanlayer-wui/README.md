# humanlayer-wui

Web/desktop UI for the HumanLayer daemon (`hld`) built with Tauri and React.

## Development

```bash
# Install dependencies
bun install

# Start dev server
bun run tauri dev

# Build for production
bun run build
```

## Quick Start for Frontend Development

Always use React hooks, never the daemon client directly:

```tsx
import { useApprovals } from '@/hooks'

function MyComponent() {
  const { approvals, loading, error, approve } = useApprovals()
  // ... render UI
}
```

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md) - System design and data flow
- [Developer Guide](docs/DEVELOPER_GUIDE.md) - Best practices and examples
- [API Reference](docs/API.md) - Hook and type documentation

## Status

⚠️ Experimental - APIs may change
