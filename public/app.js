const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
let activity = [];
let inspector = null;

function updateClearButton() { $("#clear-topic").classList.toggle("hidden", !$("#topic").value); }
$("#topic").addEventListener("input", updateClearButton);
$("#clear-topic").addEventListener("click", () => { $("#topic").value = ""; updateClearButton(); $("#topic").focus(); });
$("#conditions-toggle").addEventListener("click", () => {
  const open = $("#condition-bar").classList.toggle("hidden") === false;
  $("#conditions-toggle").setAttribute("aria-expanded", String(open));
  $("#conditions-toggle span").textContent = open ? "調査条件を閉じる" : "調査条件を設定";
  $("#conditions-toggle i").textContent = open ? "−" : "＋";
});
document.querySelectorAll(".examples button").forEach(button => button.addEventListener("click", () => { $("#topic").value = button.textContent; updateClearButton(); $("#topic").focus(); }));

function toggleActivity(show) {
  $("#activity-panel").classList.toggle("collapsed", !show);
  $("#activity-toggle").textContent = show ? "非表示" : "表示";
  $("#activity-toggle").setAttribute("aria-expanded", String(show));
}
$("#activity-toggle").addEventListener("click", () => toggleActivity($("#activity-panel").classList.contains("collapsed")));

document.querySelectorAll("[data-dialog]").forEach(button => button.addEventListener("click", async () => {
  const dialog = document.getElementById(button.dataset.dialog);
  dialog.showModal();
  if (dialog.id === "history-dialog") await loadHistory();
  if (dialog.id === "trending-dialog") await loadTrending();
}));
document.querySelectorAll(".dialog-close").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); }));

async function loadHistory() {
  $("#history-list").innerHTML = "<p>読み込み中...</p>";
  try {
    const response = await fetch("/api/history?limit=100");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    $("#history-list").innerHTML = data.items.length ? data.items.map(item => `<button class="history-card" data-history-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.topic)}</span><small>${new Date(item.generatedAt).toLocaleString("ja-JP")} · ${item.stats?.comments || 0}件</small><p>${escapeHtml(item.summary)}</p></button>`).join("") : "<p>保存された調査はまだありません。</p>";
  } catch (error) { $("#history-list").innerHTML = `<div class="error">${escapeHtml(error.message || "履歴を取得できませんでした。")}</div>`; }
}

$("#history-list").addEventListener("click", async event => {
  const card = event.target.closest("[data-history-id]"); if (!card) return;
  card.disabled = true;
  try {
    const response = await fetch(`/api/history/${encodeURIComponent(card.dataset.historyId)}`);
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    $("#history-dialog").close(); showResult(data);
  } catch (error) { alert(error.message); card.disabled = false; }
});

async function loadTrending(forceRefresh = false) {
  const refreshButton = $("#trending-refresh");
  refreshButton.disabled = true;
  refreshButton.textContent = forceRefresh ? "更新中..." : "読み込み中...";
  if (!forceRefresh) $("#trending-list").innerHTML = "<p>人気動画のコメントを集計中...</p>";
  try {
    const response = await fetch(forceRefresh ? "/api/trending?refresh=1" : "/api/trending", { cache:"no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    $("#trending-updated").textContent = `最終更新：${new Date(data.generatedAt).toLocaleString("ja-JP")}`;
    $("#trending-list").innerHTML = data.topComments.length ? data.topComments.map((comment, index) => `<article class="ranking-card"><b class="rank">${index + 1}</b><div><p>${escapeHtml(comment.text)}</p><footer>👍 ${comment.likes || 0} · <a href="${escapeHtml(comment.videoUrl)}" target="_blank" rel="noopener">${escapeHtml(comment.videoTitle)}</a></footer></div></article>`).join("") : "<p>表示できるコメントはありません。</p>";
  } catch (error) {
    $("#trending-list").innerHTML = `<div class="error">${escapeHtml(error.message || "取得できませんでした。")}</div>`;
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "最新情報に更新";
  }
}
$("#trending-refresh").addEventListener("click", () => loadTrending(true));

$("#result").addEventListener("submit", event => { if (!event.target.matches("#deepen-form")) return; event.preventDefault(); const detail = new FormData(event.target).get("detail")?.trim(); if (detail) runResearch(`${event.target.dataset.topic}：${detail}`); });
$("#research-form").addEventListener("submit", event => { event.preventDefault(); runResearch($("#topic").value.trim()); });

async function runResearch(topic) {
  if (!topic) return;
  $("#workspace").classList.remove("hidden"); $("#loading").classList.remove("hidden"); $("#result").classList.add("hidden"); toggleActivity(true);
  activity = [{ type:"goal", title:"調査リクエストを受信", detail:topic }]; inspector = null; renderActivity(); $("#workspace").scrollIntoView({ behavior:"smooth", block:"start" });
  try {
    const body = { topic, videoUrl:$("#video-url").value.trim(), periodDays:Number($("#period-days").value), maxVideos:Number($("#max-videos").value), maxCommentsPerVideo:Number($("#max-comments").value), allowAdditionalResearch:$("#additional").checked };
    const response = await fetch("/api/research/stream", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body) });
    if (!response.ok || !response.body) { const data = await response.json(); throw new Error(data.error || "調査に失敗しました。"); }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
    while (true) { const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream:!done }); const lines = buffer.split("\n"); buffer = lines.pop() || ""; for (const line of lines) if (line.trim()) handleStreamMessage(JSON.parse(line)); if (done) break; }
    if (buffer.trim()) handleStreamMessage(JSON.parse(buffer));
  } catch (error) { $("#result").innerHTML = `<div class="error"><b>調査を完了できませんでした</b><p>${escapeHtml(error.message)}</p></div>`; }
  finally { $("#loading").classList.add("hidden"); $("#result").classList.remove("hidden"); }
}

