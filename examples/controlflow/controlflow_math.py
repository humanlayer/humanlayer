from dotenv import load_dotenv

from humanlayer import HumanLayer

load_dotenv()

import controlflow as cf

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


@cf.task(tools=[add, multiply])
def do_math() -> int:
    """multiply 2 and 5, then add 32 to the result"""


if __name__ == "__main__":
    result = do_math()
    print("\n\n---------- RESULT ----------\n\n")
    print(result)
