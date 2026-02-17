package question

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestManager_CreateQuestion(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	sessionID := "test-session-456"
	questionsJSON := json.RawMessage(`{"questions":[{"question":"Which approach?","header":"Approach","options":[{"label":"A","description":"Option A"}],"multiSelect":false}]}`)

	// Mock getting session
	mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
		ID:    sessionID,
		RunID: "test-run-123",
	}, nil)

	// Mock looking up pending tool calls — matched by ToolInputJSON content
	mockStore.EXPECT().GetPendingToolCalls(ctx, sessionID).Return([]*store.ConversationEvent{
		{ToolID: "toolu_other", ToolName: "mcp__codelayer__ask_user_question", ToolInputJSON: `{"questions":[]}`},
		{ToolID: "toolu_test123", ToolName: "mcp__codelayer__ask_user_question", ToolInputJSON: string(questionsJSON)},
	}, nil)

	// Mock getting pending questions (none yet, so no claimed tool IDs)
	mockStore.EXPECT().GetPendingQuestions(ctx, sessionID).Return([]*store.Question{}, nil)

	// Mock creating question
	mockStore.EXPECT().CreateQuestion(ctx, gomock.Any()).DoAndReturn(func(ctx context.Context, q *store.Question) error {
		assert.Equal(t, sessionID, q.SessionID)
		assert.Equal(t, "test-run-123", q.RunID)
		assert.Equal(t, store.QuestionStatusPending, q.Status)
		assert.NotNil(t, q.ToolUseID)
		assert.Equal(t, "toolu_test123", *q.ToolUseID)
		assert.True(t, strings.HasPrefix(q.ID, "question-"))
		assert.JSONEq(t, string(questionsJSON), string(q.QuestionsJSON))
		return nil
	})

	// Mock event publishing
	mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(event bus.Event) {
		assert.Equal(t, bus.EventNewQuestion, event.Type)
		assert.Equal(t, sessionID, event.Data["session_id"])
	})

	// Mock session status update to waiting_input
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).DoAndReturn(func(_ context.Context, id string, updates store.SessionUpdate) error {
		assert.NotNil(t, updates.Status)
		assert.Equal(t, store.SessionStatusWaitingInput, *updates.Status)
		return nil
	})

	q, err := mgr.CreateQuestion(ctx, sessionID, questionsJSON)
	require.NoError(t, err)
	assert.NotNil(t, q)
	assert.True(t, strings.HasPrefix(q.ID, "question-"))
	assert.NotNil(t, q.ToolUseID)
	assert.Equal(t, "toolu_test123", *q.ToolUseID)
}

func TestManager_CreateQuestion_NoPendingToolCall(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	sessionID := "test-session-789"

	mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
		ID:    sessionID,
		RunID: "test-run-456",
	}, nil)

	// No matching tool call found — no ToolInputJSON match
	mockStore.EXPECT().GetPendingToolCalls(ctx, sessionID).Return([]*store.ConversationEvent{}, nil)

	// No pending questions either
	mockStore.EXPECT().GetPendingQuestions(ctx, sessionID).Return([]*store.Question{}, nil)

	mockStore.EXPECT().CreateQuestion(ctx, gomock.Any()).DoAndReturn(func(ctx context.Context, q *store.Question) error {
		assert.Nil(t, q.ToolUseID)
		return nil
	})

	mockEventBus.EXPECT().Publish(gomock.Any())
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)

	q, err := mgr.CreateQuestion(ctx, sessionID, json.RawMessage(`{"questions":[]}`))
	require.NoError(t, err)
	assert.Nil(t, q.ToolUseID)
}

func TestManager_CreateQuestion_ToolCallLookupError(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	sessionID := "test-session-err"

	mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
		ID:    sessionID,
		RunID: "test-run-err",
	}, nil)

	// Tool call lookup fails — should not block question creation
	mockStore.EXPECT().GetPendingToolCalls(ctx, sessionID).Return(nil, fmt.Errorf("db error"))

	mockStore.EXPECT().CreateQuestion(ctx, gomock.Any()).DoAndReturn(func(ctx context.Context, q *store.Question) error {
		assert.Nil(t, q.ToolUseID)
		return nil
	})

	mockEventBus.EXPECT().Publish(gomock.Any())
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)

	q, err := mgr.CreateQuestion(ctx, sessionID, json.RawMessage(`{"questions":[]}`))
	require.NoError(t, err)
	assert.Nil(t, q.ToolUseID)
}

