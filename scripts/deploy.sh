#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-jumpeicloud}"
REGION="${REGION:-asia-northeast1}"
REPOSITORY="${REPOSITORY:-comment-agent}"
SERVICE="${SERVICE:-comment-agent}"

command -v gcloud >/dev/null 2>&1 || {
  echo "gcloud CLIが必要です。Google Cloud Shellで実行してください。" >&2
  exit 1
}

gcloud config set project "$PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  youtube.googleapis.com

if ! gcloud artifacts repositories describe "$REPOSITORY" \
  --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --description="CommentAgent container images"
fi

missing_secrets=()
for secret in YOUTUBE_API_KEY GEMINI_API_KEY; do
  if ! gcloud secrets describe "$secret" >/dev/null 2>&1; then
    missing_secrets+=("$secret")
  fi
done

if (( ${#missing_secrets[@]} > 0 )); then
  echo "Secret Managerに次のSecretを作成してから再実行してください:" >&2
  printf '  - %s\n' "${missing_secrets[@]}" >&2
  echo "READMEの『Secretの登録』を参照してください。" >&2
  exit 2
fi

gcloud builds submit \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --config=cloudbuild.yaml \
  --substitutions="_REGION=$REGION,_REPOSITORY=$REPOSITORY,_SERVICE=$SERVICE" \
  .

gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)'
