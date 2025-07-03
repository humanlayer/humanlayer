.PHONY: diagram sequence

diagram:
	@echo "Extracting architecture diagram..."
	sed -n '/^```mermaid/,/^```/p' freestyle-build-plan.md | sed '1d;$$d' > architecture.mermaid
	@echo "Rendering architecture diagram to PNG..."
	npx -p @mermaid-js/mermaid-cli mmdc -i architecture.mermaid -o architecture.png --width 1600 --height 1200
	@echo "Opening architecture diagram..."
	open architecture.png

sequence:
	@echo "Extracting sequence diagram..."
	sed -n '/sequenceDiagram/,/^```/p' freestyle-build-plan.md | sed '$$d' > sequence.mermaid
	@echo "Rendering sequence diagram to PNG..."
	npx -p @mermaid-js/mermaid-cli mmdc -i sequence.mermaid -o sequence.png --width 1800 --height 1400
	@echo "Opening sequence diagram..."
	open sequence.png