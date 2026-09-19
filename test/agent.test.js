import test from "node:test";
import assert from "node:assert/strict";
import { createResearchAgent } from "../src/agent.js";
import { buildFallbackAnalysis } from "../src/gemini.js";
import { extractVideoId } from "../src/youtube.js";

test("extracts video ids from common YouTube URL formats", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractVideoId("https://youtu.be/dQw4w9WgXcQ?t=10"), "dQw4w9WgXcQ");
  assert.equal(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractVideoId("not-a-valid-video-id"), null);
});

test("agent researches a specified video directly", async () => {
  let searches = 0;
  const youtube = {
    async searchVideos() { searches++; return []; },
    async getVideo(id) { return { id, title:"Direct video", channel:"test", url:"https://youtube.com", thumbnail:"" }; },
    async getComments() { return [{ text:"direct comment", likes:3, publishedAt:new Date().toISOString() }]; }
  };
  const analyst = {
    async plan() { return { queries:["unused"], selectionPolicy:"direct" }; },
    async analyze() { return { summary:"ok", sentiment:{positive:100,neutral:0,negative:0}, topics:[], needsMoreResearch:false }; }
  };
  const result = await createResearchAgent({ youtube, analyst }).research("test", { videoUrl:"https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(searches, 0);
  assert.equal(result.stats.videos, 1);
  assert.equal(result.conditions.videoUrl, "https://youtu.be/dQw4w9WgXcQ");
});

test("agent performs an additional research round when analysis finds a gap", async () => {
  let analyses = 0;
  const youtube = {
    async searchVideos(query) { return [{ id: query, title: query, channel: "test", url: "https://example.com", thumbnail: "" }]; },
    async getComments(id) { return [{ text: `${id} is useful`, likes: 1 }]; }
  };
  const analyst = {
    async plan() { return { goal: "test", queries: ["first"], selectionPolicy: "diversity" }; },
    async analyze() { analyses++; return { summary:"ok", sentiment:{positive:50,neutral:50,negative:0}, topics:[], needsMoreResearch: analyses === 1, nextQuery:"second" }; }
  };
  const result = await createResearchAgent({ youtube, analyst }).research("AI", { maxVideos: 2, maxRounds: 2 });
  assert.equal(result.stats.rounds, 2);
  assert.equal(result.stats.videos, 2);
  assert.equal(result.stats.comments, 2);
  assert.ok(result.activity.some(item => item.type === "replan"));
});

test("fallback sentiment percentages total 100", () => {
  const result = buildFallbackAnalysis("test", [{text:"最高です",likes:2},{text:"問題がある",likes:1},{text:"普通",likes:0}]);
  assert.equal(result.sentiment.positive + result.sentiment.neutral + result.sentiment.negative, 100);
});

test("agent emits progress and builds report chart data", async () => {
  const progress = [];
  const publishedAt = new Date().toISOString();
  const youtube = {
    async searchVideos() { return [{ id:"v1", title:"Video", channel:"test", url:"https://example.com", thumbnail:"" }]; },
    async getComments() { return [{ text:"原文コメント", likes:42, publishedAt }]; }
  };
  const analyst = {
    async plan() { return { queries:["query"], selectionPolicy:"relevance" }; },
    async analyze() { return { summary:"ok", sentiment:{positive:60,neutral:30,negative:10}, topics:[], needsMoreResearch:false }; }
  };
  const result = await createResearchAgent({ youtube, analyst }).research("test", { maxRounds:1, onEvent:item => progress.push(item) });
  assert.ok(progress.some(item => item.type === "thinking"));
  assert.ok(progress.some(item => item.type === "analyzing"));
  assert.equal(result.topComments[0].text, "原文コメント");
  assert.equal(result.topComments[0].likes, 42);
  assert.equal(result.charts.dailyComments.reduce((sum, item) => sum + item.count, 0), 1);
  assert.equal(result.charts.videoComments[0].count, 1);
});
