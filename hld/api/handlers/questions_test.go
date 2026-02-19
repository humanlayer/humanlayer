package handlers_test

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/api/handlers"
	"github.com/humanlayer/humanlayer/hld/question"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"go.uber.org/mock/gomock"
)

func TestQuestionHandlers_ListQuestions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockQuestionManager := question.NewMockManager(ctrl)
	questionHandlers := handlers.NewQuestionHandlers(mockQuestionManager)
	router := setupTestRouter(t, nil, nil, questionHandlers, nil)

	t.Run("with sessionId filter", func(t *testing.T) {
		now := time.Now()
		answeredAt := now.Add(-1 * time.Minute)
		toolUseID := "toolu_123"

		questions := []*store.Question{
			{
				ID:            "q-1",
				SessionID:     "sess-1",
				RunID:         "run-1",
				Status:        store.QuestionStatusPending,
				QuestionsJSON: json.RawMessage(`{"questions":[{"question":"Which?","header":"Pick","options":[{"label":"A","description":"Opt A"}],"multiSelect":false}]}`),
				CreatedAt:     now.Add(-5 * time.Minute),
				ToolUseID:     &toolUseID,
			},
			{
				ID:            "q-2",
				SessionID:     "sess-1",
				RunID:         "run-1",
				Status:        store.QuestionStatusAnswered,
				QuestionsJSON: json.RawMessage(`{"questions":[{"question":"Color?","header":"Color","options":[{"label":"Red","description":"Red"}],"multiSelect":false}]}`),
				AnswersJSON:   json.RawMessage(`{"Color":"Red"}`),
				CreatedAt:     now.Add(-10 * time.Minute),
				AnsweredAt:    &answeredAt,
			},
		}

		mockQuestionManager.EXPECT().
			GetQuestionsBySession(gomock.Any(), "sess-1").
			Return(questions, nil)

		w := makeRequest(t, router, "GET", "/api/v1/questions?sessionId=sess-1", nil)

		var resp struct {
			Data []api.Question `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Len(t, resp.Data, 2)

		// Verify first question (pending)
		assert.Equal(t, "q-1", resp.Data[0].Id)
		assert.Equal(t, "sess-1", resp.Data[0].SessionId)
		assert.Equal(t, "run-1", resp.Data[0].RunId)
		assert.Equal(t, api.QuestionStatus("pending"), resp.Data[0].Status)
		assert.NotNil(t, resp.Data[0].QuestionsJson)
		assert.NotNil(t, resp.Data[0].ToolUseId)
		assert.Equal(t, "toolu_123", *resp.Data[0].ToolUseId)
		assert.Nil(t, resp.Data[0].AnswersJson)
		assert.Nil(t, resp.Data[0].AnsweredAt)

		// Verify second question (answered)
		assert.Equal(t, "q-2", resp.Data[1].Id)
		assert.Equal(t, api.QuestionStatus("answered"), resp.Data[1].Status)
		assert.NotNil(t, resp.Data[1].AnswersJson)
		assert.NotNil(t, resp.Data[1].AnsweredAt)
		assert.Nil(t, resp.Data[1].ToolUseId)
	})

	t.Run("without sessionId returns empty", func(t *testing.T) {
		w := makeRequest(t, router, "GET", "/api/v1/questions", nil)

		var resp struct {
			Data []api.Question `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Empty(t, resp.Data)
	})

	t.Run("error fetching questions", func(t *testing.T) {
		mockQuestionManager.EXPECT().
			GetQuestionsBySession(gomock.Any(), "sess-error").
			Return(nil, fmt.Errorf("database error"))

		w := makeRequest(t, router, "GET", "/api/v1/questions?sessionId=sess-error", nil)

		assertErrorResponse(t, w, "HLD-5001", "database error")
		assert.Equal(t, 500, w.Code)
	})
}

