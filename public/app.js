const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const HISTORY_KEY = "comment-agent-history-v1";
let history = loadHistory();
let activity = [];

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(data) {
  history = [{ id: crypto.randomUUID(), ...data }, ...history.filter(item => item.topic !== data.topic)].slice(0, 12);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { history = history.slice(0, 5); }
  renderHistory();
}

function renderHistory() {
  $("#history").classList.toggle("hidden", history.length === 0);
  $("#history-list").innerHTML = history.map(item => `<button class="history-card" data-history-id="${item.id}"><span>${escapeHtml(item.topic)}</span><small>${new Date(item.generatedAt).toLocaleString("ja-JP")} · ${item.stats.comments} comments</small></button>`).join("");
}

function updateClearButton() { $("#clear-topic").classList.toggle("hidden", !$("#topic").value); }
$("#topic").addEventListener("input", updateClearButton);
$("#clear-topic").addEventListener("click", () => { $("#topic").value = ""; updateClearButton(); $("#topic").focus(); });
$("#clear-history").addEventListener("click", () => { if (confirm("調査履歴をすべて消去しますか？")) { history = []; localStorage.removeItem(HISTORY_KEY); renderHistory(); } });

document.querySelectorAll(".examples button").forEach(button => button.addEventListener("click", () => {
  $("#topic").value = button.textContent; updateClearButton(); $("#topic").focus();
}));

$("#history-list").addEventListener("click", event => {
  const card = event.target.closest("[data-history-id]");
  const data = card && history.find(item => item.id === card.dataset.historyId);
  if (data) showResult(data);
});

$("#result").addEventListener("submit", event => {
  if (!event.target.matches("#deepen-form")) return;
  event.preventDefault();
  const detail = new FormData(event.target).get("detail")?.trim();
  if (detail) runResearch(`${event.target.dataset.topic}：${detail}`);
});

$("#research-form").addEventListener("submit", event => { event.preventDefault(); runResearch($("#topic").value.trim()); });

