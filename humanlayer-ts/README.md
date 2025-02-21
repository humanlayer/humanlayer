# HumanLayer TypeScript SDK

The official TypeScript SDK for [HumanLayer](https://humanlayer.dev), providing human oversight for AI applications.

## Installation

```bash
npm install humanlayer
```

## Key Features

- Human approval workflows for sensitive operations
- Structured feedback collection from humans
- Multiple contact channels (Slack, Email, etc.)
- Full TypeScript support
- Async/await API
- Framework integrations

## Basic Usage

```typescript
import { humanlayer } from 'humanlayer'

const hl = humanlayer({
  runId: 'my-agent',
  contactChannel: {
    slack: {
      channelOrUserId: 'C123456',
      contextAboutChannelOrUser: 'the compliance team',
    },
  },
})

// Require approval for sensitive functions
const sendEmail = hl.requireApproval(async (to: string, subject: string) => {
  // Email sending logic here
})

// Get human input during execution
const support = hl.humanAsTool({
  responseOptions: [
    { name: 'approve', title: 'Approve' },
    { name: 'deny', title: 'Deny' },
  ],
})
```

## Framework Support

- OpenAI function calling
- LangChain.js
- Vercel AI SDK

## Contact Channels

Configure how humans are contacted:

```typescript
// Slack
const slackChannel = {
  slack: {
    channelOrUserId: 'C123456',
    contextAboutChannelOrUser: 'the support team',
  },
}

// Email
const emailChannel = {
  email: {
    address: 'support@company.com',
    contextAboutUser: 'the support team',
  },
}
```

## Response Options

Structure human responses:

```typescript
const options = [
  {
    name: 'approve',
    title: 'Approve',
    description: 'Approve the action',
  },
  {
    name: 'deny',
    title: 'Deny',
    description: 'Deny with feedback',
    promptFill: 'Denied because...',
  },
]

const approval = await hl.requireApproval(myFunction, {
  responseOptions: options,
})
```

## Error Handling

The SDK provides detailed error types:

```typescript
try {
  await hl.requireApproval(myFunction)()
} catch (error) {
  if (error instanceof HumanLayerException) {
    // Handle HumanLayer-specific errors
    console.error('HumanLayer error:', error.message)
  } else {
    // Handle other errors
    console.error('Unexpected error:', error)
  }
}
```

## Environment Variables

Required:

- `HUMANLAYER_API_KEY`: Your HumanLayer API key

Optional:

- `HUMANLAYER_API_BASE`: API base URL (default: https://api.humanlayer.dev/humanlayer/v1)
- `HUMANLAYER_HTTP_TIMEOUT_SECONDS`: HTTP timeout in seconds (default: 30)

## Examples

See the [examples directory](https://github.com/humanlayer/humanlayer/tree/main/examples#typescript-examples) for complete working examples:

- [OpenAI function calling](https://github.com/humanlayer/humanlayer/tree/main/examples/ts_openai_client)
- [Email classification](https://github.com/humanlayer/humanlayer/tree/main/examples/ts_email_classifier)
- [Vercel AI SDK integration](https://github.com/humanlayer/humanlayer/tree/main/examples/ts_vercel_ai_sdk)

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type check
npm run check
```

## License

Apache 2.0 - see [LICENSE](../LICENSE)
