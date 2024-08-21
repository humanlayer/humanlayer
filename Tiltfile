deps = [
    "humanlayer/",
]
local_resource("check", cmd="make typecheck", deps=deps, ignore="**/*pyc*")
local_resource("test", cmd="pytest -x humanlayer", deps=deps, ignore="**/*pyc*")
