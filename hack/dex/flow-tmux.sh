number=$1
if [ -z "$number" ]; then
  detected_number="$(tmux display-message -p '\#W' 2>/dev/null | cut -d'-' -f2 | grep -E '^[0-9]+$')"
  if [ -n "$detected_number" ]; then
    echo "Detected ticket number from tmux pane title: $detected_number"
    read -p "Is this correct? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      number=$detected_number
    else
      echo "Usage: $0 <number>"
      exit 1
    fi
  fi
fi

if [ -z "$number" ]; then
  echo "Usage: $0 <number>"
  exit 1
fi

if [ -z "$LINEAR_API_KEY" ]; then
  echo "LINEAR_API_KEY is not set"
  exit 1
fi

set -euo pipefail
set -x

skip_research=false
skip_plan=false

if [ "$2" = "plan" ]; then
  skip_research=true
elif [ "$2" = "ticket" ]; then
  skip_research=true
  skip_plan=true
fi

if [ "$skip_research" = "false" ]; then
  # research
  tmux rename-window "ENG-${number}-research"
  # fetch the ticket for the number
  linear get-issue ENG-$number > thoughts/shared/tickets/eng-$number.md
  claude --allowedTools="Write,Edit,MultiEdit" "/research_codebase find all places in the code related to thoughts/shared/tickets/eng-${number}.md, ensure your final output filename includes 'eng-${number}'"
  sleep 5
  humanlayer thoughts sync || echo "thoughts sync failed"
fi

if [ "$skip_plan" = "false" ]; then
  # plan
  tmux rename-window "eng-${number}-plan"
  claude --allowedTools="Write,Edit,MultiEdit" "/create_plan make the plan for thoughts/shared/tickets/eng-${number}.md - ensure eng-${number} is in the final plan file name"
  sleep 5
  humanlayer thoughts sync || echo "thoughts sync failed"
fi

# linear
tmux rename-window "eng-${number}-linear"
claude "/linear review all the files in thoughts/ (research, plans) related to eng-${number} and attach to the ticket links, then put the ticket in 'spec in review' state"
sleep 5