func TestQuestionHandlers_GetQuestion(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockQuestionManager := question.NewMockManager(ctrl)
	questionHandlers := handlers.NewQuestionHandlers(mockQuestionManager)
	router := setupTestRouter(t, nil, nil, questionHandlers, nil)

	t.Run("existing pending question", func(t *testing.T) {
		now := time.Now()
		toolUseID := "toolu_456"
		q := &store.Question{
			ID:            "q-1",
			SessionID:     "sess-1",
			RunID:         "run-1",
			Status:        store.QuestionStatusPending,
			QuestionsJSON: json.RawMessage(`{"questions":[{"question":"Which?","header":"Pick","options":[{"label":"A","description":"Opt A"}],"multiSelect":false}]}`),
			CreatedAt:     now,
			ToolUseID:     &toolUseID,
		}

		mockQuestionManager.EXPECT().
			GetQuestion(gomock.Any(), "q-1").
			Return(q, nil)

		w := makeRequest(t, router, "GET", "/api/v1/questions/q-1", nil)

		var resp struct {
			Data api.Question `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "q-1", resp.Data.Id)
		assert.Equal(t, "sess-1", resp.Data.SessionId)
		assert.Equal(t, "run-1", resp.Data.RunId)
		assert.Equal(t, api.QuestionStatus("pending"), resp.Data.Status)
		assert.NotNil(t, resp.Data.QuestionsJson)
		assert.NotNil(t, resp.Data.ToolUseId)
		assert.Equal(t, "toolu_456", *resp.Data.ToolUseId)
		assert.Nil(t, resp.Data.AnswersJson)
		assert.Nil(t, resp.Data.AnsweredAt)
	})

	t.Run("existing answered question with answers", func(t *testing.T) {
		now := time.Now()
		answeredAt := now.Add(-1 * time.Minute)
		q := &store.Question{
			ID:            "q-2",
			SessionID:     "sess-1",
			RunID:         "run-1",
			Status:        store.QuestionStatusAnswered,
			QuestionsJSON: json.RawMessage(`{"questions":[{"question":"Color?","header":"Color","options":[{"label":"Red","description":"Red"}],"multiSelect":false}]}`),
			AnswersJSON:   json.RawMessage(`{"Color":"Red"}`),
			CreatedAt:     now.Add(-5 * time.Minute),
			AnsweredAt:    &answeredAt,
		}

		mockQuestionManager.EXPECT().
			GetQuestion(gomock.Any(), "q-2").
			Return(q, nil)

		w := makeRequest(t, router, "GET", "/api/v1/questions/q-2", nil)

		var resp struct {
			Data api.Question `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "q-2", resp.Data.Id)
		assert.Equal(t, api.QuestionStatus("answered"), resp.Data.Status)
		assert.NotNil(t, resp.Data.AnswersJson)
		answersMap := *resp.Data.AnswersJson
		assert.Equal(t, "Red", answersMap["Color"])
		assert.NotNil(t, resp.Data.AnsweredAt)
	})

	t.Run("not found", func(t *testing.T) {
		mockQuestionManager.EXPECT().
			GetQuestion(gomock.Any(), "q-999").
			Return(nil, &store.NotFoundError{Type: "question", ID: "q-999"})

		w := makeRequest(t, router, "GET", "/api/v1/questions/q-999", nil)

		assertErrorResponse(t, w, "HLD-5002", "Question not found")
		assert.Equal(t, 404, w.Code)
	})

	t.Run("internal error", func(t *testing.T) {
		mockQuestionManager.EXPECT().
			GetQuestion(gomock.Any(), "q-err").
			Return(nil, fmt.Errorf("database connection lost"))

		w := makeRequest(t, router, "GET", "/api/v1/questions/q-err", nil)

		assertErrorResponse(t, w, "HLD-5001", "database connection lost")
		assert.Equal(t, 500, w.Code)
	})
}