async function runResearch(topic) {
  if (!topic) return;
  $("#workspace").classList.remove("hidden");
  $("#loading").classList.remove("hidden");
  $("#result").classList.add("hidden");
  activity = [{ type:"goal", title:"調査リクエストを受信", detail:topic }];
  renderActivity();
  $("#workspace").scrollIntoView({ behavior:"smooth", block:"start" });
  try {
    const response = await fetch("/api/research/stream", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ topic, allowAdditionalResearch:$("#additional").checked }) });
    if (!response.ok || !response.body) {
      const data = await response.json();
      throw new Error(data.error || "調査に失敗しました。");
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream:!done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) handleStreamMessage(JSON.parse(line));
      if (done) break;
    }
    if (buffer.trim()) handleStreamMessage(JSON.parse(buffer));
  } catch (error) {
    $("#result").innerHTML = `<div class="error"><b>調査を完了できませんでした</b><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    $("#loading").classList.add("hidden");
    $("#result").classList.remove("hidden");
  }
}

function handleStreamMessage(message) {
  if (message.type === "activity") {
    if (!(message.item.type === "goal" && activity[0]?.type === "goal")) activity.push(message.item);
    renderActivity();
  } else if (message.type === "result") {
    activity = message.data.activity; renderActivity(); saveHistory(message.data);
    $("#result").innerHTML = reportHtml(message.data);
  } else if (message.type === "error") throw new Error(message.error);
}

function renderActivity() {
  $("#activity-list").innerHTML = activityHtml(activity);
  $("#activity-list").lastElementChild?.scrollIntoView({ behavior:"smooth", block:"nearest" });
}

function showResult(data) {
  $("#workspace").classList.remove("hidden"); $("#loading").classList.add("hidden"); $("#result").classList.remove("hidden");
  activity = data.activity || []; renderActivity(); $("#result").innerHTML = reportHtml(data);
  $("#workspace").scrollIntoView({ behavior:"smooth", block:"start" });
}

function activityHtml(items) {
  const icons = { goal:"◎", thinking:"…", plan:"◇", search:"⌕", select:"✓", collecting:"↓", collect:"↓", analyzing:"◌", reflect:"◌", replan:"↻", complete:"✓" };
  return items.map((item, index) => `<div class="activity-item ${index === items.length - 1 ? "active" : ""}"><div class="activity-icon">${icons[item.type] || "·"}</div><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`).join("");
}

function sentimentHtml(sentiment = {}) {
  const positive = Number(sentiment.positive || 0), neutral = Number(sentiment.neutral || 0), negative = Number(sentiment.negative || 0);
  return `<div class="chart-card"><h3>コメントの感情傾向</h3><div class="sentiment-bar" aria-label="肯定${positive}% 中立${neutral}% 否定${negative}%"><span class="positive" style="width:${positive}%"></span><span class="neutral" style="width:${neutral}%"></span><span class="negative" style="width:${negative}%"></span></div><div class="chart-legend"><span><i class="positive"></i>肯定 ${positive}%</span><span><i class="neutral"></i>中立 ${neutral}%</span><span><i class="negative"></i>否定 ${negative}%</span></div></div>`;
}

function dailyChartHtml(items = []) {
  const max = Math.max(...items.map(item => item.count), 1);
  return `<div class="chart-card"><h3>直近30日間のコメント投稿時期</h3><p class="chart-note">今回取得したコメントの投稿日別件数</p><div class="daily-chart">${items.map((item, index) => `<div class="day-bar-wrap" title="${item.date}: ${item.count}件"><div class="day-bar" style="height:${Math.max(item.count / max * 100, item.count ? 5 : 1)}%"></div>${index % 5 === 0 ? `<small>${item.date.slice(5).replace("-", "/")}</small>` : ""}</div>`).join("")}</div></div>`;
}

function videoChartHtml(items = []) {
  const max = Math.max(...items.map(item => item.count), 1);
  return `<div class="chart-card"><h3>動画別の取得コメント数</h3><div class="rank-chart">${items.map(item => `<div class="rank-row"><span title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span><div><i style="width:${item.count / max * 100}%"></i></div><b>${item.count}</b></div>`).join("")}</div></div>`;
}

function reportHtml(data) {
  const a = data.analysis || {};
  const comments = (data.topComments || []).map(comment => `<blockquote><p>${escapeHtml(comment.text)}</p><footer>👍 ${comment.likes || 0} · ${escapeHtml(comment.videoTitle || "")}</footer></blockquote>`).join("");
  return `<div class="report-head"><div><p class="eyebrow">RESEARCH REPORT</p><h2>${escapeHtml(data.topic)}</h2></div><span class="meta">${new Date(data.generatedAt).toLocaleString("ja-JP")}</span></div>
  <div class="stats"><div class="stat"><b>${data.stats.videos}</b><span>VIDEOS</span></div><div class="stat"><b>${data.stats.comments}</b><span>COMMENTS</span></div><div class="stat"><b>${data.stats.rounds}</b><span>ROUNDS</span></div></div>
  <div class="charts-grid">${sentimentHtml(a.sentiment)}${dailyChartHtml(data.charts?.dailyComments)}${videoChartHtml(data.charts?.videoComments)}</div>
  <p class="summary">${escapeHtml(a.summary)}</p>
  <h3>主要な論点</h3><div class="topics">${(a.topics || []).map(t => `<div class="topic"><b>${escapeHtml(t.name)}</b><p>${escapeHtml(t.detail)}</p></div>`).join("")}</div>
  <h3>注目を集めているコメント</h3><p class="section-note">取得したコメントを、いいね数の多い順に原文のまま掲載しています。</p><div class="top-comments">${comments || "<p>表示できるコメントはありません。</p>"}</div>
  <h3>調査した動画</h3><div class="videos">${data.videos.map(v => `<a class="video" href="${escapeHtml(v.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(v.thumbnail)}" alt=""><div><b>${escapeHtml(v.title)}</b><span>${escapeHtml(v.channel)} · ${v.commentCount || 0} comments</span></div></a>`).join("")}</div>
  <form id="deepen-form" class="deepen" data-topic="${escapeHtml(data.topic)}"><div><h3>このテーマを深掘り</h3><p>前回テーマを引き継いで、別の視点から追加調査します。</p></div><div class="deepen-input"><input name="detail" maxlength="100" required placeholder="例：反対意見に絞って調べる"><button>深掘りする →</button></div></form>`;
}

renderHistory();
updateClearButton();
