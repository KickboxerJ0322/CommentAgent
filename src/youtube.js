const API_BASE = "https://www.googleapis.com/youtube/v3";

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

  async searchVideos(query, maxResults = 6) {
    const data = await this.request("search", {
      part: "snippet", type: "video", q: query, maxResults: String(maxResults),
      order: "relevance", relevanceLanguage: "ja", safeSearch: "moderate"
    });
    return (data.items || []).map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`
    }));
  }

  async getComments(videoId, maxResults = 100) {
    const comments = [];
    let pageToken;
    try {
      while (comments.length < maxResults) {
        const data = await this.request("commentThreads", {
          part: "snippet", videoId, maxResults: String(Math.min(100, maxResults - comments.length)),
          order: "relevance", textFormat: "plainText", ...(pageToken ? { pageToken } : {})
        });
        for (const item of data.items || []) {
          const c = item.snippet.topLevelComment.snippet;
          comments.push({ text: c.textDisplay, likes: c.likeCount || 0, publishedAt: c.publishedAt });
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
    } catch (error) {
      if ([403, 404].includes(error.status)) return [];
      throw error;
    }
    return comments;
  }
}

