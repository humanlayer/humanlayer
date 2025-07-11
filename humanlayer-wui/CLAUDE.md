This is the HumanLayer Web UI (WUI) - a desktop application for managing AI agent approvals and sessions.

The WUI connects to the HumanLayer daemon (hld) to provide a graphical interface for monitoring Claude Code sessions and responding to approval requests. It's built with Tauri for desktop packaging and React for the interface.

When the WUI is running, logs are written to ~/.humanlayer/logs/wui-TIMESTAMP.log for debugging purposes. The application hot-reloads automatically when you make changes to the code - you cannot manually restart it.

The WUI communicates with the daemon via JSON-RPC over a Unix socket at ~/.humanlayer/daemon.sock. All session and approval data comes from the daemon - the WUI is purely a presentation layer.

For UI development, we use Radix UI components styled with Tailwind CSS. State management is handled by Zustand. The codebase follows React best practices with TypeScript for type safety.

## Tips and Tricks

- DO prefer ShadCN components over custom components. If a ShadCN equivalent exists that we haven't added yet, go ahead and add it. (e.g. `bunx --bun shadcn@latest add accordion`)
- DO prefer `tailwind`-based styling over other types of styling
- DO use `zustand` for managing global state. In a number of cases we've used internal React state management, but as the application scales we'll want to push more of that state into `zustand`.
- DO verify your changes with `bun run lint` and `bun run typecheck`.
- DO provide a manual list of steps for a human to test new UI changes.
