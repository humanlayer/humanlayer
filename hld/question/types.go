package question

import (
	"context"
	"encoding/json"

	"github.com/humanlayer/humanlayer/hld/store"
)

// Manager defines the interface for managing questions
type Manager interface {
	CreateQuestion(ctx context.Context, sessionID string, questionsJSON json.RawMessage) (*store.Question, error)
	GetQuestion(ctx context.Context, id string) (*store.Question, error)
	GetPendingQuestions(ctx context.Context, sessionID string) ([]*store.Question, error)
	GetQuestionsBySession(ctx context.Context, sessionID string) ([]*store.Question, error)
	AnswerQuestion(ctx context.Context, id string, answersJSON json.RawMessage) error
	DeclineQuestion(ctx context.Context, id string) error
}
