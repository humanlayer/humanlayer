package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQuestionCRUD(t *testing.T) {
	dbPath := testutil.DatabasePath(t, "sqlite-question-crud")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	// Create a session first
	session := &Session{
		ID:              "test-session",
		RunID:           "test-run",
		ClaudeSessionID: "claude-session",
		Query:           "Test query",
		Model:           "sonnet",
		Status:          SessionStatusRunning,
		CreatedAt:       time.Now(),
		LastActivityAt:  time.Now(),
	}
	err = store.CreateSession(ctx, session)
	require.NoError(t, err)

	t.Run("CreateAndGetQuestion", func(t *testing.T) {
		toolUseID := "toolu_01ABC123"
		q := &Question{
			ID:            "question-1",
			SessionID:     session.ID,
			RunID:         session.RunID,
			ToolUseID:     &toolUseID,
			Status:        QuestionStatusPending,
			QuestionsJSON: json.RawMessage(`{"questions":[{"question":"Which approach?","header":"Approach","options":[{"label":"A","description":"Option A"}],"multiSelect":false}]}`),
			CreatedAt:     time.Now(),
		}

		err := store.CreateQuestion(ctx, q)
		require.NoError(t, err)

		// Get it back
		got, err := store.GetQuestion(ctx, "question-1")
		require.NoError(t, err)
		assert.Equal(t, q.ID, got.ID)
		assert.Equal(t, q.SessionID, got.SessionID)
		assert.Equal(t, q.RunID, got.RunID)
		assert.Equal(t, QuestionStatusPending, got.Status)
		assert.NotNil(t, got.ToolUseID)
		assert.Equal(t, toolUseID, *got.ToolUseID)
		assert.JSONEq(t, string(q.QuestionsJSON), string(got.QuestionsJSON))
		assert.Nil(t, got.AnsweredAt)
		assert.Empty(t, got.AnswersJSON)
	})

	t.Run("CreateQuestion_SecondPending", func(t *testing.T) {
		q := &Question{
			ID:            "question-nil-tool",
			SessionID:     session.ID,
			RunID:         session.RunID,
			Status:        QuestionStatusPending,
			QuestionsJSON: json.RawMessage(`{"questions":[]}`),
			CreatedAt:     time.Now(),
		}

		err := store.CreateQuestion(ctx, q)
		require.NoError(t, err)
	})

	t.Run("CreateQuestion_InvalidStatus", func(t *testing.T) {
		q := &Question{
			ID:            "question-bad-status",
			SessionID:     session.ID,
			RunID:         session.RunID,
			Status:        QuestionStatus("invalid"),
			QuestionsJSON: json.RawMessage(`{}`),
			CreatedAt:     time.Now(),
		}

		err := store.CreateQuestion(ctx, q)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid question status")
	})

	t.Run("GetQuestion_NotFound", func(t *testing.T) {
		got, err := store.GetQuestion(ctx, "non-existent")
		assert.Nil(t, got)
		assert.Error(t, err)

		var notFoundErr *NotFoundError
		assert.True(t, errors.As(err, &notFoundErr))
		assert.Equal(t, "question", notFoundErr.Type)
		assert.True(t, errors.Is(err, ErrNotFound))
	})

	t.Run("GetPendingQuestions", func(t *testing.T) {
		// question-1 should be pending
		pending, err := store.GetPendingQuestions(ctx, session.ID)
		require.NoError(t, err)
		// question-1 and question-nil-tool are both pending
		assert.Len(t, pending, 2)
	})

	t.Run("GetPendingQuestions_EmptySession", func(t *testing.T) {
		pending, err := store.GetPendingQuestions(ctx, "non-existent-session")
		require.NoError(t, err)
		assert.Empty(t, pending)
	})

	t.Run("AnswerQuestion", func(t *testing.T) {
		answersJSON := json.RawMessage(`{"Approach":"A"}`)
		err := store.AnswerQuestion(ctx, "question-1", QuestionStatusAnswered, answersJSON)
		require.NoError(t, err)

		got, err := store.GetQuestion(ctx, "question-1")
		require.NoError(t, err)
		assert.Equal(t, QuestionStatusAnswered, got.Status)
		assert.JSONEq(t, `{"Approach":"A"}`, string(got.AnswersJSON))
		assert.NotNil(t, got.AnsweredAt)
	})

	t.Run("AnswerQuestion_AlreadyDecided", func(t *testing.T) {
		err := store.AnswerQuestion(ctx, "question-1", QuestionStatusAnswered, json.RawMessage(`{}`))
		assert.Error(t, err)

		var alreadyDecidedErr *AlreadyDecidedError
		assert.True(t, errors.As(err, &alreadyDecidedErr))
		assert.Equal(t, "question-1", alreadyDecidedErr.ID)
		assert.Equal(t, string(QuestionStatusAnswered), alreadyDecidedErr.Status)
		assert.True(t, errors.Is(err, ErrAlreadyDecided))
	})

	t.Run("DeclineQuestion", func(t *testing.T) {
		err := store.AnswerQuestion(ctx, "question-nil-tool", QuestionStatusDeclined, nil)
		require.NoError(t, err)

		got, err := store.GetQuestion(ctx, "question-nil-tool")
		require.NoError(t, err)
		assert.Equal(t, QuestionStatusDeclined, got.Status)
		assert.NotNil(t, got.AnsweredAt)
	})

	t.Run("DeclineQuestion_AlreadyDeclined", func(t *testing.T) {
		err := store.AnswerQuestion(ctx, "question-nil-tool", QuestionStatusDeclined, nil)
		assert.Error(t, err)
		assert.True(t, errors.Is(err, ErrAlreadyDecided))
	})

	t.Run("AnswerQuestion_NotFound", func(t *testing.T) {
		err := store.AnswerQuestion(ctx, "non-existent", QuestionStatusAnswered, json.RawMessage(`{}`))
		assert.Error(t, err)
		assert.True(t, errors.Is(err, ErrNotFound))
	})

	t.Run("AnswerQuestion_InvalidStatus", func(t *testing.T) {
		err := store.AnswerQuestion(ctx, "question-1", QuestionStatus("invalid"), json.RawMessage(`{}`))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid answer status")
	})

	t.Run("GetPendingQuestions_AfterAnswering", func(t *testing.T) {
		// Both questions are now decided
		pending, err := store.GetPendingQuestions(ctx, session.ID)
		require.NoError(t, err)
		assert.Empty(t, pending)
	})
}
