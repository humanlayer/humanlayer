from dotenv import load_dotenv

from humanlayer import ApprovalMethod, HumanLayer

load_dotenv()

import controlflow as cf

hl = HumanLayer(approval_method=ApprovalMethod.CLOUD)


def add(x: int, y: int) -> int:
    """Add two numbers together."""
    return x + y


# multiply must be approved via email by a user in the admin group
@hl.require_approval()
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
