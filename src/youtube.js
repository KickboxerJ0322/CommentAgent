const API_BASE = "https://www.googleapis.com/youtube/v3";

export function extractVideoId(input = "") {
  const value = String(input).trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || null;
    if (url.hostname.endsWith("youtube.com")) {
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) return parts[1] || null;
    }
  } catch {}
  return null;
}

function apiError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  return error;
}

export class YouTubeClient {
  constructor(apiKey = process.env.YOUTUBE_API_KEY, fetchImpl = fetch) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async request(path, params) {
    if (!this.apiKey) throw apiError("YOUTUBE_API_KEYが設定されていません。", 503);
    const url = new URL(`${API_BASE}/${path}`);
    url.search = new URLSearchParams({ ...params, key: this.apiKey }).toString();
    const response = await this.fetch(url);
    const data = await response.json();
    if (!response.ok) throw apiError(data.error?.message || "YouTube APIの呼び出しに失敗しました。", response.status);
    return data;
  }

  mapVideo(item) {
    const id = item.id?.videoId || item.id;
    return {
      id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      url: `https://www.youtube.com/watch?v=${id}`,
      views: Number(item.statistics?.viewCount || 0),
      likes: Number(item.statistics?.likeCount || 0)
    };
  }

  async searchVideos(query, maxResults = 6, { publishedAfter } = {}) {
    const data = await this.request("search", {
      part: "snippet", type: "video", q: query, maxResults: String(maxResults),
      order: "relevance", relevanceLanguage: "ja", safeSearch: "moderate",
      ...(publishedAfter ? { publishedAfter } : {})
    });
    return (data.items || []).map(item => this.mapVideo(item));
  }

  async getVideo(videoId) {
    const data = await this.request("videos", { part: "snippet,statistics", id: videoId });
    return data.items?.[0] ? this.mapVideo(data.items[0]) : null;
  }

  async getPopularVideos(maxResults = 10, regionCode = "JP") {
    const data = await this.request("videos", {
      part: "snippet,statistics", chart: "mostPopular", regionCode,
      maxResults: String(Math.min(maxResults, 50))
    });
    return (data.items || []).map(item => this.mapVideo(item));
  }

  async getComments(videoId, maxResults = 100, { publishedAfter } = {}) {
    const comments = [];
    let pageToken;
    try {
      while (comments.length < maxResults) {
        const data = await this.request("commentThreads", {
          part: "snippet", videoId, maxResults: String(Math.min(100, maxResults - comments.length)),
          order: publishedAfter ? "time" : "relevance", textFormat: "plainText", ...(pageToken ? { pageToken } : {})
        });
        for (const item of data.items || []) {
          const c = item.snippet.topLevelComment.snippet;
          if (!publishedAfter || c.publishedAt >= publishedAfter) {
            comments.push({ text: c.textDisplay, likes: c.likeCount || 0, publishedAt: c.publishedAt, author: c.authorDisplayName || "" });
          }
        }
        pageToken = data.nextPageToken;
        const oldest = data.items?.at(-1)?.snippet?.topLevelComment?.snippet?.publishedAt;
        if (!pageToken || (publishedAfter && oldest && oldest < publishedAfter)) break;
      }
    } catch (error) {
      if ([403, 404].includes(error.status)) return [];
      throw error;
    }
    return comments;
  }
}