function handleStreamMessage(message) {
  if (message.type === "activity") { if (!(message.item.type === "goal" && activity[0]?.type === "goal")) activity.push(message.item); renderActivity(); }
  else if (message.type === "result") { activity = message.data.activity; inspector = message.data.inspector || null; renderActivity(); $("#result").innerHTML = reportHtml(message.data); toggleActivity(false); }
  else if (message.type === "error") throw new Error(message.error);
}

function renderActivity() { $("#activity-list").innerHTML = activityHtml(activity); $("#inspector-summary").innerHTML = inspectorHtml(inspector); $("#inspector-summary").classList.toggle("hidden", !inspector); $("#activity-list").lastElementChild?.scrollIntoView({ behavior:"smooth", block:"nearest" }); }
function showResult(data) { $("#workspace").classList.remove("hidden"); $("#loading").classList.add("hidden"); $("#result").classList.remove("hidden"); activity = data.activity || []; inspector = data.inspector || null; renderActivity(); toggleActivity(false); $("#result").innerHTML = reportHtml(data); $("#workspace").scrollIntoView({ behavior:"smooth", block:"start" }); }
function activityHtml(items) { const icons = { goal:"◎", thinking:"…", plan:"◇", search:"⌕", select:"✓", collecting:"↓", collect:"↓", analyzing:"◌", reflect:"◌", replan:"↻", complete:"✓" }; return items.map((item, index) => `<div class="activity-item ${index === items.length - 1 ? "active" : ""}"><div class="activity-icon">${icons[item.type] || "·"}</div><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`).join(""); }
function inspectorHtml(data) { if (!data) return ""; const duration=(Number(data.durationMs||0)/1000).toFixed(1); const decisions=(data.decisions||[]).map(item=>`<div class="decision"><small>${escapeHtml(item.stage)}</small><b>${escapeHtml(item.decision)}</b><p><span>理由</span>${escapeHtml(item.reason)}</p>${item.detail?`<p><span>内容</span>${escapeHtml(item.detail)}</p>`:""}</div>`).join(""); return `<div class="inspector-metrics"><div><b>${duration}s</b><span>処理時間</span></div><div><b>${data.usage?.searchQueries||0}</b><span>検索</span></div><div><b>${data.usage?.geminiCalls||0}</b><span>AI分析</span></div></div><details open><summary>判断と理由</summary>${decisions}</details><div class="stop-reason"><span>停止理由</span><b>${escapeHtml(data.stopReason||"")}</b></div><details><summary>実行情報</summary><dl><dt>Run ID</dt><dd>${escapeHtml(data.runId)}</dd><dt>上限</dt><dd>${data.limits?.maxRounds||0} rounds / ${data.limits?.maxVideos||0} videos / ${data.limits?.maxCommentsPerVideo||0} comments</dd></dl></details>`; }

