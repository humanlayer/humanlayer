package models

// ModelContextLimits defines the context window sizes for different models
var ModelContextLimits = map[string]int{
	"claude-3-5-sonnet-20241022": 200000,
	"claude-3-5-haiku-20241022":  200000,
	"claude-3-opus-20240229":     200000,
	"claude-3-sonnet-20240229":   200000,
	"claude-3-haiku-20240307":    200000,
	"opus":                       200000,
	"sonnet":                     200000,
	"haiku":                      200000,
	"default":                    200000,
}

// GetModelContextLimit returns the context limit for a given model
func GetModelContextLimit(model string) int {
	if limit, ok := ModelContextLimits[model]; ok {
		return limit
	}
	return ModelContextLimits["default"]
}
