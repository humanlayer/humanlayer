# HumanLayer FastAPI Example

This example demonstrates how to use AsyncHumanLayer with FastAPI to create an API with human-in-the-loop approval flows.

## Overview

The example shows how to:

- Use AsyncHumanLayer with FastAPI endpoints
- Handle human approvals for API operations
- Process both approved and denied responses
- Structure async API endpoints with human-in-the-loop flows

## Setup

1. Create a virtual environment and activate it:

   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and fill in your API keys:
   ```bash
   cp .env.example .env
   # Add your keys to .env:
   # HUMANLAYER_API_KEY=your_key_here
   # OPENAI_API_KEY=your_key_here
   ```

## Code Structure

The main application (`app.py`) shows how to:

1. Initialize AsyncHumanLayer:

   ```python
   from humanlayer import AsyncHumanLayer
   hl = AsyncHumanLayer.cloud(verbose=True)
   ```

2. Create functions requiring approval:

   ```python
   @hl.require_approval()
   async def multiply(a: int, b: int) -> int:
       return a * b
   ```

3. Handle approvals in endpoints:
   ```python
   @app.post("/math/multiply")
   async def math_multiply(a: int, b: int) -> Dict[str, str | int]:
       result = await multiply(a, b)
       if isinstance(result, str):  # Handle denial message
           return {"status": "denied", "message": result}
       return {"status": "success", "result": result}
   ```

## Running the Application

Start the server:

```bash
python app.py
# Or
uvicorn app:app --reload
```

## Testing Endpoints

Using curl:

```bash
# Test multiplication
curl -X POST "http://localhost:8000/math/multiply" \
     -H "Content-Type: application/json" \
     -d '{"a": 5, "b": 3}'

# Test division
curl -X POST "http://localhost:8000/math/divide" \
     -H "Content-Type: application/json" \
     -d '{"a": 10, "b": 2}'
```

## Response Formats

Successful operation:

```json
{
  "status": "success",
  "result": 15
}
```

Denied operation:

```json
{
  "status": "denied",
  "message": "User denied multiply with message: Not allowed"
}
```

## Key Features

- Async operations with human approval
- Error handling for denials and failures
- Type hints and proper response handling
- Health check endpoint with approval flow
- CORS middleware for API access
- Swagger UI at `/docs`

## Notes

- All operations requiring approval are wrapped with `@hl.require_approval()`
- Responses must handle both successful operations and denials
- Use `isinstance(result, str)` to check for denial messages
- The health check demonstrates a complete approval flow
