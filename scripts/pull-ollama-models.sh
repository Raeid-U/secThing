#!/bin/sh
# Invoked with sh so Windows checkouts don't need an executable permission bit.
set -eu

if [ "${AI_MODE:-disabled}" != "local" ]; then
  printf '%s\n' "Skipping bundled model downloads: AI_MODE is not local."
  exit 0
fi

last_model=""
ensure_model() {
  role="$1"
  provider="$2"
  endpoint="$3"
  model="$4"
  if [ "$provider" != "ollama" ] || [ -z "$model" ]; then
    printf '%s\n' "Skipping $role model: no Ollama model configured."
    return
  fi
  if [ "${endpoint%/}" != "${OLLAMA_HOST%/}" ]; then
    printf '%s\n' "Skipping $role model: its endpoint is not the bundled Ollama service."
    return
  fi
  case "$model" in
    -*) printf '%s\n' "Invalid $role model name: $model" >&2; exit 1 ;;
  esac
  if [ "$model" = "$last_model" ]; then
    return
  fi
  if ollama show "$model" >/dev/null 2>&1; then
    printf '%s\n' "$role model is already available: $model"
  else
    printf '%s\n' "Pulling $role model: $model"
    if ! ollama pull "$model"; then
      printf '%s\n' "Failed to pull $role model: $model. Check the model name and registry connectivity, then rerun Compose." >&2
      exit 1
    fi
  fi
  last_model="$model"
}

ensure_model chat "${AI_CHAT_PROVIDER:-}" "${AI_CHAT_BASE_URL:-}" "${AI_CHAT_MODEL:-}"
ensure_model embedding "${AI_EMBEDDING_PROVIDER:-}" "${AI_EMBEDDING_BASE_URL:-}" "${AI_EMBEDDING_MODEL:-}"
printf '%s\n' "Configured bundled Ollama models are ready."
