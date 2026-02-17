package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/question"
	"github.com/humanlayer/humanlayer/hld/store"
)

type QuestionHandlers struct {
	questionManager question.Manager
}

func NewQuestionHandlers(questionManager question.Manager) *QuestionHandlers {
	return &QuestionHandlers{questionManager: questionManager}
}

// ListQuestions returns questions filtered by session ID.
// Returns an empty list when no sessionId is provided.
func (h *QuestionHandlers) ListQuestions(ctx context.Context, req api.ListQuestionsRequestObject) (api.ListQuestionsResponseObject, error) {
	var questions []*store.Question
	var err error

	if req.Params.SessionId != nil {
		questions, err = h.questionManager.GetQuestionsBySession(ctx, *req.Params.SessionId)
	} else {
		slog.Warn("ListQuestions called without sessionId, returning empty list", "operation", "ListQuestions")
		questions = []*store.Question{}
	}

	if err != nil {
		slog.Error("Failed to list questions",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Params.SessionId,
			"operation", "ListQuestions",
		)
		return api.ListQuestions500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-5001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	apiQuestions := make([]api.Question, len(questions))
	for i, q := range questions {
		apiQuestions[i] = storeQuestionToAPI(q)
	}

	return api.ListQuestions200JSONResponse(api.QuestionsResponse{
		Data: apiQuestions,
	}), nil
}

// GetQuestion returns a single question by ID.
// Returns 404 if the question is not found.
func (h *QuestionHandlers) GetQuestion(ctx context.Context, req api.GetQuestionRequestObject) (api.GetQuestionResponseObject, error) {
	q, err := h.questionManager.GetQuestion(ctx, string(req.Id))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return api.GetQuestion404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-5002",
						Message: "Question not found",
					},
				},
			}, nil
		}
		slog.Error("Failed to get question",
			"error", fmt.Sprintf("%v", err),
			"question_id", req.Id,
			"operation", "GetQuestion",
		)
		return api.GetQuestion500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-5001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	return api.GetQuestion200JSONResponse(api.QuestionResponse{
		Data: storeQuestionToAPI(q),
	}), nil
}

// AnswerQuestion records an answer or decline for a question.
// Returns 400 if answers_json is missing when not declining,
// or if the question has already been answered.
func (h *QuestionHandlers) AnswerQuestion(ctx context.Context, req api.AnswerQuestionRequestObject) (api.AnswerQuestionResponseObject, error) {
	declined := req.Body.Declined != nil && *req.Body.Declined

	var err error
	if declined {
		err = h.questionManager.DeclineQuestion(ctx, string(req.Id))
	} else {
		if req.Body.AnswersJson == nil {
			return api.AnswerQuestion400JSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-5003",
					Message: "answers_json is required when not declining",
				},
			}, nil
		}
		answersJSON, marshalErr := json.Marshal(req.Body.AnswersJson)
		if marshalErr != nil {
			return api.AnswerQuestion400JSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-5003",
					Message: "invalid answers_json format",
				},
			}, nil
		}
		err = h.questionManager.AnswerQuestion(ctx, string(req.Id), answersJSON)
	}

	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return api.AnswerQuestion404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-5002",
						Message: "Question not found",
					},
				},
			}, nil
		}
		if errors.Is(err, store.ErrAlreadyDecided) {
			return api.AnswerQuestion400JSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-5004",
					Message: err.Error(),
				},
			}, nil
		}
		slog.Error("Failed to answer question",
			"error", fmt.Sprintf("%v", err),
			"question_id", req.Id,
			"operation", "AnswerQuestion",
		)
		return api.AnswerQuestion500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-5001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	resp := api.AnswerQuestionResponse{}
	resp.Data.Success = true
	return api.AnswerQuestion200JSONResponse(resp), nil
}

func storeQuestionToAPI(q *store.Question) api.Question {
	apiQ := api.Question{
		Id:        q.ID,
		SessionId: q.SessionID,
		RunId:     q.RunID,
		Status:    api.QuestionStatus(q.Status),
		CreatedAt: q.CreatedAt,
		ToolUseId: q.ToolUseID,
	}

	// Convert QuestionsJSON (json.RawMessage) to map
	if len(q.QuestionsJSON) > 0 {
		var questionsMap map[string]interface{}
		if err := json.Unmarshal(q.QuestionsJSON, &questionsMap); err != nil {
			slog.Warn("failed to unmarshal questions_json", "error", err, "question_id", q.ID)
		} else {
			apiQ.QuestionsJson = questionsMap
		}
	}

	// Convert AnswersJSON (json.RawMessage) to map
	if len(q.AnswersJSON) > 0 {
		var answersMap map[string]interface{}
		if err := json.Unmarshal(q.AnswersJSON, &answersMap); err != nil {
			slog.Warn("failed to unmarshal answers_json", "error", err, "question_id", q.ID)
		} else {
			apiQ.AnswersJson = &answersMap
		}
	}

	if q.AnsweredAt != nil {
		apiQ.AnsweredAt = q.AnsweredAt
	}

	return apiQ
}
