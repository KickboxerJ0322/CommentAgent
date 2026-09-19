#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-jumpeicloud}"
LOCATION="${FIRESTORE_LOCATION:-asia-northeast1}"

gcloud config set project "$PROJECT_ID"
gcloud services enable firestore.googleapis.com

if ! gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcloud firestore databases create --database='(default)' --location="$LOCATION" --type=firestore-native
fi

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role="roles/datastore.user" \
  --condition=None

echo "Firestoreの準備が完了しました。"
