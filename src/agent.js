import { YouTubeClient } from "./youtube.js";
import { GeminiAnalyst } from "./gemini.js";

const event = (type, title, detail) => ({ type, title, detail, at: new Date().toISOString() });

export function createResearchAgent({ youtube = new YouTubeClient(), analyst = new GeminiAnalyst() } = {}) {
  return {
    async research(topic, { maxVideos = 6, maxCommentsPerVideo = 100, maxRounds = 2 } = {}) {
      const activity = [event("goal", "調査を開始", topic)];
      const plan = await analyst.plan(topic);
      activity.push(event("plan", "調査計画を作成", `${plan.queries.length}個の検索語を生成`));

      const videosById = new Map();
      const allComments = [];
      let queries = plan.queries?.filter(Boolean).slice(0, 3) || [topic];
      let analysis;

      for (let round = 1; round <= maxRounds; round++) {
        activity.push(event("search", `検索 Round ${round}`, queries.join(" / ")));
        for (const query of queries) {
          const found = await youtube.searchVideos(query, maxVideos);
          found.forEach(video => videosById.set(video.id, video));
        }

        const unprocessed = [...videosById.values()].filter(v => !v.processed).slice(0, maxVideos);
        activity.push(event("select", `${unprocessed.length}本の動画を選択`, plan.selectionPolicy));
        for (const video of unprocessed) {
          const comments = await youtube.getComments(video.id, maxCommentsPerVideo);
          video.processed = true;
          video.commentCount = comments.length;
          allComments.push(...comments.map(comment => ({ ...comment, videoId: video.id, videoTitle: video.title })));
        }
        activity.push(event("collect", `${allComments.length}件を収集`, `${videosById.size}本を横断調査`));

        analysis = await analyst.analyze(topic, [...videosById.values()], allComments);
        activity.push(event("reflect", "分析結果を再評価", analysis.needsMoreResearch ? "情報不足を検出" : "十分な情報を収集"));
        if (!analysis.needsMoreResearch || !analysis.nextQuery || round === maxRounds) break;
        queries = [analysis.nextQuery];
        activity.push(event("replan", "追加調査を決定", analysis.nextQuery));
      }

      activity.push(event("complete", "レポート完成", `${allComments.length}件のコメントを分析`));
      return {
        topic, plan, analysis, activity,
        stats: { videos: videosById.size, comments: allComments.length, rounds: activity.filter(a => a.type === "search").length },
        videos: [...videosById.values()].map(({ processed, ...video }) => video),
        generatedAt: new Date().toISOString()
      };
    }
  };
}

