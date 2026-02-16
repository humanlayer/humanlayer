package question

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

type manager struct {
	store    store.ConversationStore
	eventBus bus.EventBus
}

func NewManager(store store.ConversationStore, eventBus bus.EventBus) Manager {
	return &manager{store: store, eventBus: eventBus}
}

func (m *manager) CreateQuestion(ctx context.Context, sessionID string, questionsJSON json.RawMessage, toolUseID string) (*store.Question, error) {
	session, err := m.store.GetSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	q := &store.Question{
		ID:            "question-" + uuid.New().String(),
		SessionID:     sessionID,
		RunID:         session.RunID,
		ToolUseID:     &toolUseID,
		Status:        store.QuestionStatusPending,
		QuestionsJSON: questionsJSON,
		CreatedAt:     time.Now(),
	}

	if err := m.store.CreateQuestion(ctx, q); err != nil {
		return nil, fmt.Errorf("failed to store question: %w", err)
	}

	m.publishNewQuestionEvent(q)

	// Update session status to waiting_input
	status := store.SessionStatusWaitingInput
	now := time.Now()
	updates := store.SessionUpdate{
		Status:         &status,
		LastActivityAt: &now,
	}
	if err := m.store.UpdateSession(ctx, session.ID, updates); err != nil {
		slog.Warn("failed to update session status", "error", err, "session_id", session.ID)
	}

	slog.Info("created question",
		"question_id", q.ID,
		"session_id", sessionID,
		"tool_use_id", toolUseID)

	return q, nil
}

func (m *manager) GetQuestion(ctx context.Context, id string) (*store.Question, error) {
	return m.store.GetQuestion(ctx, id)
}

func (m *manager) GetPendingQuestions(ctx context.Context, sessionID string) ([]*store.Question, error) {
	return m.store.GetPendingQuestions(ctx, sessionID)
}

func (m *manager) AnswerQuestion(ctx context.Context, id string, answersJSON json.RawMessage) error {
	if err := m.store.AnswerQuestion(ctx, id, store.QuestionStatusAnswered, answersJSON); err != nil {
		return fmt.Errorf("failed to answer question: %w", err)
	}

	q, err := m.store.GetQuestion(ctx, id)
	if err != nil {
		slog.Warn("failed to get question after answering", "error", err, "question_id", id)
		return nil
	}

	m.publishQuestionAnsweredEvent(q)
	m.updateSessionStatusToRunning(ctx, q.SessionID)

	return nil
}

func (m *manager) DeclineQuestion(ctx context.Context, id string) error {
	if err := m.store.AnswerQuestion(ctx, id, store.QuestionStatusDeclined, nil); err != nil {
		return fmt.Errorf("failed to decline question: %w", err)
	}

	q, err := m.store.GetQuestion(ctx, id)
	if err != nil {
		slog.Warn("failed to get question after declining", "error", err, "question_id", id)
		return nil
	}

	m.publishQuestionAnsweredEvent(q)
	m.updateSessionStatusToRunning(ctx, q.SessionID)

	return nil
}

func (m *manager) updateSessionStatusToRunning(ctx context.Context, sessionID string) {
	status := store.SessionStatusRunning
	now := time.Now()
	updates := store.SessionUpdate{
		Status:         &status,
		LastActivityAt: &now,
	}
	if err := m.store.UpdateSession(ctx, sessionID, updates); err != nil {
		slog.Warn("failed to update session status", "error", err, "session_id", sessionID)
	}
}

func (m *manager) publishNewQuestionEvent(q *store.Question) {
	if m.eventBus != nil {
		m.eventBus.Publish(bus.Event{
			Type:      bus.EventNewQuestion,
			Timestamp: time.Now(),
			Data: map[string]interface{}{
				"question_id": q.ID,
				"session_id":  q.SessionID,
			},
		})
	}
}

func (m *manager) publishQuestionAnsweredEvent(q *store.Question) {
	if m.eventBus != nil {
		data := map[string]interface{}{
			"question_id": q.ID,
			"session_id":  q.SessionID,
			"status":      string(q.Status),
		}
		if q.ToolUseID != nil {
			data["tool_use_id"] = *q.ToolUseID
		}
		m.eventBus.Publish(bus.Event{
			Type:      bus.EventQuestionAnswered,
			Timestamp: time.Now(),
			Data:      data,
		})
	}
}
