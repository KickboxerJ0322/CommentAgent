import { YouTubeClient, extractVideoId } from "./youtube.js";
import { GeminiAnalyst } from "./gemini.js";

const event = (type, title, detail) => ({ type, title, detail, at: new Date().toISOString() });

const makeRunId = () => `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function createResearchAgent({ youtube = new YouTubeClient(), analyst = new GeminiAnalyst() } = {}) {
  return {
    async research(topic, { maxVideos = 6, maxCommentsPerVideo = 100, maxRounds = 2, videoUrl = "", publishedAfter, onEvent } = {}) {
      const startedAt = new Date();
      const runId = makeRunId();
      const activity = [];
      const decisions = [];
      const record = (type, title, detail) => {
        const item = event(type, title, detail);
        activity.push(item);
        onEvent?.(item);
      };
      record("goal", "調査を開始", topic);
      record("thinking", "調査計画を検討中", videoUrl ? "指定された動画と調査範囲を確認しています" : "検索語と調査範囲を組み立てています");
      const plan = await analyst.plan(topic);
      const initialQuery = plan.queries?.find(Boolean) || topic;
      plan.queries = [initialQuery];
      record("plan", "調査計画を作成", "1個の検索語を生成");
      decisions.push({ stage: "計画", decision: "検索語を生成", reason: plan.goal || topic, detail: initialQuery });

      const videosById = new Map();
      const allComments = [];
      let queries = [initialQuery];
      let searchQueries = 0;
      let analysis;

      if (videoUrl) {
        const videoId = extractVideoId(videoUrl);
        if (!videoId) {
          const error = new Error("有効なYouTube動画URLを入力してください。");
          error.status = 400;
          error.publicMessage = error.message;
          throw error;
        }
        const video = await youtube.getVideo(videoId);
        if (!video) {
          const error = new Error("指定されたYouTube動画が見つかりません。");
          error.status = 404;
          error.publicMessage = error.message;
          throw error;
        }
        videosById.set(video.id, video);
        queries = [];
        maxRounds = 1;
        decisions.push({ stage: "対象選定", decision: "指定動画のみを調査", reason: "ユーザーが動画URLを指定", detail: video.title });
      }

      for (let round = 1; round <= maxRounds; round++) {
        record("search", videoUrl ? "指定動画を確認" : `検索 Round ${round}`, videoUrl || queries.join(" / "));
        for (const query of queries) {
          searchQueries++;
          const found = await youtube.searchVideos(query, maxVideos, { publishedAfter });
          found.forEach(video => videosById.set(video.id, video));
        }

        const unprocessed = [...videosById.values()].filter(v => !v.processed).slice(0, maxVideos);
        record("select", `${unprocessed.length}本の動画を選択`, plan.selectionPolicy);
        decisions.push({ stage: `Round ${round}`, decision: `${unprocessed.length}本を選択`, reason: plan.selectionPolicy || "テーマとの関連性", detail: unprocessed.map(v => v.title).join(" / ") });
        record("collecting", "コメントを収集中", `${unprocessed.length}本の動画を順番に確認しています`);
        for (const video of unprocessed) {
          const comments = await youtube.getComments(video.id, maxCommentsPerVideo, { publishedAfter });
          video.processed = true;
          video.commentCount = comments.length;
          const evidenceOffset = allComments.length;
          allComments.push(...comments.map((comment, index) => ({
            ...comment,
            evidenceId: `C${String(evidenceOffset + index + 1).padStart(3, "0")}`,
            videoId: video.id,
            videoTitle: video.title,
            videoUrl: video.url
          })));
        }
        record("collect", `${allComments.length}件を収集`, `${videosById.size}本を横断調査`);

        record("analyzing", "コメントを集計・分析中", "感情、論点、注目コメントを整理しています");
        analysis = await analyst.analyze(topic, [...videosById.values()], allComments);
        const validEvidenceIds = new Set(allComments.map(comment => comment.evidenceId));
        analysis.findings = (analysis.findings || []).map(finding => ({
          ...finding,
          evidenceIds: (finding.evidenceIds || []).filter(id => validEvidenceIds.has(id)).slice(0, 3)
        })).filter(finding => finding.claim);
        record("reflect", "分析結果を再評価", analysis.needsMoreResearch ? "情報不足を検出" : "十分な情報を収集");
        decisions.push({
          stage: `評価 ${round}`,
          decision: analysis.needsMoreResearch && analysis.nextQuery && round < maxRounds ? "追加調査" : "調査終了",
          reason: analysis.needsMoreResearch ? (analysis.gaps || []).join(" / ") || "情報不足を検出" : "必要な情報量に到達",
          detail: analysis.nextQuery || `${allComments.length}件を分析`
        });
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
        .map(({ evidenceId, id, text, likes, publishedAt, author, url, videoTitle, videoId, videoUrl }) => ({ evidenceId, id, text, likes, publishedAt, author, url, videoTitle, videoId, videoUrl }));
      const evidence = Object.fromEntries(allComments.map(({ evidenceId, id, text, likes, publishedAt, author, url, videoTitle, videoId, videoUrl }) => [evidenceId, { evidenceId, id, text, likes, publishedAt, author, url, videoTitle, videoId, videoUrl }]));
      const finishedAt = new Date();
      return {
        topic, plan, analysis, activity, evidence,
        inspector: {
          runId,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt - startedAt,
          decisions,
          limits: { maxRounds, maxVideos, maxCommentsPerVideo },
          usage: {
            searchQueries,
            analyzedVideos: videosById.size,
            analyzedComments: allComments.length,
            geminiCalls: 1 + activity.filter(item => item.type === "analyzing").length
          },
          stopReason: analysis?.needsMoreResearch && activity.filter(item => item.type === "search").length >= maxRounds ? "設定された最大ラウンド数に到達" : "必要な情報量に到達"
        },
        conditions: { videoUrl: videoUrl || "", publishedAfter: publishedAfter || null, maxVideos, maxCommentsPerVideo },
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
