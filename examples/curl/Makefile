random_id = curl-example-$(shell date +%s)
HUMANLAYER_API_BASE ?= https://api.humanlayer.dev/humanlayer/v1

.PHONY: check-api-key
check-api-key:
	@if [ -z "${HUMANLAYER_API_KEY}" ]; then echo "missing or invalid parameters: HUMANLAYER_API_KEY"; exit 1; fi

.PHONY: check-jq
check-jq:
	@if ! command -v jq &> /dev/null; then echo "jq is not installed"; exit 1; fi

.PHONY: test-large-context
test-large-context: check-api-key check-jq
	curl -s -X POST $(HUMANLAYER_API_BASE)/function_calls \
		-H "Authorization: Bearer ${HUMANLAYER_API_KEY}" \
		-H "Content-Type: application/json" \
		-d '{ \
			"run_id": "curl-example", \
			"call_id": "$(random_id)", \
			"spec": { \
				"fn": "send_email", \
				"kwargs": { \
					"to": "user@example.com", \
					"subject": "Hello", \
					"body": "This is a test email" \
				}, \
				"state": { \
					"large_array": $(shell python3 -c "import json; print(json.dumps([i for i in range(100000)]))") \
				} \
			} \
		}' | jq .

.PHONY: create-approval
create-approval: check-api-key check-jq
	@curl -s -X POST $(HUMANLAYER_API_BASE)/function_calls \
		-H "Authorization: Bearer ${HUMANLAYER_API_KEY}" \
		-H "Content-Type: application/json" \
		-d '{ \
			"run_id": "curl-example", \
			"call_id": "$(random_id)", \
			"spec": { \
				"fn": "send_email", \
				"kwargs": { \
					"to": "user@example.com", \
					"subject": "Hello", \
					"body": "This is a test email" \
				} \
			} \
		}' | jq .

.PHONY:
run-agent: check-api-key check-jq
	: creating approval
	@$(MAKE) create-approval
	: polling for approval status
	@while curl -s -X GET $(HUMANLAYER_API_BASE)/function_calls/$(random_id) \
		-H "Authorization: Bearer ${HUMANLAYER_API_KEY}" \
		-H "Content-Type: application/json" | jq -r '.status.approved' | grep -q null; do \
		sleep 3; \
		curl -s -X GET $(HUMANLAYER_API_BASE)/function_calls/$(random_id) \
			-H "Authorization: Bearer ${HUMANLAYER_API_KEY}" \
			-H "Content-Type: application/json" | jq -r '.status.approved'; \
	done
	: response received
	@curl -s -X GET $(HUMANLAYER_API_BASE)/function_calls/$(random_id) \
		-H "Authorization: Bearer ${HUMANLAYER_API_KEY}" \
		-H "Content-Type: application/json" | jq -r '.status'
