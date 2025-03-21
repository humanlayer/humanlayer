# HumanLayer LangGraph Examples

This directory contains example implementations of HumanLayer integration with LangGraph.

## Weather Agent Example

The `weather_agent.py` example demonstrates how to:
1. Create a simple weather agent using LangGraph
2. Integrate HumanLayer for human interaction
3. Handle tool calls and message organization
4. Use checkpointing for state management

### Running the Example

1. First, make sure you have all dependencies installed:
```bash
pip install -e ".[dev]"
```

2. Set up your environment variables:
```bash
export OPENAI_API_KEY=your_api_key_here
export HUMANLAYER_API_KEY=your_humanlayer_api_key_here
```

3. Run the example:
```bash
python examples/weather_agent.py
```

The example will:
1. Create a new conversation thread
2. Process the initial query "Weather in sf?"
3. Use the weather tool to get the current weather
4. Resume the conversation with the tool results

### Example Output

You should see output similar to:
```
---chatbot---
get_weather({"location": "sf"})
---get_weather({"location": "sf"})---
It's 60 degrees and foggy.
```

## Adding More Examples

Feel free to contribute more examples that demonstrate different use cases of HumanLayer with LangGraph. Each example should:
1. Be self-contained
2. Include clear documentation
3. Demonstrate a specific feature or use case
4. Include proper error handling
5. Use environment variables for sensitive data 