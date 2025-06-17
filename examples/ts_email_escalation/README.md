# TypeScript Email Escalation Example

This example demonstrates HumanLayer's email escalation functionality using TypeScript.

## What This Example Shows

The example demonstrates a two-stage email escalation workflow:

1. **Initial Function Call**: Creates a function call that requires approval, sent to the first email contact
2. **First Escalation**: After 5 seconds, adds an additional recipient to the existing email thread
3. **Second Escalation**: After another 5 seconds, escalates to a completely different email contact (channel switching)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment file and configure:

   ```bash
   cp dotenv.example .env
   ```

3. Fill in your `.env` file:
   ```
   HUMANLAYER_API_KEY=your_api_key_here
   HL_EXAMPLE_CONTACT_EMAIL=first@example.com
   HL_EXAMPLE_SECOND_CONTACT_EMAIL=second@example.com
   HL_EXAMPLE_THIRD_CONTACT_EMAIL=management@example.com
   ```

## Running the Example

```bash
npm run start
```

## How It Works

The example uses HumanLayer's `escalateEmailFunctionCall()` method with two different escalation patterns:

### Adding Recipients

```typescript
await hl.escalateEmailFunctionCall(call.call_id, {
  escalation_msg: "please take a look because it's been too long",
  additional_recipients: [
    {
      address: process.env.HL_EXAMPLE_SECOND_CONTACT_EMAIL,
      field: "to",
    },
  ],
});
```

### Channel Switching

```typescript
await hl.escalateEmailFunctionCall(call.call_id, {
  escalation_msg: "URGENT: Still no response - escalating to management",
  channel: {
    email: {
      address: process.env.HL_EXAMPLE_THIRD_CONTACT_EMAIL,
    },
  },
});
```

## Expected Output

You should see console output showing the escalation progression and receive three separate emails demonstrating the escalation workflow.
