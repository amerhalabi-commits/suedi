(() => {
  const $ = (id) => document.getElementById(id);
  const board = $("board"), empty = $("empty"), text = $("text"), alias = $("alias");
  const chars = $("chars"), status = $("status"), send = $("send"), count = $("count");
  let cfg = { maxText: 280, maxAlias: 30 };
  let posts = [];
  let sort = "top";
  let lastJson = "";
  const cards = new Map(); // id -> element

  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.5 1.1 4.3 2.4h2c.8-1.3 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Något gick fel.");
    return data;
  }

  function ago(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return "nyss";
    if (s < 3600) return Math.floor(s / 60) + " min sedan";
    if (s < 86400) return Math.floor(s / 3600) + " h sedan";
    const d = Math.floor(s / 86400);
    return d === 1 ? "igår" : d + " dagar sedan";
  }

  // Fler likes -> större lapp. Logaritmiskt så att det inte exploderar.
  const scale = (likes) => Math.min(3.2, 1 + Math.log2(1 + likes) * 0.42);
  const lenFactor = (n) => (n > 180 ? 0.72 : n > 110 ? 0.8 : n > 60 ? 0.9 : 1);

  function build(p) {
    const el = document.createElement("article");
    el.className = "card c" + (p.color % 8);
    el.innerHTML = `<p class="txt"></p><div class="meta"><span class="who"></span><button class="flag" type="button" title="Anmäl olämpligt inlägg">Anmäl</button><button class="like" type="button">${HEART}<span class="n"></span></button></div>`;
    el.querySelector(".txt").textContent = p.text;
    el.querySelector(".like").addEventListener("click", () => like(p.id, el));
    const flag = el.querySelector(".flag");
    flag.addEventListener("click", () => report(p.id, flag));
    return el;
  }

  function update(el, p) {
    el.style.setProperty("--s", scale(p.likes).toFixed(3));
    el.style.setProperty("--len", lenFactor(p.text.length));
    el.querySelector(".who").textContent = `${p.alias} · ${ago(p.createdAt)}`;
    const btn = el.querySelector(".like");
    btn.classList.toggle("on", p.liked);
    btn.setAttribute("aria-pressed", p.liked);
    btn.setAttribute("aria-label", `${p.liked ? "Ta bort gilla" : "Gilla"} (${p.likes})`);
    el.querySelector(".n").textContent = p.likes;
  }

  function render() {
    const list = [...posts];
    if (sort === "new") list.sort((a, b) => b.createdAt - a.createdAt);
    else list.sort((a, b) => b.likes - a.likes || b.createdAt - a.createdAt);

    const seen = new Set();
    list.forEach((p, i) => {
      let el = cards.get(p.id);
      if (!el) { el = build(p); cards.set(p.id, el); }
      update(el, p);
      if (board.children[i] !== el) board.insertBefore(el, board.children[i] || null);
      seen.add(p.id);
    });
    for (const [id, el] of cards) if (!seen.has(id)) { el.remove(); cards.delete(id); }

    empty.hidden = posts.length > 0;
    count.textContent = posts.length ? `${posts.length} ${posts.length === 1 ? "åsikt" : "åsikter"}` : "";
  }

  async function load() {
    try {
      const data = await api("/api/posts");
      const json = JSON.stringify(data.posts);
      if (json !== lastJson) { lastJson = json; posts = data.posts; render(); }
    } catch { /* tyst – försöker igen */ }
  }

  async function like(id, el) {
    const p = posts.find((x) => x.id === id);
    if (!p) return;
    // optimistisk uppdatering
    p.liked = !p.liked; p.likes += p.liked ? 1 : -1;
    update(el, p);
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    try {
      const r = await api(`/api/posts/${id}/like`, { method: "POST" });
      p.liked = r.liked; p.likes = r.likes; update(el, p);
      lastJson = "";
    } catch (e) {
      p.liked = !p.liked; p.likes += p.liked ? 1 : -1; update(el, p);
      toast(e.message);
    }
  }

  async function report(id, btn) {
    if (!btn.classList.contains("confirm")) {
      btn.classList.add("confirm"); btn.textContent = "Säker? Anmäl";
      setTimeout(() => { btn.classList.remove("confirm"); btn.textContent = "Anmäl"; }, 4000);
      return;
    }
    try {
      await api(`/api/posts/${id}/report`, { method: "POST" });
      toast("Tack! Inlägget har anmälts till moderatorn.");
      btn.remove();
    } catch (e) { toast(e.message); }
  }

  function updateChars() {
    const n = text.value.trim().length;
    chars.textContent = cfg.maxText - n;
    chars.classList.toggle("over", n > cfg.maxText);
    send.disabled = n < 2 || n > cfg.maxText;
  }

  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (send.disabled) return;
    send.disabled = true;
    status.className = "status"; status.textContent = "Granskar…";
    try {
      const r = await api("/api/posts", { method: "POST", body: JSON.stringify({ alias: alias.value, text: text.value }) });
      status.className = "status " + (r.status === "approved" ? "ok" : "wait");
      status.textContent = r.message;
      text.value = "";
      try { localStorage.setItem("alias", alias.value); } catch {}
      load();
    } catch (err) {
      status.className = "status err"; status.textContent = err.message;
    } finally {
      updateChars();
    }
  });

  text.addEventListener("input", updateChars);
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("composer").requestSubmit();
  });

  document.querySelectorAll(".sort").forEach((b) => b.addEventListener("click", () => {
    sort = b.dataset.sort;
    document.querySelectorAll(".sort").forEach((x) => {
      x.classList.toggle("active", x === b); x.setAttribute("aria-selected", x === b);
    });
    render();
  }));

  (async () => {
    try { alias.value = localStorage.getItem("alias") || ""; } catch {}
    try {
      cfg = await api("/api/config");
      $("question").textContent = cfg.question;
      document.title = cfg.question + " – Åsiktstavlan";
      $("days").textContent = cfg.maxAgeDays;
      text.maxLength = cfg.maxText + 20;
      alias.maxLength = cfg.maxAlias;
    } catch {}
    updateChars();
    await load();
    setInterval(() => { if (!document.hidden) load(); }, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  })();
})();
