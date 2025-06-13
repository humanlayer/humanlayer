package api

import (
	"errors"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"go.uber.org/mock/gomock"
)

func TestSubscribeToEvents_Success(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	// Create a mock event channel
	eventChan := make(chan rpc.EventNotification, 1)

	expectedRequest := rpc.SubscribeRequest{
		EventTypes: []string{"approval_requested", "approval_responded", "session_updated"},
	}

	mockClient.EXPECT().Subscribe(expectedRequest).Return(eventChan, nil)

	cmd := apiClient.SubscribeToEvents()
	msg := cmd()

	result, ok := msg.(domain.SubscriptionMsg)
	if !ok {
		t.Fatalf("expected domain.SubscriptionMsg, got %T", msg)
	}

	if result.Err != nil {
		t.Errorf("unexpected error: %v", result.Err)
	}

	if result.EventChannel == nil {
		t.Error("expected non-nil event channel")
	}
}

func TestSubscribeToEvents_Error(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	expectedErr := errors.New("connection failed")

	mockClient.EXPECT().Subscribe(gomock.Any()).Return(nil, expectedErr)

	cmd := apiClient.SubscribeToEvents()
	msg := cmd()

	result, ok := msg.(domain.SubscriptionMsg)
	if !ok {
		t.Fatalf("expected domain.SubscriptionMsg, got %T", msg)
	}

	if result.Err != expectedErr {
		t.Errorf("expected error %v, got %v", expectedErr, result.Err)
	}
}

func TestListenForEvents_ReceiveEvent(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	eventChan := make(chan rpc.EventNotification, 1)

	expectedEvent := rpc.EventNotification{
		Event: bus.Event{
			Type:      bus.EventNewApproval,
			Timestamp: time.Now(),
		},
	}

	// Send event to channel
	eventChan <- expectedEvent

	cmd := apiClient.ListenForEvents(eventChan)
	msg := cmd()

	result, ok := msg.(domain.EventNotificationMsg)
	if !ok {
		t.Fatalf("expected domain.EventNotificationMsg, got %T", msg)
	}

	if result.Event.Event.Type != bus.EventNewApproval {
		t.Errorf("expected event type %s, got %s", bus.EventNewApproval, result.Event.Event.Type)
	}
}

func TestListenForEvents_ChannelClosed(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	eventChan := make(chan rpc.EventNotification)
	close(eventChan)

	cmd := apiClient.ListenForEvents(eventChan)
	msg := cmd()

	if msg != nil {
		t.Errorf("expected nil message on channel closure, got %T", msg)
	}
}