function sentimentHtml(s = {}) { const p=Number(s.positive||0),n=Number(s.neutral||0),m=Number(s.negative||0); return `<div class="chart-card"><h3>コメントの感情傾向</h3><div class="sentiment-bar"><span class="positive" style="width:${p}%"></span><span class="neutral" style="width:${n}%"></span><span class="negative" style="width:${m}%"></span></div><div class="chart-legend"><span><i class="positive"></i>肯定 ${p}%</span><span><i class="neutral"></i>中立 ${n}%</span><span><i class="negative"></i>否定 ${m}%</span></div></div>`; }
function dailyChartHtml(items=[]) { const max=Math.max(...items.map(x=>x.count),1); return `<div class="chart-card"><h3>直近30日間の投稿数</h3><div class="daily-chart">${items.map((x,i)=>`<div class="day-bar-wrap" title="${x.date}: ${x.count}件"><div class="day-bar" style="height:${Math.max(x.count/max*100,x.count?5:1)}%"></div>${i%5===0?`<small>${x.date.slice(5).replace("-","/")}</small>`:""}</div>`).join("")}</div></div>`; }
function videoChartHtml(items=[]) { const max=Math.max(...items.map(x=>x.count),1); return `<div class="chart-card"><h3>動画別コメント数</h3><div class="rank-chart">${items.map(x=>`<div class="rank-row"><span title="${escapeHtml(x.title)}">${escapeHtml(x.title)}</span><div><i style="width:${x.count/max*100}%"></i></div><b>${x.count}</b></div>`).join("")}</div></div>`; }
function evidenceCard(item={}) { const link=item.url||item.videoUrl; return `<article class="evidence-card"><div><b>${escapeHtml(item.evidenceId||"")}</b><span>👍 ${item.likes||0}</span></div><p>${escapeHtml(item.text||"")}</p><footer>${escapeHtml(item.author||"")} · ${escapeHtml(item.videoTitle||"")}${link?`<a href="${escapeHtml(link)}" target="_blank" rel="noopener">YouTubeで確認 ↗</a>`:""}</footer></article>`; }
function findingsHtml(data) { const evidence=data.evidence||{}; const labels={positive:"肯定",neutral:"中立",negative:"否定",high:"高",medium:"中",low:"低"}; return (data.analysis?.findings||[]).map(f=>`<article class="finding"><div class="finding-head"><span class="tone ${escapeHtml(f.sentiment||"neutral")}">${labels[f.sentiment]||"中立"}</span><small>確度 ${labels[f.confidence]||"中"}</small></div><h4>${escapeHtml(f.claim)}</h4><div class="finding-evidence">${(f.evidenceIds||[]).map(id=>evidence[id]?evidenceCard(evidence[id]):"").join("")||"<p class=\"section-note\">対応する根拠コメントはありません。</p>"}</div></article>`).join(""); }
function reportHtml(data) { const a=data.analysis||{}; const comments=(data.topComments||[]).map(c=>evidenceCard(c)).join(""); const output=data.id?`<a class="report-output" href="/report.html?id=${encodeURIComponent(data.id)}" target="_blank" rel="noopener">レポートだけを表示 ↗</a>`:""; return `<div class="report-actions">${output}</div><div class="report-head"><div><p class="eyebrow">RESEARCH REPORT</p><h2>${escapeHtml(data.topic)}</h2></div><span class="meta">${new Date(data.generatedAt).toLocaleString("ja-JP")}</span></div><div class="stats"><div class="stat"><b>${data.stats.videos}</b><span>VIDEOS</span></div><div class="stat"><b>${data.stats.comments}</b><span>COMMENTS</span></div><div class="stat"><b>${data.stats.rounds}</b><span>ROUNDS</span></div></div><div class="charts-grid">${sentimentHtml(a.sentiment)}${dailyChartHtml(data.charts?.dailyComments)}${videoChartHtml(data.charts?.videoComments)}</div><p class="summary">${escapeHtml(a.summary)}</p><p class="report-caution">この結果は取得できたYouTube動画とコメントの分析であり、社会全体の意見を代表するものではありません。</p><h3>根拠付きの主な結論</h3><div class="findings">${findingsHtml(data)||"<p class=\"section-note\">根拠付きの結論を生成できませんでした。</p>"}</div><h3>主要な論点</h3><div class="topics">${(a.topics||[]).map(t=>`<div class="topic"><b>${escapeHtml(t.name)}</b><p>${escapeHtml(t.detail)}</p></div>`).join("")}</div><h3>注目を集めているコメント</h3><p class="section-note">いいね数の多い順に原文のまま掲載しています。リンクから元コメントを確認できます。</p><div class="top-comments">${comments||"<p>表示できるコメントはありません。</p>"}</div><h3>調査した動画</h3><div class="videos">${(data.videos||[]).map(v=>`<a class="video" href="${escapeHtml(v.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(v.thumbnail)}" alt=""><div><b>${escapeHtml(v.title)}</b><span>${escapeHtml(v.channel)} · ${v.commentCount||0} comments</span></div></a>`).join("")}</div><form id="deepen-form" class="deepen" data-topic="${escapeHtml(data.topic)}"><div><h3>このテーマを深掘り</h3><p>前回テーマを引き継いで別の視点から追加調査します。</p></div><div class="deepen-input"><input name="detail" maxlength="100" required placeholder="例：反対意見に絞って調べる"><button>深掘りする →</button></div></form>`; }

updateClearButton();
