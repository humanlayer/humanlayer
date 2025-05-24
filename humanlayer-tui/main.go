package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
)

func main() {
	app := tea.NewProgram(newModel(), tea.WithAltScreen())
	if _, err := app.Run(); err != nil {
		fmt.Printf("Error: %v", err)
		os.Exit(1)
	}
}
