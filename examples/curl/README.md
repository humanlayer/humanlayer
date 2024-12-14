# Human Layer Curl Example

This example demonstrates how to use Human Layer's API with simple curl commands to create and check function call approvals.

## Prerequisites

- `curl`
- `jq` (for JSON parsing)
- Valid `HUMANLAYER_API_KEY` environment variable set with your API key from Human Layer

## Basics

to create an approval request, run a curl like:

```bash
curl -X POST https://api.humanlayer.dev/humanlayer/v1/function_calls \
-H "Authorization: Bearer ${HUMANLAYER_API_KEY}" \
-H "Content-Type: application/json" \
-d '{
  "run_id": "curl-example",
  "call_id": "1234-5678-...",
  "spec": {
    "fn": "send_email",
    "kwargs": {
      "to": "user@example.com",
      "subject": "Hello",
      "body": "This is a test email"
    }
  }
}'
```

## Usage w/ Makefile

### 1. Create an Approval Request

Create a new function call approval request:

```bash
export HUMANLAYER_API_KEY=<your-api-key>
make create-approval
```

This will create a new approval request with a randomly generated UUID. The output will look like:

```json
{
  "run_id": "curl-example",
  "call_id": "1234-5678-...",
  "spec": {
    "fn": "send_email",
    "kwargs": {
      "to": "user@example.com",
      "subject": "Hello",
      "body": "This is a test email"
    }
  },
  "status": {
    "approved": false,
    "comment": null
  }
}
```

### 2. Check Approval Status

Check the status of your approval request, using the call_id from the approval request:

```bash
make check-approval random_id=1234-5678-...
```

If not yet approved, you'll see:

```json
{
  "run_id": "curl-example",
  "call_id": "1234-5678-...",
  "spec": {
    "fn": "send_email",
    "kwargs": {
      "to": "user@example.com",
      "subject": "Hello",
      "body": "This is a test email"
    }
  },
  "status": {
    "approved": false,
    "comment": null
  }
}
```

Once approved:

```json
{
  "run_id": "curl-example",
  "call_id": "1234-5678-...",
  "spec": {
    "fn": "send_email",
    "kwargs": {
      "to": "user@example.com",
      "subject": "Hello",
      "body": "This is a test email"
    }
  },
  "status": {
    "approved": true,
    "comment": "Approved by reviewer"
  }
}
```

### 3. Run Complete Flow

To create a request and wait for approval:

```bash
make run-agent
```

This will:

1. Create an approval request
2. Poll for approval status every 3 seconds
3. Output the approval comment once approved

Example output while waiting:

```
waiting for approval
waiting for approval
waiting for approval
```

Once approved:

```
approval granted with comment "Approved by reviewer"
```
