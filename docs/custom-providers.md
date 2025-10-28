# Custom AI Provider Support

HumanLayer now supports using custom AI providers beyond the built-in Anthropic, OpenRouter, and Baseten integrations.

## Using Custom Providers

The `AIProvider` type accepts any string, allowing you to specify custom provider names:

```typescript
await client.launchSession({
  query: "Hello world",
  provider: "my-custom-provider", // TypeScript accepts any string
  model: "my-model",
  // Configure proxy settings for custom providers
  proxyEnabled: true,
  proxyBaseUrl: "https://api.my-provider.com/v1",
  proxyApiKey: process.env.MY_PROVIDER_API_KEY,
  proxyModelOverride: "my-model"
});
```

## Built-in Provider Support

Built-in providers have automatic configuration:

- **anthropic**: Direct Anthropic API integration with model enum mapping
- **openrouter**: Proxy configuration to OpenRouter API
- **baseten**: Proxy configuration to Baseten API

## Custom Provider Configuration

For custom providers, you need to provide proxy configuration:

### Required Proxy Settings

- `proxyEnabled`: Set to `true` to enable proxy mode
- `proxyBaseUrl`: The base URL of your AI provider's API
- `proxyApiKey`: API key for authentication (typically from environment variable)
- `proxyModelOverride`: The model identifier for your provider

### Example: Using Groq

```typescript
await client.launchSession({
  query: "Explain recursion",
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  proxyEnabled: true,
  proxyBaseUrl: "https://api.groq.com/openai/v1",
  proxyApiKey: process.env.GROQ_API_KEY,
  proxyModelOverride: "llama-3.3-70b-versatile"
});
```

### Example: Using Azure OpenAI

```typescript
await client.launchSession({
  query: "Write a function",
  provider: "azure-openai",
  model: "gpt-4",
  proxyEnabled: true,
  proxyBaseUrl: process.env.AZURE_OPENAI_ENDPOINT + "/openai/deployments",
  proxyApiKey: process.env.AZURE_OPENAI_KEY,
  proxyModelOverride: "gpt-4"
});
```

## Type Safety

The `AIProvider` type provides autocomplete for known providers while accepting any string:

```typescript
type KnownAIProvider = 'anthropic' | 'openrouter' | 'baseten'
type AIProvider = KnownAIProvider | (string & {})
```

This pattern ensures:
- TypeScript autocomplete for built-in providers
- Full flexibility to use any custom provider string
- No breaking changes when new providers are added

## Session Update Support

You can also update a session's provider configuration:

```typescript
await client.updateSession(sessionId, {
  proxyEnabled: true,
  proxyBaseUrl: "https://api.new-provider.com/v1",
  proxyModelOverride: "new-model",
  proxyApiKey: process.env.NEW_PROVIDER_KEY
});
```

## UI Considerations

The built-in Web UI model selector is designed for the three known providers (Anthropic, OpenRouter, Baseten). Custom providers work through:

- **API/SDK**: Use `launchSession()` with custom provider strings
- **Configuration Files**: Define custom providers in config files
- **Command Line**: Pass custom provider via CLI arguments

The Web UI will display custom providers in session details but won't provide a specialized configuration interface for them.

## Best Practices

1. **Environment Variables**: Store API keys in environment variables, never in code
2. **Proxy Base URLs**: Ensure the URL matches your provider's OpenAI-compatible endpoint
3. **Model Names**: Use the exact model identifier required by your provider
4. **Error Handling**: Implement fallback logic for provider failures
5. **Testing**: Test custom provider integration before production use
6. **OpenAI Compatibility**: Custom providers should expose an OpenAI-compatible API endpoint
