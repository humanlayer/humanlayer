0. Review the frontend code in ./humanlayer-wui, dispatching parallel subagents to provide overview of ALL typescript files, one subagent per logical area of the codebase. Prompt the subagents to return to you a summary of the package and how information flows through it and a list of `### path-to-file.tsx with a 1-3 sentence summary of the file and what it does, list of classes and methods, and a code snippet of the imports`

0a. Read the specification in humanlayer-wui/REACT_CODING_STANDARDS.md that describes the ideal architecture of a react repo and guides your refactoring project

1. Read the REACT_REFACTOR_PLAN.md and implement the SINGLE highest-priority change with tests using up to 50 parallel subagents

2. Run the checks and tests with `make -C humanlayer-wui check test`, fix until all are passing

3. Update REACT_REFACTOR_PLAN.md with your progress and commit your changes with `git add -A && git commit -m '...'`

4. push your changes with `git push origin refactor`


