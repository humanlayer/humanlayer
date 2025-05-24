package main

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type screen int

const (
	helloScreen screen = iota
	buttonScreen
)

type buttonState struct {
	green bool
	blue  bool
}

type model struct {
	currentScreen screen
	width, height int
	selected      int
	buttons       buttonState
}

type keyMap struct {
	Up     key.Binding
	Down   key.Binding
	Enter  key.Binding
	Switch key.Binding
	Quit   key.Binding
}

var keys = keyMap{
	Up: key.NewBinding(
		key.WithKeys("up", "k"),
		key.WithHelp("↑/k", "move up"),
	),
	Down: key.NewBinding(
		key.WithKeys("down", "j"),
		key.WithHelp("↓/j", "move down"),
	),
	Enter: key.NewBinding(
		key.WithKeys("enter", " "),
		key.WithHelp("enter/space", "select"),
	),
	Switch: key.NewBinding(
		key.WithKeys("tab"),
		key.WithHelp("tab", "switch screen"),
	),
	Quit: key.NewBinding(
		key.WithKeys("q", "ctrl+c"),
		key.WithHelp("q", "quit"),
	),
}

func newModel() model {
	return model{
		currentScreen: helloScreen,
		selected:      0,
		buttons: buttonState{
			green: false,
			blue:  false,
		},
	}
}

func (m model) Init() tea.Cmd {
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		switch {
		case key.Matches(msg, keys.Quit):
			return m, tea.Quit

		case key.Matches(msg, keys.Switch):
			if m.currentScreen == helloScreen {
				m.currentScreen = buttonScreen
			} else {
				m.currentScreen = helloScreen
			}
			m.selected = 0
			return m, nil

		case key.Matches(msg, keys.Up):
			if m.currentScreen == buttonScreen && m.selected > 0 {
				m.selected--
			}
			return m, nil

		case key.Matches(msg, keys.Down):
			if m.currentScreen == buttonScreen && m.selected < 1 {
				m.selected++
			}
			return m, nil

		case key.Matches(msg, keys.Enter):
			if m.currentScreen == buttonScreen {
				if m.selected == 0 {
					m.buttons.green = !m.buttons.green
				} else {
					m.buttons.blue = !m.buttons.blue
				}
			}
			return m, nil
		}
	}

	return m, nil
}

func (m model) View() string {
	switch m.currentScreen {
	case helloScreen:
		return m.helloView()
	case buttonScreen:
		return m.buttonView()
	default:
		return ""
	}
}

func (m model) helloView() string {
	style := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		Padding(2, 4).
		MarginTop(m.height/2 - 3).
		Align(lipgloss.Center).
		Foreground(lipgloss.Color("86"))

	content := "Hello!\n\nPress Tab to switch to button screen\nPress q to quit"

	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, style.Render(content))
}

func (m model) buttonView() string {
	var greenStyle, blueStyle lipgloss.Style

	baseStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		Padding(1, 3).
		Margin(1)

	if m.buttons.green {
		greenStyle = baseStyle.
			Background(lipgloss.Color("46")).
			Foreground(lipgloss.Color("0"))
	} else {
		greenStyle = baseStyle.
			Foreground(lipgloss.Color("240"))
	}

	if m.buttons.blue {
		blueStyle = baseStyle.
			Background(lipgloss.Color("39")).
			Foreground(lipgloss.Color("15"))
	} else {
		blueStyle = baseStyle.
			Foreground(lipgloss.Color("240"))
	}

	if m.selected == 0 {
		greenStyle = greenStyle.BorderForeground(lipgloss.Color("205"))
	}
	if m.selected == 1 {
		blueStyle = blueStyle.BorderForeground(lipgloss.Color("205"))
	}

	greenButton := greenStyle.Render("Green")
	blueButton := blueStyle.Render("Blue")

	buttons := lipgloss.JoinVertical(lipgloss.Left, greenButton, blueButton)

	instructions := lipgloss.NewStyle().
		Foreground(lipgloss.Color("244")).
		MarginTop(2).
		Render("Use ↑/↓ to navigate, Enter to toggle color, Tab to switch screen, q to quit")

	content := lipgloss.JoinVertical(lipgloss.Left, buttons, instructions)

	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, content)
}
