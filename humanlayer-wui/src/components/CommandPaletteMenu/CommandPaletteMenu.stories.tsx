// Storybook configuration for CommandPaletteMenu component
// This file provides different use cases and variations of the CommandPaletteMenu

import CommandPaletteMenu from './CommandPaletteMenu'

// Basic story metadata - compatible with Storybook when it's available
export default {
  title: 'Components/CommandPaletteMenu',
  component: CommandPaletteMenu,
}

// Mock data for stories - available for future use when Storybook is configured
// const mockSessions = [
//   {
//     id: '1',
//     summary: 'Implement authentication system',
//     query: 'Help me implement user authentication with JWT tokens',
//     model: 'claude-3-5-sonnet-20241022',
//     archived: false,
//   },
//   {
//     id: '2',
//     summary: 'Debug React component rendering issues',
//     query: 'My React component is not rendering properly when props change',
//     model: 'claude-3-5-haiku-20241022',
//     archived: false,
//   },
// ]

// Story definitions - will work when Storybook is properly configured
export const CommandMode = {
  name: 'Command Mode',
  // Mock implementations would go here when Storybook is set up
}

export const SearchMode = {
  name: 'Search Mode',
  // Mock implementations would go here when Storybook is set up
}

export const WithFocusedSession = {
  name: 'With Focused Session',
  // Mock implementations would go here when Storybook is set up
}

// Usage examples for development reference:
// - CommandMode: Shows the command palette in command mode with options like "Create Session"
// - SearchMode: Shows the command palette in search mode for finding existing sessions
// - WithFocusedSession: Shows archive/unarchive options when a session is focused
// - BrainrotMode: Easter egg when searching for "brain" in session detail view
