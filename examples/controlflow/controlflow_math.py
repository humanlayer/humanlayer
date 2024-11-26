# /// script
# dependencies = ["controlflow", "humanlayer"]
# ///

# https://controlflow.ai/welcome
import controlflow as cf

from humanlayer import HumanLayer

hl = HumanLayer(
    # run_id is optional -it can be used to identify the agent in approval history
    run_id="controlflow-math",
)


def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


@hl.require_approval()  # require user approval before this function can be called
def multiply(x: int, y: int) -> int:
    """multiply two numbers"""
    return x * y


if __name__ == "__main__":
    result = cf.run(
        "multiply 2 and 5, then add 32 to the result",
        tools=[add, multiply],
    )

    print("\n\n---------- RESULT ----------\n\n")
    print(result)
