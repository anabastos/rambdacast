SHELL := /bin/bash

ENV_FILE ?= .env
API_URL ?= http://localhost:8081
API_KEY ?=
TITLE ?= Untitled Stream

.PHONY: help health playback live-create live-current live-end create current end

help:
	@printf '%s\n' \
		'make health                  Verifica se a API esta saudavel' \
		'make live-create TITLE="..." Cria uma live e mostra a stream key' \
		'make live-current            Mostra a live ativa' \
		'make live-end                Finaliza a live ativa' \
		'make playback                Mostra os dados publicos de playback' \
		'make watch-url               Mostra a URL do player no navegador'

health:
	@curl --fail-with-body --silent --show-error "$(API_URL)/health"

playback:
	@curl --fail-with-body --silent --show-error "$(API_URL)/playback"

live-create:
	@set -a; test -f "$(ENV_FILE)" && source <(tr -d '\r' < "$(ENV_FILE)"); set +a; \
		api_key="$${API_KEY:-$${INGEST_API_KEY:-$(API_KEY)}}"; \
		test -n "$$api_key" || { echo "API_KEY nao informado (use .env ou API_KEY=...)" >&2; exit 1; }; \
		payload=$$(node -e 'console.log(JSON.stringify({title: process.argv[1]}))' "$(TITLE)"); \
		curl --fail-with-body --silent --show-error \
			-X POST "$(API_URL)/ingest/create" \
			-H "x-api-key: $$api_key" \
			-H 'Content-Type: application/json' \
			-d "$$payload"

live-current:
	@set -a; test -f "$(ENV_FILE)" && source <(tr -d '\r' < "$(ENV_FILE)"); set +a; \
		api_key="$${API_KEY:-$${INGEST_API_KEY:-$(API_KEY)}}"; \
		test -n "$$api_key" || { echo "API_KEY nao informado (use .env ou API_KEY=...)" >&2; exit 1; }; \
		curl --fail-with-body --silent --show-error \
			"$(API_URL)/ingest/current" \
			-H "x-api-key: $$api_key"

live-end:
	@set -a; test -f "$(ENV_FILE)" && source <(tr -d '\r' < "$(ENV_FILE)"); set +a; \
		api_key="$${API_KEY:-$${INGEST_API_KEY:-$(API_KEY)}}"; \
		test -n "$$api_key" || { echo "API_KEY nao informado (use .env ou API_KEY=...)" >&2; exit 1; }; \
		curl --fail-with-body --silent --show-error \
			-X POST "$(API_URL)/ingest/end" \
			-H "x-api-key: $$api_key"

watch-url:
	@printf '%s/watch\n' "$(API_URL)"

create: live-create
current: live-current
end: live-end