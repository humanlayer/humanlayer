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

// maxQuestionsJSONSize is the maximum allowed size for questions JSON payload (1MB)
const maxQuestionsJSONSize = 1 << 20

func (m *manager) CreateQuestion(ctx context.Context, sessionID string, questionsJSON json.RawMessage, toolUseID string) (*store.Question, error) {
	if len(questionsJSON) == 0 {
		return nil, fmt.Errorf("questions_json is required")
	}
	if len(questionsJSON) > maxQuestionsJSONSize {
		return nil, fmt.Errorf("questions_json exceeds maximum size of %d bytes", maxQuestionsJSONSize)
	}
	if !json.Valid(questionsJSON) {
		return nil, fmt.Errorf("questions_json is not valid JSON")
	}

	session, err := m.store.GetSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	var toolUseIDPtr *string
	if toolUseID != "" {
		toolUseIDPtr = &toolUseID
	}

	q := &store.Question{
		ID:            "question-" + uuid.New().String(),
		SessionID:     sessionID,
		RunID:         session.RunID,
		ToolUseID:     toolUseIDPtr,
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
		"tool_use_id", toolUseIDPtr)

	return q, nil
}

func (m *manager) GetQuestion(ctx context.Context, id string) (*store.Question, error) {
	return m.store.GetQuestion(ctx, id)
}

func (m *manager) GetPendingQuestions(ctx context.Context, sessionID string) ([]*store.Question, error) {
	return m.store.GetPendingQuestions(ctx, sessionID)
}

func (m *manager) GetQuestionsBySession(ctx context.Context, sessionID string) ([]*store.Question, error) {
	return m.store.GetQuestionsBySession(ctx, sessionID)
}

func (m *manager) AnswerQuestion(ctx context.Context, id string, answersJSON json.RawMessage) error {
	if err := m.store.AnswerQuestion(ctx, id, store.QuestionStatusAnswered, answersJSON); err != nil {
		return fmt.Errorf("failed to answer question: %w", err)
	}

	q, err := m.store.GetQuestion(ctx, id)
	if err != nil {
		slog.Error("failed to get question after answering", "error", err, "question_id", id)
		return fmt.Errorf("question answered but failed to retrieve updated state: %w", err)
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
		slog.Error("failed to get question after declining", "error", err, "question_id", id)
		return fmt.Errorf("question declined but failed to retrieve updated state: %w", err)
	}

	m.publishQuestionAnsweredEvent(q)
	m.updateSessionStatusToRunning(ctx, q.SessionID)

	return nil
}

func (m *manager) updateSessionStatusToRunning(ctx context.Context, sessionID string) {
	// Check if there are other pending questions or approvals before
	// transitioning to running — another pending item should keep the
	// session in waiting_input.
	pendingQuestions, qErr := m.store.GetPendingQuestions(ctx, sessionID)
	if qErr != nil {
		slog.Warn("failed to check pending questions", "error", qErr, "session_id", sessionID)
	}
	pendingApprovals, aErr := m.store.GetPendingApprovals(ctx, sessionID)
	if aErr != nil {
		slog.Warn("failed to check pending approvals", "error", aErr, "session_id", sessionID)
	}

	if len(pendingQuestions) > 0 || len(pendingApprovals) > 0 {
		// Other items still pending — keep status as waiting_input, just update activity
		now := time.Now()
		updates := store.SessionUpdate{
			LastActivityAt: &now,
		}
		if err := m.store.UpdateSession(ctx, sessionID, updates); err != nil {
			slog.Warn("failed to update session activity", "error", err, "session_id", sessionID)
		}
		return
	}

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
		m.eventBus.Publish(bus.Event{
			Type:      bus.EventQuestionAnswered,
			Timestamp: time.Now(),
			Data: map[string]interface{}{
				"question_id": q.ID,
				"session_id":  q.SessionID,
				"status":      string(q.Status),
			},
		})
	}
}
