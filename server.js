import express from "express";
import { createResearchAgent } from "./src/agent.js";
import { YouTubeClient } from "./src/youtube.js";
import { getResearch, listResearch, saveResearch } from "./src/history.js";

const app = express();
const port = Number(process.env.PORT || 8080);

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static("public", { extensions: ["html"] }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

function researchOptions(body = {}, onEvent) {
  const periodDays = [0, 7, 30, 90, 365].includes(Number(body.periodDays)) ? Number(body.periodDays) : 30;
  const publishedAfter = periodDays ? new Date(Date.now() - periodDays * 86400000).toISOString() : undefined;
  return {
    videoUrl: String(body.videoUrl || "").trim(),
    publishedAfter,
    maxVideos: Math.min(Math.max(Number(body.maxVideos || process.env.MAX_VIDEOS || 6), 1), 10),
    maxCommentsPerVideo: Math.min(Math.max(Number(body.maxCommentsPerVideo || process.env.MAX_COMMENTS_PER_VIDEO || 60), 10), 200),
    maxRounds: body.allowAdditionalResearch === false ? 1 : Math.min(Math.max(Number(process.env.MAX_AGENT_ROUNDS || 2), 1), 3),
    onEvent
  };
}

app.post("/api/research", async (req, res) => {
  const topic = String(req.body?.topic || "").trim();
  if (topic.length < 2 || topic.length > 200) {
    return res.status(400).json({ error: "調査テーマは2〜200文字で入力してください。" });
  }

  const options = researchOptions(req.body);

  try {
    const result = await createResearchAgent().research(topic, options);
    const id = await saveResearch(result);
    res.json({ id, ...result });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({
      error: error.publicMessage || "調査中にエラーが発生しました。時間をおいて再試行してください。"
    });
  }
});

app.post("/api/research/stream", async (req, res) => {
  const topic = String(req.body?.topic || "").trim();
  if (topic.length < 2 || topic.length > 200) {
    return res.status(400).json({ error: "調査テーマは2〜200文字で入力してください。" });
  }
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.flushHeaders();
  const send = payload => res.write(`${JSON.stringify(payload)}\n`);
  try {
    const result = await createResearchAgent().research(topic, researchOptions(req.body, item => send({ type: "activity", item })));
    const id = await saveResearch(result);
    send({ type: "result", data: { id, ...result } });
  } catch (error) {
    console.error(error);
    send({ type: "error", error: error.publicMessage || "調査中にエラーが発生しました。時間をおいて再試行してください。" });
  } finally {
    res.end();
  }
});

app.get("/api/history", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 100);
  res.json({ items: await listResearch(limit) });
});

app.get("/api/history/:id", async (req, res) => {
  const result = await getResearch(req.params.id);
  if (!result) return res.status(404).json({ error: "調査結果が見つかりません。" });
  res.json(result);
});

const TRENDING_CATEGORIES = [
  { id: "politics_economy", label: "政治経済", query: "政治 経済 ニュース", description: "政治・政策・経済・金融に関する話題" },
  { id: "it", label: "IT", query: "IT テクノロジー AI デジタル", description: "AI・テクノロジー・デジタルに関する話題" },
  { id: "entertainment", label: "エンタメ", query: "エンタメ 芸能 映画 音楽", description: "芸能・映画・音楽などの話題" },
  { id: "sports", label: "スポーツ", query: "スポーツ 試合 選手", description: "スポーツ・試合・選手に関する話題" },
  { id: "life", label: "ライフ", query: "生活 健康 グルメ 暮らし", description: "生活・健康・食・暮らしに関する話題" }
];

let trendingCache;
app.get("/api/trending", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const forceRefresh = req.query.refresh === "1";
  if (!forceRefresh && trendingCache?.expiresAt > Date.now()) return res.json(trendingCache.data);
  try {
    const youtube = new YouTubeClient();
    const publishedAfter = new Date(Date.now() - 7 * 86400000).toISOString();
    const categories = await Promise.all(TRENDING_CATEGORIES.map(async category => {
      const videos = await youtube.searchVideos(category.query, 4, { publishedAfter });
      const commentGroups = await Promise.all(videos.map(async video => {
        const comments = await youtube.getComments(video.id, 20, { publishedAfter });
        return comments.map(comment => ({ ...comment, videoId: video.id, videoTitle: video.title, videoUrl: video.url }));
      }));
      const topComments = commentGroups.flat()
        .filter(comment => comment.text && comment.likes >= 0)
        .sort((a, b) => b.likes - a.likes || String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")))
        .slice(0, 5);
      return {
        id: category.id,
        label: category.label,
        description: category.description,
        sampledVideos: videos.length,
        topComments
      };
    }));
    const data = {
      categories,
      searchQueries: TRENDING_CATEGORIES.length,
      periodDays: 7,
      generatedAt: new Date().toISOString()
    };
    trendingCache = { data, expiresAt: Date.now() + 30 * 60 * 1000 };
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.publicMessage || "話題のコメントを取得できませんでした。" });
  }
});

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.listen(port, "0.0.0.0", () => console.log(`CommentAgent listening on ${port}`));
