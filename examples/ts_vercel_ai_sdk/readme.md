# HumanLayer example using OpenAI client in Typescript

Set up env

```
cp dotenv.example .env
# configure API token(s)
```

## Running with NPM

```
npm install
npm run example
```

once again, we're doing math here

```javascript
{
  input: "what's 6 + 7?",
  chat_history: [
    HumanMessage {
      "content": "hi i love math",
      "additional_kwargs": {},
      "response_metadata": {}
    },
    AIMessage {
      "content": "hi i love math too",
      "additional_kwargs": {},
      "response_metadata": {},
      "tool_calls": [],
      "invalid_tool_calls": []
    }
  ],
  output: '6 + 7 equals 13'
}
```
