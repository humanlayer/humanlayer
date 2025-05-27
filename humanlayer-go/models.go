package humanlayer

import (
	"time"
	"strings"
	"fmt"
)

// CustomTime handles timestamps from the API that may not include timezone
type CustomTime struct {
	time.Time
}

// UnmarshalJSON handles parsing timestamps without timezone info
func (ct *CustomTime) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), "\"")
	if s == "null" {
		return nil
	}
	
	// Try parsing with timezone first
	t, err := time.Parse(time.RFC3339, s)
	if err == nil {
		ct.Time = t
		return nil
	}
	
	// Try without timezone (assume UTC)
	t, err = time.Parse("2006-01-02T15:04:05.999999", s)
	if err == nil {
		ct.Time = t.UTC()
		return nil
	}
	
	// Try without microseconds
	t, err = time.Parse("2006-01-02T15:04:05", s)
	if err == nil {
		ct.Time = t.UTC()
		return nil
	}
	
	return fmt.Errorf("unable to parse time: %s", s)
}

// FunctionCall represents a function call approval request
type FunctionCall struct {
	RunID  string            `json:"run_id"`
	CallID string            `json:"call_id"`
	Spec   FunctionCallSpec  `json:"spec"`
	Status *FunctionCallStatus `json:"status,omitempty"`
}

// FunctionCallSpec contains the details of what function is being called
type FunctionCallSpec struct {
	Fn            string                 `json:"fn"`
	Kwargs        map[string]interface{} `json:"kwargs"`
	Channel       *ContactChannel        `json:"channel,omitempty"`
	RejectOptions []ResponseOption       `json:"reject_options,omitempty"`
	State         map[string]interface{} `json:"state,omitempty"`
}

// FunctionCallStatus represents the approval status
type FunctionCallStatus struct {
	RequestedAt      *CustomTime            `json:"requested_at,omitempty"`
	RespondedAt      *CustomTime            `json:"responded_at,omitempty"`
	Approved         *bool                  `json:"approved,omitempty"`
	Comment          string                 `json:"comment,omitempty"`
	UserInfo         map[string]interface{} `json:"user_info,omitempty"`
	RejectOptionName string                 `json:"reject_option_name,omitempty"`
}

// HumanContact represents a human contact request
type HumanContact struct {
	RunID  string             `json:"run_id"`
	CallID string             `json:"call_id"`
	Spec   HumanContactSpec   `json:"spec"`
	Status *HumanContactStatus `json:"status,omitempty"`
}

// HumanContactSpec contains the contact request details
type HumanContactSpec struct {
	Msg             string                 `json:"msg"`
	Subject         string                 `json:"subject,omitempty"`
	Channel         *ContactChannel        `json:"channel,omitempty"`
	ResponseOptions []ResponseOption       `json:"response_options,omitempty"`
	State           map[string]interface{} `json:"state,omitempty"`
}

// HumanContactStatus represents the response status
type HumanContactStatus struct {
	RequestedAt        *CustomTime `json:"requested_at,omitempty"`
	RespondedAt        *CustomTime `json:"responded_at,omitempty"`
	Response           string      `json:"response,omitempty"`
	ResponseOptionName string      `json:"response_option_name,omitempty"`
}

// ResponseOption represents a predefined response option
type ResponseOption struct {
	Name        string `json:"name"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	PromptFill  string `json:"prompt_fill,omitempty"`
	Interactive bool   `json:"interactive"`
}

// ContactChannel represents how to contact the human
type ContactChannel struct {
	Slack *SlackChannel `json:"slack,omitempty"`
	Email *EmailChannel `json:"email,omitempty"`
}

// SlackChannel configuration
type SlackChannel struct {
	ChannelOrUserID string `json:"channel_or_user_id"`
	// Add other fields as needed
}

// EmailChannel configuration
type EmailChannel struct {
	Address string `json:"address"`
	// Add other fields as needed
}