func TestQuestionHandlers_AnswerQuestion(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockQuestionManager := question.NewMockManager(ctrl)
	questionHandlers := handlers.NewQuestionHandlers(mockQuestionManager)
	router := setupTestRouter(t, nil, nil, questionHandlers, nil)

	t.Run("answer with answers_json", func(t *testing.T) {
		answersJSON := map[string]interface{}{"q1": "A"}
		marshaledAnswers, _ := json.Marshal(answersJSON)

		mockQuestionManager.EXPECT().
			AnswerQuestion(gomock.Any(), "q-1", json.RawMessage(marshaledAnswers)).
			Return(nil)

		body := api.AnswerQuestionRequest{
			AnswersJson: &answersJSON,
		}
		w := makeRequest(t, router, "POST", "/api/v1/questions/q-1/answer", body)

		var resp api.AnswerQuestionResponse
		assertJSONResponse(t, w, 200, &resp)
		assert.True(t, resp.Data.Success)
	})

	t.Run("decline", func(t *testing.T) {
		declined := true

		mockQuestionManager.EXPECT().
			DeclineQuestion(gomock.Any(), "q-2").
			Return(nil)

		body := api.AnswerQuestionRequest{
			Declined: &declined,
		}
		w := makeRequest(t, router, "POST", "/api/v1/questions/q-2/answer", body)

		var resp api.AnswerQuestionResponse
		assertJSONResponse(t, w, 200, &resp)
		assert.True(t, resp.Data.Success)
	})

	t.Run("missing answers_json when not declining", func(t *testing.T) {
		body := api.AnswerQuestionRequest{}
		w := makeRequest(t, router, "POST", "/api/v1/questions/q-3/answer", body)

		assertErrorResponse(t, w, "HLD-5003", "answers_json is required when not declining")
		assert.Equal(t, 400, w.Code)
	})

	t.Run("not found", func(t *testing.T) {
		answersJSON := map[string]interface{}{"q1": "A"}
		marshaledAnswers, _ := json.Marshal(answersJSON)

		mockQuestionManager.EXPECT().
			AnswerQuestion(gomock.Any(), "q-404", json.RawMessage(marshaledAnswers)).
			Return(&store.NotFoundError{Type: "question", ID: "q-404"})

		body := api.AnswerQuestionRequest{
			AnswersJson: &answersJSON,
		}
		w := makeRequest(t, router, "POST", "/api/v1/questions/q-404/answer", body)

		assertErrorResponse(t, w, "HLD-5002", "Question not found")
		assert.Equal(t, 404, w.Code)
	})

	t.Run("already decided", func(t *testing.T) {
		answersJSON := map[string]interface{}{"q1": "A"}
		marshaledAnswers, _ := json.Marshal(answersJSON)

		mockQuestionManager.EXPECT().
			AnswerQuestion(gomock.Any(), "q-decided", json.RawMessage(marshaledAnswers)).
			Return(&store.AlreadyDecidedError{Type: "question", ID: "q-decided", Status: "answered"})

		body := api.AnswerQuestionRequest{
			AnswersJson: &answersJSON,
		}
		w := makeRequest(t, router, "POST", "/api/v1/questions/q-decided/answer", body)

		assertErrorResponse(t, w, "HLD-5004", "already decided")
		assert.Equal(t, 400, w.Code)
	})

	t.Run("internal error", func(t *testing.T) {
		answersJSON := map[string]interface{}{"q1": "A"}
		marshaledAnswers, _ := json.Marshal(answersJSON)

		mockQuestionManager.EXPECT().
			AnswerQuestion(gomock.Any(), "q-err", json.RawMessage(marshaledAnswers)).
			Return(fmt.Errorf("database connection lost"))

		body := api.AnswerQuestionRequest{
			AnswersJson: &answersJSON,
		}
		w := makeRequest(t, router, "POST", "/api/v1/questions/q-err/answer", body)

		assertErrorResponse(t, w, "HLD-5001", "database connection lost")
		assert.Equal(t, 500, w.Code)
	})
}

func TestQuestionHandlers_StoreQuestionToAPIMapping(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockQuestionManager := question.NewMockManager(ctrl)
	questionHandlers := handlers.NewQuestionHandlers(mockQuestionManager)
	router := setupTestRouter(t, nil, nil, questionHandlers, nil)

	t.Run("full mapping with all fields populated", func(t *testing.T) {
		now := time.Now()
		answeredAt := now.Add(-1 * time.Minute)
		toolUseID := "toolu_789"
		q := &store.Question{
			ID:            "q-full",
			SessionID:     "sess-1",
			RunID:         "run-1",
			Status:        store.QuestionStatusAnswered,
			QuestionsJSON: json.RawMessage(`{"questions":[{"question":"Which?"}]}`),
			AnswersJSON:   json.RawMessage(`{"answer":"A"}`),
			CreatedAt:     now,
			AnsweredAt:    &answeredAt,
			ToolUseID:     &toolUseID,
		}

		mockQuestionManager.EXPECT().
			GetQuestion(gomock.Any(), "q-full").
			Return(q, nil)

		w := makeRequest(t, router, "GET", "/api/v1/questions/q-full", nil)

		var resp struct {
			Data api.Question `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "q-full", resp.Data.Id)
		assert.Equal(t, "sess-1", resp.Data.SessionId)
		assert.Equal(t, "run-1", resp.Data.RunId)
		assert.Equal(t, api.QuestionStatus("answered"), resp.Data.Status)
		assert.NotNil(t, resp.Data.QuestionsJson)
		assert.NotNil(t, resp.Data.AnswersJson)
		assert.NotNil(t, resp.Data.AnsweredAt)
		assert.NotNil(t, resp.Data.ToolUseId)
		assert.Equal(t, "toolu_789", *resp.Data.ToolUseId)
	})

	t.Run("nil AnswersJSON maps to nil AnswersJson", func(t *testing.T) {
		q := &store.Question{
			ID:            "q-nil-answers",
			SessionID:     "sess-1",
			RunID:         "run-1",
			Status:        store.QuestionStatusPending,
			QuestionsJSON: json.RawMessage(`{"questions":[]}`),
			CreatedAt:     time.Now(),
		}

		mockQuestionManager.EXPECT().
			GetQuestion(gomock.Any(), "q-nil-answers").
			Return(q, nil)

		w := makeRequest(t, router, "GET", "/api/v1/questions/q-nil-answers", nil)

		var resp struct {
			Data api.Question `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Nil(t, resp.Data.AnswersJson)
		assert.Nil(t, resp.Data.ToolUseId)
		assert.Nil(t, resp.Data.AnsweredAt)
	})
}
