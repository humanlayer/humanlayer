# HumanLayer Next.js Chat Example

This example shows how to use HumanLayer with the Vercel AI SDK in a Next.js application to create a chat interface with human oversight.

## Features

- Real-time streaming responses
- Human approval for sensitive operations
- Support team consultation
- Subscription management
- Credit issuance

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.local.example .env.local
```

Then edit `.env.local` with your API keys:

- `OPENAI_API_KEY`: Your OpenAI API key
- `HUMANLAYER_API_KEY`: Your HumanLayer API key

3. Run the development server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## How It Works

- The chat interface uses the Vercel AI SDK's `useChat` hook for streaming responses
- Sensitive operations (subscription updates, credit issuance) require human approval
- Support team can be consulted through the `askSupport` tool
- All human interactions are managed through HumanLayer's contact channels

## Learn More

- [HumanLayer Documentation](https://docs.humanlayer.dev)
- [Vercel AI SDK Documentation](https://sdk.vercel.ai/docs)
