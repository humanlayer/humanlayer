from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict
from humanlayer import AsyncHumanLayer

app = FastAPI(
    title="HumanLayer FastAPI Example", description="Example of using AsyncHumanLayer with FastAPI", version="1.0.0"
)

# Initialize HumanLayer
hl = AsyncHumanLayer(verbose=True)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Root endpoint
@app.get("/")
async def root() -> Dict[str, str]:
    return {"message": "Welcome to the HumanLayer FastAPI Example"}


@hl.require_approval()
async def multiply(a: int, b: int) -> int:
    """Multiply two numbers with human approval"""
    return a * b


@hl.require_approval()
async def divide(a: int, b: int) -> float:
    """Divide two numbers with human approval"""
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b


# Math operations endpoint
@app.post("/math/multiply")
async def math_multiply(a: int, b: int) -> Dict[str, str | int]:
    result = await multiply(a=a, b=b)
    if isinstance(result, str):  # Handle denial message
        return {"status": "denied", "message": result}
    return {"status": "success", "result": result}


@app.post("/math/divide")
async def math_divide(a: int, b: int) -> Dict[str, str | float]:
    result = await divide(a=a, b=b)
    if isinstance(result, str):  # Handle denial message
        return {"status": "denied", "message": result}
    return {"status": "success", "result": result}


@app.post("/ask-question")
async def ask_question(question: str) -> Dict[str, str | float]:
    contact_human = hl.human_as_tool()  # todo needs kwarg-only signature for the returned type, ignore for now
    result = await contact_human(message=question)  # type: ignore
    return {"status": "success", "result": result}


# Health check endpoint
@app.get("/health")
async def health_check() -> Dict[str, str]:
    result = await multiply(a=2, b=5)
    if isinstance(result, str):  # Handle denial message
        return {"status": "denied", "message": result}

    nums_added = result + 32  # Now we know it's an int
    return {"status": "healthy", "result": str(nums_added)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
