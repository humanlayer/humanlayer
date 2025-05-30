package rpc

// HealthCheckRequest is the request for health check RPC
type HealthCheckRequest struct{}

// HealthCheckResponse is the response for health check RPC
type HealthCheckResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}
