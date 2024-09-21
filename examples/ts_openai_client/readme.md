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

output will look something like

```
calling tools multiply({"a": 2, "b": 5})
result: 10
calling tools add({"a": 10, "b": 32})
result: 42
First, multiplying 2 and 5 gives you 10. Then, adding 32 to the result gives you a final answer of 42.
```

if you reject the tool use, you might see something like

```
calling tools multiply({
  "a": 2,
  "b": 5
})
result: User denied function multiply with comment: try again, use 7 instead of 5
calling tools multiply({"a":2,"b":7})
result: 14
calling tools add({"a":14,"b":32})
result: 46
The result of multiplying 2 and 7, then adding 32 to the result is 46.
```

## Human as tool

You can also run the Human as Tool / linkedin assistant example

```
npm install
npm run human-as-tool
```
