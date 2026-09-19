import { GoogleGenAI } from "@google/genai";

const FALLBACK_PLAN = topic => ({
  goal: `${topic}についてYouTube視聴者の反応を調査する`,
  queries: [topic],
  selectionPolicy: "関連性と動画の多様性を優先"
});

const cleanJson = text => {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((match ? match[1] : text).trim());
};

export class GeminiAnalyst {
  constructor(apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || "gemini-3.6-flash") {
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    this.model = model;
  }

  async json(prompt, fallback) {
    if (!this.client) return fallback;
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0.2 }
    });
    return cleanJson(response.text);
  }

  plan(topic) {
    return this.json(`あなたはYouTube調査エージェントです。調査テーマ「${topic}」について、日本語の検索語を1〜3個作成してください。\nJSON形式: {"goal":"...","queries":["..."],"selectionPolicy":"..."}`, FALLBACK_PLAN(topic));
  }

  analyze(topic, videos, comments) {
    const sample = comments.slice(0, 600).map(c => `[${c.videoTitle}] ${c.text}`).join("\n").slice(0, 90000);
    const fallback = buildFallbackAnalysis(topic, comments);
    return this.json(`テーマ「${topic}」のYouTubeコメント調査結果を分析してください。断定を避け、分析対象コメント内の傾向として日本語で回答してください。\n対象動画:${videos.map(v => v.title).join(" / ")}\nコメント:\n${sample}\nJSON形式:{"summary":"...","sentiment":{"positive":0,"neutral":0,"negative":0},"topics":[{"name":"...","detail":"..."}],"representativeComments":["..."],"gaps":["..."],"needsMoreResearch":false,"nextQuery":"..."}`, fallback);
  }
}

export function buildFallbackAnalysis(topic, comments) {
  const positiveWords = /良い|好き|最高|すごい|便利|面白い|期待|ありがとう/i;
  const negativeWords = /悪い|嫌い|最悪|高い|不安|問題|微妙|残念/i;
  let positive = 0, negative = 0;
  for (const c of comments) {
    if (positiveWords.test(c.text)) positive++;
    else if (negativeWords.test(c.text)) negative++;
  }
  const total = Math.max(comments.length, 1);
  const pos = Math.round(positive / total * 100);
  const neg = Math.round(negative / total * 100);
  return {
    summary: `${topic}について${comments.length}件のコメントを収集しました。Gemini APIを設定すると、論点を踏まえた詳細なAI分析を表示できます。`,
    sentiment: { positive: pos, neutral: 100 - pos - neg, negative: neg },
    topics: [{ name: "コメント全体", detail: "API未設定のため簡易集計を表示しています。" }],
    representativeComments: comments.sort((a, b) => b.likes - a.likes).slice(0, 3).map(c => c.text),
    gaps: [], needsMoreResearch: false, nextQuery: ""
  };
}
