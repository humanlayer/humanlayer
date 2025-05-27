package humanlayer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
		baseURL: "https://api.humanlayer.dev",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	for _, opt := range opts {
		if err := opt(c); err != nil {
			return nil, err
		}
	}

	if c.apiKey == "" {
		return nil, fmt.Errorf("API key is required")
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

// GetPendingApprovals fetches all pending approval requests
func (c *Client) GetPendingApprovals(ctx context.Context) ([]ApprovalRequest, error) {
	resp, err := c.doRequest(ctx, "GET", "/v1/approvals/pending", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Approvals []ApprovalRequest `json:"approvals"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Approvals, nil
}

// GetPendingHumanContacts fetches all pending human contact requests
func (c *Client) GetPendingHumanContacts(ctx context.Context) ([]HumanContactRequest, error) {
	resp, err := c.doRequest(ctx, "GET", "/v1/human-contacts/pending", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Contacts []HumanContactRequest `json:"contacts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Contacts, nil
}

// ApproveRequest approves a pending request
func (c *Client) ApproveRequest(ctx context.Context, requestID string, response *ApprovalResponse) error {
	path := fmt.Sprintf("/v1/approvals/%s/respond", requestID)
	_, err := c.doRequest(ctx, "POST", path, response)
	return err
}

// DenyRequest denies a pending request with feedback
func (c *Client) DenyRequest(ctx context.Context, requestID string, reason string) error {
	response := &ApprovalResponse{
		Approved: false,
		Comment:  reason,
	}
	return c.ApproveRequest(ctx, requestID, response)
}

// RespondToHumanContact responds to a human contact request
func (c *Client) RespondToHumanContact(ctx context.Context, requestID string, message string) error {
	path := fmt.Sprintf("/v1/human-contacts/%s/respond", requestID)
	body := map[string]string{
		"response": message,
	}
	_, err := c.doRequest(ctx, "POST", path, body)
	return err
}