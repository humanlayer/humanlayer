# Research Approval Workflow Example

This example demonstrates how to build a research approval workflow using LangGraph and HumanLayer in TypeScript. The workflow analyzes research queries, determines their complexity, and routes them through appropriate approval and research paths.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory with your API keys:
```
OPENAI_API_KEY=your_openai_api_key
HUMANLAYER_API_KEY=your_humanlayer_api_key
```

3. Build the TypeScript code:
```bash
npm run build
```

## Running the Example

To run the example:

```bash
npm start
```

This will execute the research workflow with three example queries of varying complexity:
- A simple query about basic facts
- A medium complexity query requiring deeper analysis
- A complex query requiring expert consultation

The workflow will:
1. Analyze the complexity of each query
2. Request human approval for medium/complex queries
3. Route the query through the appropriate research path
4. Synthesize and present the results

## Workflow Structure

The research workflow is implemented as a graph with the following nodes:
- `analyze`: Determines query complexity
- `human_approval`: Requests approval for medium/complex queries
- `quick_search`: Handles simple queries
- `deep_dive`: Processes medium complexity queries
- `expert_consult`: Handles complex queries
- `synthesize`: Combines findings into final results

The workflow automatically routes queries through the appropriate path based on their complexity and approval status. 