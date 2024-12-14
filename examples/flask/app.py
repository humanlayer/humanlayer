from flask import Flask, jsonify, request
from typing import Dict, Union
from agent import run_agent

app = Flask(__name__)


@app.route("/")
def root() -> Dict[str, str]:
    return {"message": "Welcome to the HumanLayer Flask Example"}


@app.route("/run")
def run() -> Dict[str, str]:
    prompt = request.args.get("prompt")
    if not prompt:
        return {"status": "error", "message": "No prompt provided"}

    result = run_agent(prompt)
    return {"status": "success", "result": result}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