func TestManager_CreateQuestion_SessionNotFound(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()

	mockStore.EXPECT().GetSession(ctx, "bad-session").Return(nil, nil)

	_, err := mgr.CreateQuestion(ctx, "bad-session", json.RawMessage(`{"questions":[]}`))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "session not found")
}

func TestManager_CreateQuestion_InvalidJSON(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()

	_, err := mgr.CreateQuestion(ctx, "session-1", json.RawMessage(`{invalid`))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not valid JSON")
}

func TestManager_CreateQuestion_EmptyJSON(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()

	_, err := mgr.CreateQuestion(ctx, "session-1", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "questions_json is required")
}

func TestManager_AnswerQuestion(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	questionID := "question-123"
	sessionID := "test-session"
	answersJSON := json.RawMessage(`{"Approach":"A"}`)

	// Mock answering question in store
	mockStore.EXPECT().AnswerQuestion(ctx, questionID, store.QuestionStatusAnswered, answersJSON).Return(nil)

	// Mock getting updated question
	mockStore.EXPECT().GetQuestion(ctx, questionID).Return(&store.Question{
		ID:        questionID,
		SessionID: sessionID,
		Status:    store.QuestionStatusAnswered,
	}, nil)

	// Mock event publishing
	mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(event bus.Event) {
		assert.Equal(t, bus.EventQuestionAnswered, event.Type)
		assert.Equal(t, questionID, event.Data["question_id"])
		assert.Equal(t, sessionID, event.Data["session_id"])
		assert.Equal(t, string(store.QuestionStatusAnswered), event.Data["status"])
	})

	// Mock session status update to running
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).DoAndReturn(func(_ context.Context, id string, updates store.SessionUpdate) error {
		assert.NotNil(t, updates.Status)
		assert.Equal(t, store.SessionStatusRunning, *updates.Status)
		return nil
	})

	err := mgr.AnswerQuestion(ctx, questionID, answersJSON)
	require.NoError(t, err)
}

func TestManager_AnswerQuestion_StoreError(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()

	mockStore.EXPECT().AnswerQuestion(ctx, "q-1", store.QuestionStatusAnswered, gomock.Any()).
		Return(fmt.Errorf("db error"))

	err := mgr.AnswerQuestion(ctx, "q-1", json.RawMessage(`{}`))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to answer question")
}

func TestManager_AnswerQuestion_GetQuestionFailsAfterAnswer(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()

	// Answer succeeds in store
	mockStore.EXPECT().AnswerQuestion(ctx, "q-1", store.QuestionStatusAnswered, gomock.Any()).Return(nil)

	// But GetQuestion fails
	mockStore.EXPECT().GetQuestion(ctx, "q-1").Return(nil, fmt.Errorf("db read error"))

	err := mgr.AnswerQuestion(ctx, "q-1", json.RawMessage(`{}`))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to retrieve updated state")
}

func TestManager_DeclineQuestion(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	questionID := "question-456"
	sessionID := "test-session"

	// Mock declining question in store
	mockStore.EXPECT().AnswerQuestion(ctx, questionID, store.QuestionStatusDeclined, nil).Return(nil)

	// Mock getting updated question
	mockStore.EXPECT().GetQuestion(ctx, questionID).Return(&store.Question{
		ID:        questionID,
		SessionID: sessionID,
		Status:    store.QuestionStatusDeclined,
	}, nil)

	// Mock event publishing
	mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(event bus.Event) {
		assert.Equal(t, bus.EventQuestionAnswered, event.Type)
		assert.Equal(t, string(store.QuestionStatusDeclined), event.Data["status"])
	})

	// Mock session status update to running
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)

	err := mgr.DeclineQuestion(ctx, questionID)
	require.NoError(t, err)
}

