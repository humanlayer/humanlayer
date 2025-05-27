package humanlayer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Client is the HumanLayer API client
type Client struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

// ClientOption is a functional option for configuring the client
type ClientOption func(*Client) error

// NewClient creates a new HumanLayer client
func NewClient(opts ...ClientOption) (*Client, error) {
	c := &Client{
		baseURL: "https://api.humanlayer.dev/humanlayer/v1",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	// Check for API key in environment if not provided
	if apiKey := os.Getenv("HUMANLAYER_API_KEY"); apiKey != "" {
		c.apiKey = apiKey
	}

	for _, opt := range opts {
		if err := opt(c); err != nil {
			return nil, err
		}
	}

	if c.apiKey == "" {
		return nil, fmt.Errorf("API key is required (set HUMANLAYER_API_KEY or use WithAPIKey)")
	}

	return c, nil
}

// WithAPIKey sets the API key
func WithAPIKey(key string) ClientOption {
	return func(c *Client) error {
		c.apiKey = key
		return nil
	}
}

// WithBaseURL sets the base URL
func WithBaseURL(url string) ClientOption {
	return func(c *Client) error {
		c.baseURL = url
		return nil
	}
}

// WithHTTPClient sets a custom HTTP client
func WithHTTPClient(client *http.Client) ClientOption {
	return func(c *Client) error {
		c.httpClient = client
		return nil
	}
}

// doRequest performs an HTTP request with auth and JSON handling
func (c *Client) doRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	url := c.baseURL + path

	var bodyReader io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error: %s (status %d)", string(body), resp.StatusCode)
	}

	return resp, nil
}

// GetPendingFunctionCalls fetches all pending function call approval requests
func (c *Client) GetPendingFunctionCalls(ctx context.Context) ([]FunctionCall, error) {
	resp, err := c.doRequest(ctx, "GET", "/agent/function_calls/pending", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var functionCalls []FunctionCall
	if err := json.NewDecoder(resp.Body).Decode(&functionCalls); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return functionCalls, nil
}

// GetPendingHumanContacts fetches all pending human contact requests
func (c *Client) GetPendingHumanContacts(ctx context.Context) ([]HumanContact, error) {
	resp, err := c.doRequest(ctx, "GET", "/agent/human_contacts/pending", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var humanContacts []HumanContact
	if err := json.NewDecoder(resp.Body).Decode(&humanContacts); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return humanContacts, nil
}

// RespondToFunctionCall responds to a function call approval request
func (c *Client) RespondToFunctionCall(ctx context.Context, callID string, status FunctionCallStatus) error {
	path := fmt.Sprintf("/agent/function_calls/%s/respond", callID)
	resp, err := c.doRequest(ctx, "POST", path, status)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// ApproveFunctionCall approves a function call
func (c *Client) ApproveFunctionCall(ctx context.Context, callID string, comment string) error {
	approved := true
	status := FunctionCallStatus{
		Approved: &approved,
		Comment:  comment,
	}
	return c.RespondToFunctionCall(ctx, callID, status)
}

// DenyFunctionCall denies a function call with a reason
func (c *Client) DenyFunctionCall(ctx context.Context, callID string, reason string) error {
	approved := false
	status := FunctionCallStatus{
		Approved: &approved,
		Comment:  reason,
	}
	return c.RespondToFunctionCall(ctx, callID, status)
}

// RespondToHumanContact responds to a human contact request
func (c *Client) RespondToHumanContact(ctx context.Context, callID string, response string) error {
	path := fmt.Sprintf("/agent/human_contacts/%s/respond", callID)
	status := HumanContactStatus{
		Response: response,
	}
	resp, err := c.doRequest(ctx, "POST", path, status)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}
