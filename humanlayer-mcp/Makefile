test-claude-local:
	claude --mcp-config ./mcp-config.json \
	    --permission-prompt-tool mcp__humanlayer_local__request_permission \
		-p "write a file named blah.txt for me with contents 'hello world'"

test-claude-splines-noperms:
	claude --mcp-config ./mcp-config.json \
		-p "reticulate splines please"

test-claude-npx:
	claude --mcp-config ./mcp-config.json \
	    --permission-prompt-tool mcp__humanlayer__request_permission \
		-p "reticulate splines please"