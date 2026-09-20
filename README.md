# コメントリサーチ（CommentAgent）

**YouTubeの「みんなの声」を、AIエージェントが横断調査するWebアプリ。**

知りたいテーマを入力すると、CommentAgentが調査計画を作り、YouTube動画を検索し、コメントを収集・分析します。分析対象が不足していると判断した場合は検索語を組み直して追加調査します。

## 主な機能

- Geminiによる調査計画の作成
- YouTube Data API v3による動画検索とコメント収集
- 複数動画を横断した感情・論点・代表意見の分析
- `Plan → Act → Observe → Reflect → Re-plan` のエージェントループ
- Agent Activityによる判断過程の可視化
- Agent Inspectorによる判断理由・停止理由・処理時間・API利用状況の可視化
- 結論と根拠コメントを対応付けた、出典リンク付きレポート
- レポート専用ページと印刷・PDF保存
- 調査条件（動画URL、期間、動画数、コメント数）の指定
- Firestoreによる過去100件の調査結果保存
- 追加調査をユーザーが許可／禁止できる制御
- Cloud Run対応のDocker構成

## 根拠付きレポート

分析対象の各コメントへ `C001` 形式の根拠IDを付与し、Geminiが生成する主な結論と対応付けます。レポートでは次を確認できます。

- 結論の肯定・中立・否定分類と確度
- 根拠となったコメント原文
- 投稿動画、投稿者、いいね数
- YouTube上の元コメントへのリンク
- 対象動画数、コメント数、調査ラウンド数

レポート上部の「レポートだけを表示」から専用ページを開けます。専用ページはURLで再表示でき、「印刷・PDF保存」にも対応します。

> 分析結果は取得できた動画・コメント内の傾向であり、社会全体の意見を代表するものではありません。

## Agent Inspector

調査画面のAgent Inspectorは、エージェントの動作だけでなく判断根拠を記録します。

- 計画時に生成した検索語と目的
- 動画の選定本数と選定方針
- 情報不足の判定と追加調査の理由
- 調査終了の理由
- Run ID、処理時間、検索回数、Gemini呼び出し回数
- 最大ラウンド・動画・コメント数の実行上限

## 構成

```mermaid
flowchart LR
  U[Browser] --> C[Cloud Run]
  C --> A[Agent Controller]
  A --> G[Gemini API]
  A --> Y[YouTube Data API]
  A --> F[Firestore]
  A --> I[Agent Inspector]
  A --> R[Evidence Report]
```

## ローカル起動

Node.js 20以上が必要です。

```bash
cp .env.example .env
# .envにYOUTUBE_API_KEYとGEMINI_API_KEYを設定
npm install
npm start
```

`http://localhost:8080` を開きます。`GEMINI_API_KEY`が未設定の場合、コメント収集後に簡易集計を表示します。

## テスト

```bash
npm test
```

## Google Cloudへデプロイ

このリポジトリの既定プロジェクトは `jumpeicloud`、リージョンは東京の `asia-northeast1` です。Google Cloud ConsoleでCloud Shellを開き、リポジトリを取得して作業します。

```bash
git clone https://github.com/KickboxerJ0322/CommentAgent.git
cd CommentAgent
gcloud config set project jumpeicloud
```

### 1. APIを有効化

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com youtube.googleapis.com
```

### Firestore（調査履歴）の初回準備

過去の調査を最大100件、Cloud Runの再起動後も保持するためFirestoreを使用します。初回だけ次を実行してください。

```bash
bash scripts/setup-firestore.sh
```

このスクリプトは既定データベースがない場合だけ東京リージョンに作成し、Cloud Runの既定実行サービスアカウントへ `roles/datastore.user` を付与します。既存データベースは変更しません。

### 2. Artifact RegistryとSecret Managerを準備

```bash
gcloud artifacts repositories create comment-agent --repository-format=docker --location=asia-northeast1
```

#### Secretの登録

APIキーをコマンド履歴やGitHubへ残さないよう、Cloud Shell上で値を非表示入力して登録します。

```bash
read -rsp 'YouTube API key: ' YT_KEY && echo
printf '%s' "$YT_KEY" | gcloud secrets create YOUTUBE_API_KEY --data-file=-
unset YT_KEY

read -rsp 'Gemini API key: ' GM_KEY && echo
printf '%s' "$GM_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=-
unset GM_KEY
```

すでにSecretが存在する場合は、`versions add` で新しいバージョンを登録します。

```bash
read -rsp 'YouTube API key: ' YT_KEY && echo
printf '%s' "$YT_KEY" | gcloud secrets versions add YOUTUBE_API_KEY --data-file=-
unset YT_KEY
```

Cloud BuildサービスアカウントとCloud Run実行サービスアカウントに、必要最小限のSecret Manager Secret Accessor権限を付与してください。

### 3. ビルド・デプロイ

```bash
bash scripts/deploy.sh
```

スクリプトはAPI有効化、Artifact Registry作成、Secret存在確認、Cloud Build、Cloud Run URL表示を順番に行います。既存のArtifact RegistryやSecretを削除・上書きしません。

継続デプロイを使う場合は、Google CloudコンソールのCloud Build「リポジトリ」から本リポジトリを接続し、`main`へのpushをトリガー、構成ファイルを `cloudbuild.yaml` に設定します。

## 環境変数

| 変数 | 必須 | 説明 |
|---|---:|---|
| `YOUTUBE_API_KEY` | Yes | YouTube Data API v3キー |
| `GEMINI_API_KEY` | Yes | Gemini APIキー |
| `GEMINI_MODEL` | No | 既定値 `gemini-3.6-flash` |
| `MAX_VIDEOS` | No | 1回に扱う最大動画数（既定6） |
| `MAX_COMMENTS_PER_VIDEO` | No | 動画ごとの最大コメント数（既定100） |
| `MAX_AGENT_ROUNDS` | No | 調査ラウンド上限（既定2、最大3） |

## セキュリティと制御

- APIキーはブラウザへ渡さず、Cloud Runの環境変数またはSecret Managerで管理します。
- 調査ラウンド・動画数・コメント数にはサーバー側上限があります。
- YouTube検索はSafeSearchを有効化しています。
- AIの総評は「取得したコメント内の傾向」であり、世論全体を表すものではありません。
- YouTubeコメントは命令ではなく信頼できない分析対象データとしてGeminiへ渡し、コメント内の指示には従わないよう明示しています。
- Geminiが返した根拠IDはサーバー側で実在するコメントIDだけに絞り込みます。
- レポート画面へ表示するコメント・タイトル等はHTMLエスケープします。
- 「話題のテーマ」はYouTube全体の完全なランキングではなく、日本の「人気の動画」最大12本から取得した公開コメントをいいね数順に並べた参考ランキングです。結果はAPI使用量を抑えるため10分間キャッシュします。

## ハッカソンでの新規開発範囲

元になったClaude Code Skill `YouTubeCommentSummary` の知見を活かしつつ、本リポジトリではWeb UI、HTTP API、Geminiエージェントループ、追加調査、可観測性、Cloud Run構成を新規開発しています。

## License

MIT
