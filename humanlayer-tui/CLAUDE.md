# CLAUDE.md - HumanLayer TUI

## IMPORTANT: This project is archived

The HumanLayer TUI (Terminal User Interface) is **archived** and no longer actively developed.

### Key Points:
- **No new features** will be added to the TUI
- **No modifications** should be made unless fixing critical bugs
- **Reference only**: The code can be used as reference when implementing features in other components
- **Focus on WUI**: All new UI features should be implemented in the WUI (Web UI) instead

### What This Means for Development:
- When implementing new JSON-RPC endpoints or features, **do not update the TUI**
- When creating implementation plans, **exclude TUI from the scope**
- If you need to understand how something works, you may reference TUI code
- The TUI binary is still built and distributed, but only for legacy support

### Why Archived:
The team has decided to focus development efforts on the WUI (Web UI) which provides a richer user experience and is easier to maintain and extend.

### Current State:
- The TUI remains functional with existing features
- It connects to the hld daemon via JSON-RPC
- Provides session management and approval handling
- Built with Go and Bubble Tea framework

If you have questions about this decision, please consult with the team.