func TestManager_GetQuestion(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()

	expected := &store.Question{
		ID:     "question-1",
		Status: store.QuestionStatusPending,
	}
	mockStore.EXPECT().GetQuestion(ctx, "question-1").Return(expected, nil)

	got, err := mgr.GetQuestion(ctx, "question-1")
	require.NoError(t, err)
	assert.Equal(t, expected, got)
}

func TestManager_CreateQuestion_DuplicateContentSkipsClaimedToolID(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	sessionID := "test-session-dup"
	questionsJSON := json.RawMessage(`{"questions":[{"question":"Pick one","header":"Choice","options":[{"label":"A","description":"A"}],"multiSelect":false}]}`)

	mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
		ID:    sessionID,
		RunID: "test-run-dup",
	}, nil)

	// Two pending tool calls with identical content but different tool IDs
	mockStore.EXPECT().GetPendingToolCalls(ctx, sessionID).Return([]*store.ConversationEvent{
		{ToolID: "toolu_first", ToolName: "mcp__codelayer__ask_user_question", ToolInputJSON: string(questionsJSON)},
		{ToolID: "toolu_second", ToolName: "mcp__codelayer__ask_user_question", ToolInputJSON: string(questionsJSON)},
	}, nil)

	// First tool ID is already claimed by an existing pending question
	firstToolID := "toolu_first"
	mockStore.EXPECT().GetPendingQuestions(ctx, sessionID).Return([]*store.Question{
		{ID: "question-existing", ToolUseID: &firstToolID, Status: store.QuestionStatusPending},
	}, nil)

	// The new question should get the second tool ID (not the first, which is claimed)
	mockStore.EXPECT().CreateQuestion(ctx, gomock.Any()).DoAndReturn(func(ctx context.Context, q *store.Question) error {
		assert.NotNil(t, q.ToolUseID)
		assert.Equal(t, "toolu_second", *q.ToolUseID)
		return nil
	})

	mockEventBus.EXPECT().Publish(gomock.Any())
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)

	q, err := mgr.CreateQuestion(ctx, sessionID, questionsJSON)
	require.NoError(t, err)
	assert.NotNil(t, q.ToolUseID)
	assert.Equal(t, "toolu_second", *q.ToolUseID)
}

func TestManager_CreateQuestion_PendingQuestionsLookupError(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	sessionID := "test-session-qerr"
	questionsJSON := json.RawMessage(`{"questions":[]}`)

	mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
		ID:    sessionID,
		RunID: "test-run-qerr",
	}, nil)

	mockStore.EXPECT().GetPendingToolCalls(ctx, sessionID).Return([]*store.ConversationEvent{
		{ToolID: "toolu_abc", ToolName: "mcp__codelayer__ask_user_question", ToolInputJSON: string(questionsJSON)},
	}, nil)

	// GetPendingQuestions fails — should still proceed with matching (no dedup)
	mockStore.EXPECT().GetPendingQuestions(ctx, sessionID).Return(nil, fmt.Errorf("db error"))

	// Should still match the tool call (claimedToolIDs is empty due to error)
	mockStore.EXPECT().CreateQuestion(ctx, gomock.Any()).DoAndReturn(func(ctx context.Context, q *store.Question) error {
		assert.NotNil(t, q.ToolUseID)
		assert.Equal(t, "toolu_abc", *q.ToolUseID)
		return nil
	})

	mockEventBus.EXPECT().Publish(gomock.Any())
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)

	q, err := mgr.CreateQuestion(ctx, sessionID, questionsJSON)
	require.NoError(t, err)
	assert.NotNil(t, q.ToolUseID)
}

func TestManager_GetPendingQuestions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	mgr := NewManager(mockStore, mockEventBus)

	ctx := context.Background()

	expected := []*store.Question{
		{ID: "q-1", Status: store.QuestionStatusPending},
		{ID: "q-2", Status: store.QuestionStatusPending},
	}
	mockStore.EXPECT().GetPendingQuestions(ctx, "session-1").Return(expected, nil)

	got, err := mgr.GetPendingQuestions(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, expected, got)
}
