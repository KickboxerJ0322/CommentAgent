import { YouTubeClient } from "./youtube.js";
import { GeminiAnalyst } from "./gemini.js";

const event = (type, title, detail) => ({ type, title, detail, at: new Date().toISOString() });

export function createResearchAgent({ youtube = new YouTubeClient(), analyst = new GeminiAnalyst() } = {}) {
  return {
    async research(topic, { maxVideos = 6, maxCommentsPerVideo = 100, maxRounds = 2, onEvent } = {}) {
      const activity = [];
      const record = (type, title, detail) => {
        const item = event(type, title, detail);
        activity.push(item);
        onEvent?.(item);
      };
      record("goal", "調査を開始", topic);
      record("thinking", "調査計画を検討中", "検索語と調査範囲を組み立てています");
      const plan = await analyst.plan(topic);
      record("plan", "調査計画を作成", `${plan.queries.length}個の検索語を生成`);

      const videosById = new Map();
      const allComments = [];
      let queries = plan.queries?.filter(Boolean).slice(0, 3) || [topic];
      let analysis;

      for (let round = 1; round <= maxRounds; round++) {
        record("search", `検索 Round ${round}`, queries.join(" / "));
        for (const query of queries) {
          const found = await youtube.searchVideos(query, maxVideos);
          found.forEach(video => videosById.set(video.id, video));
        }

        const unprocessed = [...videosById.values()].filter(v => !v.processed).slice(0, maxVideos);
        record("select", `${unprocessed.length}本の動画を選択`, plan.selectionPolicy);
        record("collecting", "コメントを収集中", `${unprocessed.length}本の動画を順番に確認しています`);
        for (const video of unprocessed) {
          const comments = await youtube.getComments(video.id, maxCommentsPerVideo);
          video.processed = true;
          video.commentCount = comments.length;
          allComments.push(...comments.map(comment => ({ ...comment, videoId: video.id, videoTitle: video.title })));
        }
        record("collect", `${allComments.length}件を収集`, `${videosById.size}本を横断調査`);

        record("analyzing", "コメントを集計・分析中", "感情、論点、注目コメントを整理しています");
        analysis = await analyst.analyze(topic, [...videosById.values()], allComments);
        record("reflect", "分析結果を再評価", analysis.needsMoreResearch ? "情報不足を検出" : "十分な情報を収集");
        if (!analysis.needsMoreResearch || !analysis.nextQuery || round === maxRounds) break;
        queries = [analysis.nextQuery];
        record("replan", "追加調査を決定", analysis.nextQuery);
      }

      record("complete", "レポート完成", `${allComments.length}件のコメントを分析`);
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - 29);
      cutoff.setUTCHours(0, 0, 0, 0);
      const dailyMap = new Map(Array.from({ length: 30 }, (_, i) => {
        const day = new Date(cutoff);
        day.setUTCDate(day.getUTCDate() + i);
        return [day.toISOString().slice(0, 10), 0];
      }));
      for (const comment of allComments) {
        const day = String(comment.publishedAt || "").slice(0, 10);
        if (dailyMap.has(day)) dailyMap.set(day, dailyMap.get(day) + 1);
      }
      const topComments = [...allComments].sort((a, b) => b.likes - a.likes).slice(0, 8)
        .map(({ text, likes, publishedAt, videoTitle, videoId }) => ({ text, likes, publishedAt, videoTitle, videoId }));
      return {
        topic, plan, analysis, activity,
        stats: { videos: videosById.size, comments: allComments.length, rounds: activity.filter(a => a.type === "search").length },
        videos: [...videosById.values()].map(({ processed, ...video }) => video),
        charts: {
          dailyComments: [...dailyMap].map(([date, count]) => ({ date, count })),
          videoComments: [...videosById.values()].map(video => ({ title: video.title, count: video.commentCount || 0 })).sort((a, b) => b.count - a.count).slice(0, 8)
        },
        topComments,
        generatedAt: new Date().toISOString()
      };
    }
  };
}
