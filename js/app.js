/* ============================================================
   Iosandros player companion — app logic (vanilla JS)

   Three pages render from static world data (window.KINGDOMS,
   window.HISTORY, etc. in data/data.js) — no API, no auth.

   Two pages (Character, Play Tracker) read per-character state
   from /api/state/<key>. Those require Cloudflare Access; until
   it's set up (and until Claude seeds your data) they show an
   empty state.

   CLAUDE: the bodies of renderCharacter() and renderTracker()
   are yours to fill in from the player's sheet. Everything else
   is shared scaffolding — leave it alone unless asked.
   ============================================================ */

// ---------- tiny DOM helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// ---------- per-character state (D1 via /api/state) ----------
async function fetchState(key) {
  try {
    const res = await fetch(`/api/state/${key}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null; // 401 not-signed-in / 404 not-set → "not ready"
    const body = await res.json();
    return body.value ?? null;
  } catch {
    return null; // offline or local preview with no backend
  }
}

async function saveState(key, value) {
  try {
    const res = await fetch(`/api/state/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- tab navigation ----------
function activateTab(name) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".panel").forEach((p) =>
    p.classList.toggle("active", p.dataset.panel === name)
  );
  document.dispatchEvent(new CustomEvent("tab:shown", { detail: name }));
}

function wireTabs() {
  $$(".tab").forEach((btn) =>
    btn.addEventListener("click", () => activateTab(btn.dataset.tab))
  );
}

// ============================================================
//  BAKED-IN WORLD PAGES (shared across all player sites)
// ============================================================

function kingdomCard(k, isTerritory) {
  const dir = (window.KINGDOM_DIRECTIONS || {})[k.name];
  const meta = el("div", { class: "k-meta" });
  if (k.capital && k.capital !== "None")
    meta.append(el("span", {}, `Capital: ${k.capital}`));
  if (k.pop) meta.append(el("span", {}, `Pop: ${k.pop}`));
  if (dir) meta.append(el("span", {}, dir));

  const card = el(
    "div",
    { class: "kingdom-card" },
    el("div", { class: "k-name" }, k.name),
    el("div", { class: "k-house" }, isTerritory ? k.house : `House ${k.house}`),
    meta,
    el("div", { class: "k-desc" }, k.desc)
  );
  return card;
}

function renderKingdoms() {
  const grid = $("#kingdoms-grid");
  const tgrid = $("#territories-grid");
  if (grid && Array.isArray(window.KINGDOMS))
    grid.replaceChildren(...window.KINGDOMS.map((k) => kingdomCard(k, false)));
  if (tgrid && Array.isArray(window.TERRITORIES))
    tgrid.replaceChildren(...window.TERRITORIES.map((t) => kingdomCard(t, true)));
}

function renderHistory() {
  const tl = $("#history-timeline");
  if (!tl || !Array.isArray(window.HISTORY)) return;
  tl.replaceChildren(
    ...window.HISTORY.map((h) => {
      const entry = el(
        "div",
        { class: "timeline-entry" },
        el("div", { class: "t-year" }, h.year),
        el("div", { class: "t-title" }, h.title),
        el("div", { class: "t-body" }, h.body)
      );
      return entry;
    })
  );
}

function initMap() {
  const container = $("#mapContainer");
  const img = $("#mapImg");
  if (!container || !img) return;

  let pinPos = { x: 0.5, y: 0.5 };
  let pinDragging = false;

  const pin = el("div", { class: "map-pin" });
  container.appendChild(pin);

  const updatePin = () => {
    pin.style.left = (pinPos.x * 100) + "%";
    pin.style.top  = (pinPos.y * 100) + "%";
  };

  fetchState("mapPin").then((saved) => {
    if (saved && typeof saved.x === "number") pinPos = saved;
    updatePin();
  });

  updatePin();

  const getPos = (clientX, clientY) => {
    const r = container.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (clientY - r.top)  / r.height)),
    };
  };

  pin.addEventListener("mousedown",  (e) => { pinDragging = true; e.preventDefault(); });
  pin.addEventListener("touchstart", (e) => { pinDragging = true; }, { passive: true });

  window.addEventListener("mousemove", (e) => {
    if (!pinDragging) return;
    pinPos = getPos(e.clientX, e.clientY);
    updatePin();
  });

  window.addEventListener("mouseup", () => {
    if (pinDragging) saveState("mapPin", pinPos);
    pinDragging = false;
  });

  window.addEventListener("touchmove", (e) => {
    if (!pinDragging) return;
    const t = e.touches[0];
    pinPos = getPos(t.clientX, t.clientY);
    updatePin();
  }, { passive: true });

  window.addEventListener("touchend", () => {
    if (pinDragging) saveState("mapPin", pinPos);
    pinDragging = false;
  });
}

// ============================================================
//  PERSONAL PAGES (Claude fills these in per character)
// ============================================================

