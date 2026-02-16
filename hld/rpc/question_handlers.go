package rpc

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/humanlayer/humanlayer/hld/question"
	"github.com/humanlayer/humanlayer/hld/store"
)

// QuestionHandlers provides RPC handlers for question management
type QuestionHandlers struct {
	questions question.Manager
}

// NewQuestionHandlers creates new question RPC handlers
func NewQuestionHandlers(questions question.Manager) *QuestionHandlers {
	return &QuestionHandlers{questions: questions}
}

// CreateQuestionRequest is the request for creating a question
type CreateQuestionRequest struct {
	SessionID     string          `json:"session_id"`
	QuestionsJSON json.RawMessage `json:"questions_json"`
}

// CreateQuestionResponse is the response for creating a question
type CreateQuestionResponse struct {
	QuestionID string `json:"question_id"`
}

// HandleCreateQuestion handles the createQuestion RPC method
func (h *QuestionHandlers) HandleCreateQuestion(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req CreateQuestionRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}
	if req.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}
	if req.QuestionsJSON == nil {
		return nil, fmt.Errorf("questions_json is required")
	}

	q, err := h.questions.CreateQuestion(ctx, req.SessionID, req.QuestionsJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to create question: %w", err)
	}

	return &CreateQuestionResponse{QuestionID: q.ID}, nil
}

// GetQuestionRequest is the request for getting a specific question
type GetQuestionRequest struct {
	QuestionID string `json:"question_id"`
}

// GetQuestionResponse is the response for getting a specific question
type GetQuestionResponse struct {
	Question *store.Question `json:"question"`
}

// HandleGetQuestion handles the getQuestion RPC method
func (h *QuestionHandlers) HandleGetQuestion(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req GetQuestionRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}
	if req.QuestionID == "" {
		return nil, fmt.Errorf("question_id is required")
	}

	q, err := h.questions.GetQuestion(ctx, req.QuestionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get question: %w", err)
	}

	return &GetQuestionResponse{Question: q}, nil
}

// AnswerQuestionRequest is the request for answering a question
type AnswerQuestionRequest struct {
	QuestionID  string          `json:"question_id"`
	AnswersJSON json.RawMessage `json:"answers_json,omitempty"`
	Declined    bool            `json:"declined,omitempty"`
}

// AnswerQuestionResponse is the response for answering a question
type AnswerQuestionResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// HandleAnswerQuestion handles the answerQuestion RPC method
func (h *QuestionHandlers) HandleAnswerQuestion(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req AnswerQuestionRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}
	if req.QuestionID == "" {
		return nil, fmt.Errorf("question_id is required")
	}

	var err error
	if req.Declined {
		err = h.questions.DeclineQuestion(ctx, req.QuestionID)
	} else {
		if req.AnswersJSON == nil {
			return nil, fmt.Errorf("answers_json is required when not declining")
		}
		err = h.questions.AnswerQuestion(ctx, req.QuestionID, req.AnswersJSON)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to answer question: %w", err)
	}
	return &AnswerQuestionResponse{Success: true}, nil
}

// Register registers all question handlers with the RPC server
func (h *QuestionHandlers) Register(server *Server) {
	server.Register("createQuestion", h.HandleCreateQuestion)
	server.Register("getQuestion", h.HandleGetQuestion)
	server.Register("answerQuestion", h.HandleAnswerQuestion)
}
