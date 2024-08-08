# LangChain Examples

```
pip install -r requirements.txt
```

```
python math_example.py
```

## All Examples

- [00-math_no_approvals.py](00-math_no_approvals.py) - A simple math example that does not use functionlayer
- [01-math_example.py](01-math_example.py) - A simple math example that uses functionlayer to gate access to the `multiply` function
- [02-math_with_eval.py](02-math_with_eval.py) - A math example that gates access to the `run_python_code(code: str) -> str` function
- [03-human_as_tool.py](03-human_as_tool.py) - A tou example of using functionlayer's `human_as_tool()` function to create a tool that the angent can use to contact a human for input
- [04-human_as_tool_onboarding.py](04-human_as_tool_onboarding.py) - A more in-depth example of an agent that uses a human_as_tool channel to get feedback on emails that are to be sent to new customers
- [05-approvals_and_humans_composite.py](05-approvals_and_humans_composite.py) - Wrapping a "contact a human call" with an approval step routed to another human
- [06-custom_bot_token.py](06-custom_bot_token.py) - Example of how to override the default slack bot token for specific channels
