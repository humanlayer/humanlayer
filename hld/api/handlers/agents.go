package handlers

import (
	"context"
	"io/ioutil"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/humanlayer/humanlayer/hld/api"
	"gopkg.in/yaml.v3"
)

type AgentHandlers struct{}

func NewAgentHandlers() *AgentHandlers {
	return &AgentHandlers{}
}

// AgentFrontmatter represents the YAML frontmatter in agent files
type AgentFrontmatter struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description,omitempty"`
	Tools       string `yaml:"tools,omitempty"`  // Tools is a comma-separated string in the YAML
	Model       string `yaml:"model,omitempty"`
}

// DiscoverAgents discovers available agents from .claude/agents directories
func (h *AgentHandlers) DiscoverAgents(ctx context.Context, req api.DiscoverAgentsRequestObject) (api.DiscoverAgentsResponseObject, error) {
	slog.Info("DiscoverAgents called", "hasBody", req.Body != nil)

	if req.Body == nil || req.Body.WorkingDir == "" {
		slog.Warn("Missing or empty workingDir in request")
		return api.DiscoverAgents200JSONResponse{
			Agents: []api.Agent{},
		}, nil
	}

	// Validate agent name format (lowercase letters and hyphens only)
	validNameRegex := regexp.MustCompile(`^[a-z-]+$`)

	// Build paths
	localAgentsDir := filepath.Join(expandTilde(req.Body.WorkingDir), ".claude", "agents")
	homeDir, _ := os.UserHomeDir()
	globalAgentsDir := ""
	if homeDir != "" {
		globalAgentsDir = filepath.Join(homeDir, ".claude", "agents")
	}

	slog.Info("Discovering agents",
		"localDir", localAgentsDir,
		"globalDir", globalAgentsDir,
		"workingDir", req.Body.WorkingDir)

	// Track discovered agents (deduplication: local overrides global)
	agentMap := make(map[string]api.Agent)

	// Helper to discover agents from a directory
	discoverFromDir := func(dir string, source api.AgentSource) error {
		if dir == "" {
			return nil
		}

		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				slog.Info("Agent directory does not exist", "dir", dir)
				return nil // Directory doesn't exist is OK
			}
			return err
		}

		slog.Info("Scanning agent directory", "dir", dir, "fileCount", len(entries))

		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
				continue
			}

			// Read file content
			filePath := filepath.Join(dir, entry.Name())
			slog.Info("Processing agent file", "file", filePath)

			content, err := ioutil.ReadFile(filePath)
			if err != nil {
				slog.Warn("Failed to read agent file",
					"file", filePath,
					"error", err.Error())
				continue
			}

			// Extract YAML frontmatter (between --- markers)
			frontmatterRegex := regexp.MustCompile(`(?s)^---\n(.+?)\n---`)
			matches := frontmatterRegex.FindSubmatch(content)
			if len(matches) < 2 {
				slog.Info("No frontmatter found in agent file", "file", filePath)
				// No frontmatter, skip silently
				continue
			}

			slog.Info("Found frontmatter", "file", filePath, "frontmatterLen", len(matches[1]))

			// Parse YAML
			var frontmatter AgentFrontmatter
			if err := yaml.Unmarshal(matches[1], &frontmatter); err != nil {
				slog.Warn("Failed to parse agent frontmatter",
					"file", filePath,
					"error", err.Error())
				continue
			}

			slog.Info("Parsed frontmatter", "file", filePath, "name", frontmatter.Name, "description", frontmatter.Description)

			// Validate name exists and format
			if frontmatter.Name == "" || !validNameRegex.MatchString(frontmatter.Name) {
				slog.Warn("Invalid agent name",
					"file", filePath,
					"name", frontmatter.Name)
				continue
			}

			// Create agent entry
			mentionText := "@agent-" + frontmatter.Name

			// Check for duplicates (local overrides global)
			if _, exists := agentMap[frontmatter.Name]; exists {
				if source == api.AgentSourceLocal {
					// Local overrides global
					agentMap[frontmatter.Name] = api.Agent{
						Name:        frontmatter.Name,
						MentionText: mentionText,
						Source:      source,
						Description: &frontmatter.Description,
					}
				}
				// If global and local already exists, skip
			} else {
				// New agent
				agentMap[frontmatter.Name] = api.Agent{
					Name:        frontmatter.Name,
					MentionText: mentionText,
					Source:      source,
					Description: &frontmatter.Description,
				}
			}
		}

		return nil
	}

	// Discover global agents first
	if err := discoverFromDir(globalAgentsDir, api.AgentSourceGlobal); err != nil {
		slog.Warn("Failed to discover global agents",
			"dir", globalAgentsDir,
			"error", err.Error())
	}

	// Then discover local agents (these override global)
	if err := discoverFromDir(localAgentsDir, api.AgentSourceLocal); err != nil {
		slog.Warn("Failed to discover local agents",
			"dir", localAgentsDir,
			"error", err.Error())
	}

	// Convert map to slice
	agents := make([]api.Agent, 0, len(agentMap))
	for _, agent := range agentMap {
		agents = append(agents, agent)
	}

	return api.DiscoverAgents200JSONResponse{
		Agents: agents,
	}, nil
}

