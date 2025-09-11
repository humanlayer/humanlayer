package version

var (
	// Base version - can be overridden at build time
	Version = "0.1.0"

	// Build version - injected at build time
	BuildVersion = "dev"
)

// GetVersion returns the full version string
func GetVersion() string {
	if BuildVersion != "dev" && BuildVersion != "" {
		return BuildVersion
	}
	return Version
}
