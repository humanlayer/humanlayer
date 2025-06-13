package main

import (
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// LoadConfig is a wrapper around domain.LoadConfig for backward compatibility
func LoadConfig() (*domain.Config, error) {
	return domain.LoadConfig()
}

// ValidateConfig is a wrapper around domain.ValidateConfig for backward compatibility
func ValidateConfig(config *domain.Config) error {
	return domain.ValidateConfig(config)
}
