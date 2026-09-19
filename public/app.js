const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));

document.querySelectorAll(".examples button").forEach(button => button.addEventListener("click", () => {
  $("#topic").value = button.textContent;
  $("#topic").focus();
}));

$("#research-form").addEventListener("submit", async event => {
  event.preventDefault();
  const topic = $("#topic").value.trim();
  if (!topic) return;
  $("#workspace").classList.remove("hidden");
  $("#loading").classList.remove("hidden");
  $("#result").classList.add("hidden");
  $("#activity-list").innerHTML = activityHtml([{type:"goal",title:"調査リクエストを受信",detail:topic}]);
  $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const response = await fetch("/api/research", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ topic, allowAdditionalResearch:$("#additional").checked }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "調査に失敗しました。");
    $("#activity-list").innerHTML = activityHtml(data.activity);
    $("#result").innerHTML = reportHtml(data);
  } catch (error) {
    $("#result").innerHTML = `<div class="error"><b>調査を完了できませんでした</b><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    $("#loading").classList.add("hidden");
    $("#result").classList.remove("hidden");
  }
});

function activityHtml(items) {
  const icons = {goal:"◎",plan:"◇",search:"⌕",select:"✓",collect:"↓",reflect:"◌",replan:"↻",complete:"✓"};
  return items.map(item => `<div class="activity-item"><div class="activity-icon">${icons[item.type] || "·"}</div><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`).join("");
}

function reportHtml(data) {
  const a = data.analysis || {}, s = a.sentiment || {};
  return `<div class="report-head"><div><p class="eyebrow">RESEARCH REPORT</p><h2>${escapeHtml(data.topic)}</h2></div><span class="meta">${new Date(data.generatedAt).toLocaleString("ja-JP")}</span></div>
  <div class="stats"><div class="stat"><b>${data.stats.videos}</b><span>VIDEOS</span></div><div class="stat"><b>${data.stats.comments}</b><span>COMMENTS</span></div><div class="stat"><b>${data.stats.rounds}</b><span>ROUNDS</span></div></div>
  <div class="sentiment"><div>😊<b>${s.positive ?? 0}%</b><small>肯定的</small></div><div>😐<b>${s.neutral ?? 0}%</b><small>中立</small></div><div>😟<b>${s.negative ?? 0}%</b><small>否定的</small></div></div>
  <p class="summary">${escapeHtml(a.summary)}</p>
  <h3>主要な論点</h3><div class="topics">${(a.topics || []).map(t => `<div class="topic"><b>${escapeHtml(t.name)}</b><p>${escapeHtml(t.detail)}</p></div>`).join("")}</div>
  <h3>調査した動画</h3><div class="videos">${data.videos.map(v => `<a class="video" href="${escapeHtml(v.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(v.thumbnail)}" alt=""><div><b>${escapeHtml(v.title)}</b><span>${escapeHtml(v.channel)} · ${v.commentCount || 0} comments</span></div></a>`).join("")}</div>`;
}