function renderCharacter() {
  const empty = $("#character-empty");
  const content = $("#character-content");
  const data = window.CHARACTER;

  if (!data) {
    if (empty) empty.hidden = false;
    if (content) content.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  if (content) content.hidden = false;

  const sign = (n) => (n >= 0 ? "+" : "") + n;

  const statCard = (label, a) =>
    el("div", { class: "char-stat" },
      el("div", { class: "char-stat-label" }, label),
      el("div", { class: "char-stat-score" }, a.score),
      el("div", { class: "char-stat-mod" }, sign(a.mod)),
      el("div", { class: "char-stat-save" }, "Save " + sign(a.save))
    );

  const skillBlock = (label, group) =>
    el("div", { class: "char-skill-group" },
      el("div", { class: "char-skill-label" }, label),
      ...Object.entries(group).map(([name, val]) =>
        el("div", { class: "char-skill-row" },
          el("span", {}, name),
          el("span", { class: "char-skill-val" }, sign(val))
        )
      )
    );

  const { name, level, class: cls, subclass, background, fightingStyle,
          origin, age, born, height, weight, ac, maxHp,
          attributes: a, skills, abilities, backgroundAbilities,
          equipment, inventory, backstory } = data;

  content.replaceChildren(
    el("div", { class: "char-header" },
      el("div", { class: "char-name" }, name),
      el("div", { class: "char-meta" }, `Level ${level} ${cls} (${subclass})  ·  ${background}  ·  ${fightingStyle} style`),
      el("div", { class: "char-meta" }, `${origin}  ·  Age ${age} (born ${born})  ·  ${height},  ${weight}`),
      el("div", { class: "char-tags" },
        el("span", { class: "char-tag" }, `AC ${ac}`),
        el("span", { class: "char-tag" }, `HP ${maxHp}`)
      )
    ),

    el("h2", {}, "Attributes"),
    el("div", { class: "char-stats" },
      statCard("STR", a.str), statCard("DEX", a.dex), statCard("CON", a.con),
      statCard("INT", a.int), statCard("WIS", a.wis), statCard("CHA", a.cha)
    ),

    el("h2", {}, "Skills"),
    el("div", { class: "char-skills" },
      skillBlock("Strength",     skills.str),
      skillBlock("Dexterity",    skills.dex),
      skillBlock("Intelligence", skills.int),
      skillBlock("Wisdom",       skills.wis),
      skillBlock("Charisma",     skills.cha)
    ),

    el("h2", {}, "Abilities"),
    el("div", { class: "char-abilities" },
      ...abilities.map(ab =>
        el("div", { class: "kingdom-card" },
          el("div", { class: "k-name" }, ab.name),
          el("div", { class: "k-desc" }, ab.desc)
        )
      )
    ),

    el("h2", {}, "Background Abilities"),
    el("div", { class: "kingdom-card" },
      el("div", { class: "k-name" }, "Knight of the Order — Grand Strategy"),
      el("ul", { class: "char-list" },
        ...backgroundAbilities.map(b => el("li", {}, b))
      )
    ),

    el("h2", {}, "Equipment & Inventory"),
    el("div", { class: "char-two-col" },
      el("div", { class: "kingdom-card" },
        el("div", { class: "k-name" }, "Equipment"),
        el("ul", { class: "char-list" }, ...equipment.map(e => el("li", {}, e)))
      ),
      el("div", { class: "kingdom-card" },
        el("div", { class: "k-name" }, "Inventory"),
        el("ul", { class: "char-list" }, ...inventory.map(i => el("li", {}, i)))
      )
    ),

    el("h2", {}, "Backstory"),
    el("div", { class: "kingdom-card" },
      el("p", { class: "k-desc", style: "margin:0" }, backstory)
    )
  );
}

async function renderTracker() {
  const empty = $("#tracker-empty");
  const content = $("#tracker-content");
  let data = await fetchState("tracker");

  if (!data) {
    if (empty) empty.hidden = false;
    if (content) content.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  if (content) content.hidden = false;

  const save = async (next) => { data = next; await saveState("tracker", next); };

  const hpDisplay = el("span", { class: "hp-current" }, data.hp);
  const hpCard = el("div", { class: "kingdom-card tracker-card" },
    el("div", { class: "k-name" }, "Hit Points"),
    el("div", { class: "hp-row" },
      el("button", { class: "btn hp-btn", onclick: async () => {
        const next = { ...data, hp: Math.max(0, data.hp - 1) };
        hpDisplay.textContent = next.hp;
        await save(next);
      }}, "−"),
      hpDisplay,
      el("span", { class: "hp-max" }, `/ ${data.maxHp}`),
      el("button", { class: "btn hp-btn", onclick: async () => {
        const next = { ...data, hp: Math.min(data.maxHp, data.hp + 1) };
        hpDisplay.textContent = next.hp;
        await save(next);
      }}, "+")
    )
  );

  const abilityCard = (title, subtitle, key) => {
    const btn = el("button", { class: "btn ability-toggle" + (data[key] ? " used" : "") },
      data[key] ? "Used" : "Available");
    btn.addEventListener("click", async () => {
      const next = { ...data, [key]: !data[key] };
      btn.className = "btn ability-toggle" + (next[key] ? " used" : "");
      btn.textContent = next[key] ? "Used" : "Available";
      await save(next);
    });
    return el("div", { class: "kingdom-card tracker-card" },
      el("div", { class: "k-name" }, title),
      el("div", { class: "k-desc" }, subtitle),
      btn
    );
  };

  let noteTimer;
  const notesEl = el("textarea", { class: "tracker-notes", placeholder: "Notes…" });
  notesEl.value = data.notes || "";
  notesEl.addEventListener("input", () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => save({ ...data, notes: notesEl.value }), 800);
  });

  content.replaceChildren(
    el("div", { class: "tracker-grid" },
      hpCard,
      abilityCard("Second Wind", "Bonus action · 1d10+4 HP · Short rest", "secondWind"),
      abilityCard("Action Surge", "Extra action · Short rest", "actionSurge")
    ),
    el("div", { class: "tracker-notes-wrap" }, notesEl)
  );
}

// expose helpers so Claude-added code (here or in other files) can reuse them
window.IO = { $, $$, el, fetchState, saveState, activateTab };

// ---------- boot ----------
document.addEventListener("DOMContentLoaded", () => {
  wireTabs();
  $("#refreshBtn")?.addEventListener("click", () => location.reload());
  renderKingdoms();
  renderHistory();
  initMap();
  renderCharacter();
  renderTracker();
});
