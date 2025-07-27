# Hack Directory Guidelines

## Using UV Scripts for One-Off Tools

When creating standalone Python scripts in this directory, use uv's inline script dependencies:

```python
#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#     "pillow",
#     "requests",
# ]
# ///
```

This allows scripts to be self-contained with their dependencies and run with `uv run script.py` without manual environment setup. UV will automatically create an isolated environment and install the required packages on first run.
