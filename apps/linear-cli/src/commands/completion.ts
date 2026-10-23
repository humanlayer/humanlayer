export function completionCommand(options: { bash?: boolean; zsh?: boolean; fish?: boolean }) {
	const commands = [
		'my-issues',
		'list-issues',
		'get-issue',
		'get-issue-v2',
		'add-comment',
		'fetch-images',
		'update-status',
		'add-link',
		'completion',
		'help',
	]

	if (options.bash) {
		// Basic bash completion
		console.log(`#!/usr/bin/env bash
# Bash completion for linear CLI

_linear_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${commands.join(' ')}"

  if [ $COMP_CWORD -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- $cur) )
  elif [ "$prev" = "add-comment" ] && [ $COMP_CWORD -eq 2 ]; then
    COMPREPLY=( $(compgen -W "--issue-id -i" -- $cur) )
  fi

  return 0
}

complete -F _linear_completions linear`)
	} else if (options.zsh) {
		// Basic zsh completion
		console.log(`#compdef linear

_linear() {
  local -a commands
  commands=(
    'my-issues:List your assigned issues'
    'list-issues:List and filter issues with advanced options'
    'get-issue:Show issue details and comments'
    'get-issue-v2:Get a single issue with the same output format as list-issues'
    'add-comment:Add a comment to an issue'
    'fetch-images:Download all images from an issue'
    'update-status:Update the status of a Linear issue'
    'add-link:Add a link/attachment to a Linear issue'
    'completion:Generate shell completion script'
    'help:Display help for command'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
  elif (( CURRENT == 3 )); then
    case $words[2] in
      add-comment)
        _arguments \\
          '-i[Specify the Linear issue ID manually]' \\
          '--issue-id[Specify the Linear issue ID manually]'
        ;;
      add-link)
        _arguments \\
          '-t[Optional title for the link]:title:' \\
          '--title[Optional title for the link]:title:'
        ;;
      get-issue-v2)
        _arguments \\
          '--output-format[Output format]:format:(markdown json rich-json)' \\
          '--fields[Fields to include]:fields:'
        ;;
      list-issues)
        _arguments \\
          '--max-issues[Maximum number of issues to fetch]:number:' \\
          '--assignee[Filter by assignee]:assignee:' \\
          '--status[Filter by status]:statuses:' \\
          '--size[Filter by issue size]:sizes:' \\
          '--sort-asc[Sort by updatedAt in ascending order]' \\
          '--output-format[Output format]:format:(markdown json rich-json)' \\
          '--fields[Fields to include]:fields:' \\
          '--ids-only[Output only issue identifiers]'
        ;;
    esac
  fi
}

_linear`)
	} else if (options.fish) {
		// Basic fish completion
		console.log(`# Fish completion for linear CLI

complete -c linear -f

# Commands
complete -c linear -n "__fish_use_subcommand" -a "my-issues" -d "List your assigned issues"
complete -c linear -n "__fish_use_subcommand" -a "list-issues" -d "List and filter issues with advanced options"
complete -c linear -n "__fish_use_subcommand" -a "get-issue" -d "Show issue details and comments"
complete -c linear -n "__fish_use_subcommand" -a "get-issue-v2" -d "Get a single issue with the same output format as list-issues"
complete -c linear -n "__fish_use_subcommand" -a "add-comment" -d "Add a comment to an issue"
complete -c linear -n "__fish_use_subcommand" -a "fetch-images" -d "Download all images from an issue"
complete -c linear -n "__fish_use_subcommand" -a "update-status" -d "Update the status of a Linear issue"
complete -c linear -n "__fish_use_subcommand" -a "add-link" -d "Add a link/attachment to a Linear issue"
complete -c linear -n "__fish_use_subcommand" -a "completion" -d "Generate shell completion script"
complete -c linear -n "__fish_use_subcommand" -a "help" -d "Display help for command"

# Options for add-comment
complete -c linear -n "__fish_seen_subcommand_from add-comment" -s i -l issue-id -d "Specify the Linear issue ID manually"

# Options for add-link
complete -c linear -n "__fish_seen_subcommand_from add-link" -s t -l title -d "Optional title for the link"

# Options for list-issues
complete -c linear -n "__fish_seen_subcommand_from list-issues" -l max-issues -d "Maximum number of issues to fetch"
complete -c linear -n "__fish_seen_subcommand_from list-issues" -l assignee -d "Filter by assignee"
complete -c linear -n "__fish_seen_subcommand_from list-issues" -l status -d "Filter by status"
complete -c linear -n "__fish_seen_subcommand_from list-issues" -l size -d "Filter by issue size"
complete -c linear -n "__fish_seen_subcommand_from list-issues" -l sort-asc -d "Sort by updatedAt in ascending order"
complete -c linear -n "__fish_seen_subcommand_from list-issues" -l output-format -d "Output format" -a "markdown json rich-json"
complete -c linear -n "__fish_seen_subcommand_from list-issues" -l fields -d "Fields to include"
complete -c linear -n "__fish_seen_subcommand_from list-issues" -l ids-only -d "Output only issue identifiers"

# Options for get-issue-v2
complete -c linear -n "__fish_seen_subcommand_from get-issue-v2" -l output-format -d "Output format" -a "markdown json rich-json"
complete -c linear -n "__fish_seen_subcommand_from get-issue-v2" -l fields -d "Fields to include"

# Options for completion
complete -c linear -n "__fish_seen_subcommand_from completion" -l bash -d "Generate Bash completion script"
complete -c linear -n "__fish_seen_subcommand_from completion" -l zsh -d "Generate Zsh completion script"
complete -c linear -n "__fish_seen_subcommand_from completion" -l fish -d "Generate Fish completion script"`)
	} else {
		console.log('Usage: linear completion --bash | --zsh | --fish')
		console.log('\nOptions:')
		console.log('  --bash    Generate Bash completion script')
		console.log('  --zsh     Generate Zsh completion script')
		console.log('  --fish    Generate Fish completion script')
		console.log('\nExample:')
		console.log('  linear completion --bash >> ~/.bash_completion')
	}
}
