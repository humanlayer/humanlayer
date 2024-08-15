import contextlib
import os
from typing import Generator


@contextlib.contextmanager
def env_var(var_name: str, var_value: str) -> Generator[None, None, None]:
    prev_value = os.environ.get(var_name)
    os.environ[var_name] = var_value
    try:
        yield
    finally:
        if prev_value is not None:
            os.environ[var_name] = prev_value
        else:
            del os.environ[var_name]
