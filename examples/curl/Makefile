
random_id = $(shell uuidgen)
HUMANLAYER_API_BASE = https://api.humanlayer.dev/humanlayer/v1

.PHONY: check-api-key
check-api-key:
	@if [ -z "${HUMANLAYER_API_KEY}" ]; then echo "missing or invalid parameters: HUMANLAYER_API_KEY"; exit 1; fi

.PHONY: check-jq
check-jq:
	@if ! command -v jq &> /dev/null; then echo "jq is not installed"; exit 1; fi

.PHONY: create-approval
create-approval: check-api-key check-jq
	curl -X POST $(HUMANLAYER_API_BASE)/function_calls \
		-H "Authorization: Bearer ${HUMANLAYER_API_KEY}" \
		-H "Content-Type: application/json" \
		-d '{ \
			"run_id": "curl-example", \
			"call_id": "$(random_id)", \
			"spec": { \
				"fn": "send_email", \
				"kwargs": { \
					"to": "user@example.com", \
					"subject": "Hello" \
				} \
			} \
		}' | jq .

check-approval: check-api-key check-jq
	curl -X GET $(HUMANLAYER_API_BASE)/function_calls/curl-example/$(random_id) \
		-H "Authorization: Bearer ${HUMANLAYER_API_KEY}" \
		-H "Content-Type: application/json" | jq .


.PHONY:
run-agent: check-api-key check-jq
	@$(MAKE) create-approval
	@$(MAKE) check-approval
	while [ "$(shell curl -X GET $(HUMANLAYER_API_BASE)/function_calls/curl-example/$(random_id) \
		-H "Authorization: Bearer ${HUMANLAYER_API_KEY}" \
		-H "Content-Type: application/json" | jq -r '.status.approved')" != "true" ]; do
		sleep 3
		echo "waiting for approval"
	done
	@echo "approval granted with comment $(shell curl -X GET $(HUMANLAYER_API_BASE)/function_calls/curl-example/$(random_id) \
		-H "Authorization: Bearer ${HUMANLAYER_API_KEY}" \
		-H "Content-Type: application/json" | jq -r '.status.comment')"
