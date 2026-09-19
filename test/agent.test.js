import test from "node:test";
import assert from "node:assert/strict";
import { createResearchAgent } from "../src/agent.js";
import { buildFallbackAnalysis } from "../src/gemini.js";

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

