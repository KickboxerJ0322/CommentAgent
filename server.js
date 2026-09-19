import express from "express";
import { createResearchAgent } from "./src/agent.js";

const app = express();
const port = Number(process.env.PORT || 8080);

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static("public", { extensions: ["html"] }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.post("/api/research", async (req, res) => {
  const topic = String(req.body?.topic || "").trim();
  if (topic.length < 2 || topic.length > 200) {
    return res.status(400).json({ error: "調査テーマは2〜200文字で入力してください。" });
  }

  const options = {
    maxVideos: Math.min(Math.max(Number(req.body?.maxVideos || process.env.MAX_VIDEOS || 6), 1), 10),
    maxCommentsPerVideo: Math.min(Math.max(Number(process.env.MAX_COMMENTS_PER_VIDEO || 100), 10), 200),
    maxRounds: req.body?.allowAdditionalResearch === false
      ? 1
      : Math.min(Math.max(Number(process.env.MAX_AGENT_ROUNDS || 2), 1), 3)
  };

  try {
    const result = await createResearchAgent().research(topic, options);
    res.json(result);
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
    const result = await createResearchAgent().research(topic, {
      maxVideos: Math.min(Math.max(Number(req.body?.maxVideos || process.env.MAX_VIDEOS || 6), 1), 10),
      maxCommentsPerVideo: Math.min(Math.max(Number(process.env.MAX_COMMENTS_PER_VIDEO || 100), 10), 200),
      maxRounds: req.body?.allowAdditionalResearch === false ? 1 : Math.min(Math.max(Number(process.env.MAX_AGENT_ROUNDS || 2), 1), 3),
      onEvent: item => send({ type: "activity", item })
    });
    send({ type: "result", data: result });
  } catch (error) {
    console.error(error);
    send({ type: "error", error: error.publicMessage || "調査中にエラーが発生しました。時間をおいて再試行してください。" });
  } finally {
    res.end();
  }
});

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.listen(port, "0.0.0.0", () => console.log(`CommentAgent listening on ${port}`));
