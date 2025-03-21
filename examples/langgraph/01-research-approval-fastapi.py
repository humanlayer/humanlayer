import json
from enum import Enum
from typing import Dict, List, TypedDict
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from humanlayer import (HumanLayer, HumanLayerException,
                       ResponseOption)
from langchain_openai import ChatOpenAI
from langgraph.errors import NodeInterrupt
from logger import LoggerFactory
from pydantic import BaseModel

logger = LoggerFactory()

app = FastAPI()
load_dotenv()

# Initialize HumanLayer
hl = HumanLayer(run_id="research-assistant-demo")

reject_options = [
    ResponseOption(name="quick_answer", description="This can be answered quickly without deep research"),
    ResponseOption(name="needs_expert", description="This requires expert consultation"),
    ResponseOption(name="reject", description="This query should be rejected")
]
    
llm = ChatOpenAI(model="gpt-4o-mini")

class ResearchState(TypedDict):
    query: str
    findings: List[str]
    complexity: str  # "simple", "medium", "complex"
    current_path: str
    final_result: str
    thread_id: str

class ResearchPaths(Enum):
    QUICK_SEARCH = "quick_search"
    DEEP_DIVE = "deep_dive"
    EXPERT_CONSULT = "expert_consult"

class FunctionCall(BaseModel):
    event: dict

@app.post("/webhook/inbound") 
async def webhook_inbound(webhook: dict) -> Dict[str, str]:
    try:
        logger.info(f"Received webhook: {webhook}")
        
        event = webhook['event']
        status = event['status']
        spec = event.get('spec', {})
        
        if status.get('approved'):
            logger.info(f"Research approved with comment: {status.get('comment')}")
            query = spec['kwargs']['query']

            state = {
                "query": query,
                "findings": [],
                "complexity": "medium",
                "current_path": ResearchPaths.DEEP_DIVE.value,
                "final_result": "",
                "thread_id": str(uuid4())
            }
            
            # Process the research
            result = await process_research(state)
            return {"status": "ok", "result": json.dumps(result)}
        elif status.get('reject_option_name') == "quick_answer":
            # Handle quick answer path
            state = {
                "query": spec['kwargs']['query'],
                "findings": [],
                "complexity": "simple",
                "current_path": ResearchPaths.QUICK_SEARCH.value,
                "final_result": "",
                "thread_id": str(uuid4())
            }
            result = await process_research(state)
            return {"status": "ok", "result": result}
        elif status.get('reject_option_name') == "needs_expert":
            # Handle expert consultation path
            state = {
                "query": spec['kwargs']['query'],
                "findings": [],
                "complexity": "complex",
                "current_path": ResearchPaths.EXPERT_CONSULT.value,
                "final_result": "",
                "thread_id": str(uuid4())
            }
            result = await process_research(state)
            return {"status": "ok", "result": result}
        else:
            return {"status": "rejected", "reason": status.get('reject_option_name')}
        
    except Exception as e:
        logger.error(f"Error processing webhook: {str(e)}")
        return {"status": "error", "message": str(e)}

@hl.require_approval(reject_options=reject_options)
def research_approval(query: str) -> dict:
    """Request approval for research query"""
    return {
        "query": query
    }

async def process_research(state: ResearchState) -> Dict:
    """Process the research based on the path"""
    
    if state["current_path"] == ResearchPaths.QUICK_SEARCH.value:
        prompt = f"Provide a quick and concise answer to: {state['query']}"
    elif state["current_path"] == ResearchPaths.DEEP_DIVE.value:
        prompt = f"Provide a detailed analysis and research findings for: {state['query']}"
    else:  # EXPERT_CONSULT
        prompt = f"Provide an expert-level analysis with technical details for: {state['query']}"
    
    response = await llm.ainvoke(prompt)
    logger.info(f"Research response: {response}")
    state["final_result"] = response.content
    
    return {
        "query": state["query"],
        "path_taken": state["current_path"],
        "result": state["final_result"]
    }

class ResearchRequest(BaseModel):
    query: str

@app.post("/research")
async def research_endpoint(request: ResearchRequest):
    try:
        try:
            research_approval(query=request.query)
            raise NodeInterrupt("Waiting for approval")
        except HumanLayerException as e:
            return {"status": "error", "message": f"Research rejected: {str(e)}"}
        except NodeInterrupt:
            return {"status": "pending", "message": "Waiting for approval"}
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)