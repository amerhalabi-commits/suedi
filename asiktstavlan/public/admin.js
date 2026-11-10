(() => {
  const $ = (id) => document.getElementById(id);
  let pw = "";
  try { pw = sessionStorage.getItem("pw") || ""; } catch {}
  let tab = "pending";

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { "content-type": "application/json", authorization: "Bearer " + pw } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || "Fel"); e.status = res.status; throw e; }
    return data;
  }

  const fmt = (ts) => new Date(ts).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

  function row(p) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `<p class="t"></p><div class="m"></div><div class="r" hidden></div><div class="acts"></div>`;
    el.querySelector(".t").textContent = p.text;
    el.querySelector(".m").textContent = `${p.alias} · ${fmt(p.createdAt)} · ${p.likes} likes · ${p.reports} anmälningar`;
    if (p.reason) { const r = el.querySelector(".r"); r.hidden = false; r.textContent = p.reason; }
    const acts = el.querySelector(".acts");
    const add = (label, cls, action) => {
      const b = document.createElement("button");
      b.className = "btn " + cls; b.textContent = label; b.type = "button";
      b.addEventListener("click", async () => {
        if (action === "delete" && !b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Säker? Radera"; return; }
        b.disabled = true;
        try { await api(`/api/admin/posts/${p.id}`, { method: "POST", body: JSON.stringify({ action }) }); el.remove(); refresh(); }
        catch (e) { $("err").textContent = e.message; b.disabled = false; }
      });
      acts.append(b);
    };
    if (p.status !== "approved") add("Godkänn", "ok", "approve");
    if (p.status !== "rejected") add(p.status === "approved" ? "Dölj" : "Avvisa", "no", "reject");
    add("Radera", "del", "delete");
    return el;
  }

  async function refresh() {
    try {
      const data = await api("/api/admin/posts?status=" + tab);
      $("err").textContent = "";
      $("login").hidden = true; $("panel").hidden = false; $("logout").hidden = false;
      for (const s of ["pending", "approved", "rejected"]) $("n-" + s).textContent = `(${data.counts[s] || 0})`;
      const list = $("list"); list.replaceChildren(...data.posts.map(row));
      $("none").hidden = data.posts.length > 0;
    } catch (e) {
      if (e.status === 401 || e.status === 429 || e.status === 503) {
        $("login").hidden = false; $("panel").hidden = true; $("logout").hidden = true;
        if (pw) $("err").textContent = e.message;
        pw = ""; try { sessionStorage.removeItem("pw"); } catch {}
      } else $("err").textContent = e.message;
    }
  }

  $("login").addEventListener("submit", (e) => {
    e.preventDefault();
    pw = $("pw").value;
    try { sessionStorage.setItem("pw", pw); } catch {}
    refresh();
  });
  $("logout").addEventListener("click", () => { pw = ""; try { sessionStorage.removeItem("pw"); } catch {} location.reload(); });
  document.querySelectorAll(".tabs .sort").forEach((b) => b.addEventListener("click", () => {
    tab = b.dataset.s;
    document.querySelectorAll(".tabs .sort").forEach((x) => x.classList.toggle("active", x === b));
    refresh();
  }));

  if (pw) refresh();
  setInterval(() => { if (pw && !document.hidden) refresh(); }, 15000);
})();
