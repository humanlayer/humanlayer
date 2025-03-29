# GenSX Project Claude Memory

<!-- BEGIN_MANAGED_SECTION -->
<!-- WARNING: Everything between BEGIN_MANAGED_SECTION and END_MANAGED_SECTION will be overwritten when updating @gensx/claude-md -->
<!-- Add your custom content outside of this section to preserve it during updates -->

This file serves as persistent memory for Claude when working with GenSX projects.

## Project Commands

### Development

```bash
# Run the workflow after changes
npm run dev

# Build the project
npm run build

# Run the workflow once
npm run start
```

## Code Style Preferences

- Use TypeScript for all new files
- Prefer async/await over promise chains
- Add proper JSDoc comments for all exported functions and types
- Use consistent naming conventions:
  - Components: PascalCase
  - Functions: camelCase
  - Constants: UPPER_SNAKE_CASE
  - Types/Interfaces: PascalCase

## Common Patterns

### Component Definition

```typescript
interface GreetingProps {
  name: string;
  formatOutput?: boolean;
}

const Greeting = gensx.Component<GreetingProps, string>(
  "Greeting",
  async ({ name, formatOutput = false }) => {
    const greeting = `Hello, ${name}!`;
    return formatOutput ? `## ${greeting}` : greeting;
  },
);
```

### Provider Usage

```typescript
const MyWorkflow = gensx.Component(
  "MyWorkflow",
  () => (
    <OpenAIProvider apiKey={process.env.OPENAI_API_KEY}>
      <ChatCompletion
        model="gpt-4o-mini"
        messages={[
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Tell me about GenSX." }
        ]}
      />
    </OpenAIProvider>
  )
);
```

### Component Nesting with Child Functions

```typescript
const ParentComponent = gensx.Component(
  "ParentComponent",
  () => (
    <ChildComponent input="data">
      {(childOutput) => `Result: ${childOutput}`}
    </ChildComponent>
  )
);
```

## LLM Provider Configuration

### OpenAI

```typescript
<OpenAIProvider
  apiKey={process.env.OPENAI_API_KEY}
  defaultOptions={{ temperature: 0.7 }}
/>
```

### Anthropic

```typescript
<AnthropicProvider
  apiKey={process.env.ANTHROPIC_API_KEY}
  defaultOptions={{ temperature: 0.7 }}
/>
```

### Model Control Protocol (MCP)

```typescript
const { Provider: MCPProvider } = createMCPServerContext({
  serverCommand: "npx",
  serverArgs: ["-y", "@mcp-server/package"],
});
```

<!-- END_MANAGED_SECTION -->

## Custom Project Information

Add your custom project information here. This section will not be overwritten during updates.
