import json
from enum import Enum
from typing import List, TypedDict

from dotenv import load_dotenv
from humanlayer import (HumanLayer, HumanLayerException, ResponseOption)
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from logger import LoggerFactory

logger = LoggerFactory()

load_dotenv()

hl = HumanLayer(run_id="research-assistant-demo")

reject_options = [
    ResponseOption(name="too_risky", description="The research query is too risky"),
    ResponseOption(name="needs_revision", description="Query needs revision"),
    ResponseOption(name="out_of_scope", description="Query is out of scope")
]

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

def analyze_complexity(state: ResearchState):
    """Determine the complexity of the research query"""
    llm = ChatOpenAI(temperature=0, model="gpt-4o-mini")
    prompt = f"""Analyze the complexity of this research query: '{state["query"]}'
    Respond with only one word: 'simple', 'medium', or 'complex'."""
    
    response = llm.invoke(prompt)
    state["complexity"] = response.content.strip().lower()
    return state

@hl.require_approval(reject_options=reject_options)
def research_approval(query: str, complexity: str, proposed_path: str) -> dict:
    """Request approval for research query based on complexity and proposed path"""
    return {
        "query": query,
        "complexity": complexity,
        "proposed_path": proposed_path,
    }

def human_approval_node(state: ResearchState):
    """Request human approval for medium/complex queries"""
    if state["complexity"] in ["medium", "complex"]:
        # Determine the path first
        if state["complexity"] == "medium":
            proposed_path = ResearchPaths.DEEP_DIVE.value
        else:
            proposed_path = ResearchPaths.EXPERT_CONSULT.value
            
        try:
            research_approval(
                query=state["query"],
                complexity=state["complexity"],
                proposed_path=proposed_path
            )
            # If approved, set the path
            state["current_path"] = proposed_path
        except HumanLayerException as e:
            state["final_result"] = f"Research rejected: {str(e)}"
            return END

    return state

def route_research(state: ResearchState):
    """Route to appropriate research path based on complexity"""
    if state["complexity"] == "simple":
        return ResearchPaths.QUICK_SEARCH.value
    elif state["complexity"] == "medium":
        return ResearchPaths.DEEP_DIVE.value
    else:
        return ResearchPaths.EXPERT_CONSULT.value

def quick_search(state: ResearchState):
    """Handle simple queries with quick lookup"""
    llm = ChatOpenAI(model="gpt-4o-mini")
    state["findings"].append("Quick search result")
    state["current_path"] = "quick_search"
    return state

def deep_dive(state: ResearchState):
    """Handle medium complexity with multiple sources"""
    state["findings"].append("Deep dive analysis")
    state["current_path"] = "deep_dive"
    return state

def expert_consult(state: ResearchState):
    """Handle complex queries requiring expert consultation"""
    state["findings"].append("Expert consultation needed")
    state["current_path"] = "expert_consult"
    return state

def synthesize_results(state: ResearchState):
    """Combine findings into final result"""
    llm = ChatOpenAI(model="gpt-4o-mini")
    prompt = f"""Synthesize these findings for the query '{state["query"]}':
    Research path: {state["current_path"]}
    Findings: {json.dumps(state["findings"])}
    """
    response = llm.invoke(prompt)
    state["final_result"] = response.content
    return state

def build_research_graph():
    graph = StateGraph(ResearchState)
    
    graph.add_node("analyze", analyze_complexity)
    graph.add_node("human_approval", human_approval_node)
    graph.add_node("quick_search", quick_search)
    graph.add_node("deep_dive", deep_dive)
    graph.add_node("expert_consult", expert_consult)
    graph.add_node("synthesize", synthesize_results)

    graph.add_edge(START, "analyze")
    graph.add_edge("analyze", "human_approval")
    
    graph.add_conditional_edges(
        "human_approval",
        route_research,
        {
            ResearchPaths.QUICK_SEARCH.value: "quick_search",
            ResearchPaths.DEEP_DIVE.value: "deep_dive",
            ResearchPaths.EXPERT_CONSULT.value: "expert_consult"
        }
    )
    
    graph.add_edge("quick_search", "synthesize")
    graph.add_edge("deep_dive", "synthesize")
    graph.add_edge("expert_consult", "synthesize")
    
    return graph.compile()

if __name__ == "__main__":
    from uuid import uuid4
    
    graph = build_research_graph()
    
    queries = [
        "What's the capital of France?",  # simple
        "Explain the impact of AI on modern healthcare",  # medium
        "Analyze the quantum entanglement's role in consciousness theories",  # complex
    ]
    
    for query in queries:
        thread_id = str(uuid4())
        result = graph.invoke({
            "query": query,
            "findings": [],
            "complexity": "",
            "current_path": "",
            "final_result": "",
            "thread_id": thread_id
        })
        
        logger.info(f"\nQuery: {query}")
        logger.info(f"Complexity: {result['complexity']}")
        logger.info(f"Path Taken: {result['current_path']}")
        logger.info(f"Final Result: {result['final_result']}")