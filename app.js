console.log("🔥 app.js est bien chargé");

// =======================
//  Quêtes & Badges - Login Google + Cloud Sync (Firestore)
//  + Blocage actions si non connecté
//  + Badges images + animation
//  + Rappels (UI) + Timeline (prochains rappels)
//  + Bouton installer (PWA)
// =======================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// ✅ Ton firebaseConfig (UNIQUE)
const firebaseConfig = {
  apiKey: "AIzaSyCaOP76xS-klowPBM9wDbYYQFArt0KMGd8",
  authDomain: "daily-quest-app-5d72a.firebaseapp.com",
  projectId: "daily-quest-app-5d72a",
  storageBucket: "daily-quest-app-5d72a.firebasestorage.app",
  messagingSenderId: "113658966678",
  appId: "1:113658966678:web:3c24e1de2dc1f7ed4e88b7",
  measurementId: "G-X54B7TE7E8"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const provider = new GoogleAuthProvider();

// =======================
//  App (XP / Quêtes)
// =======================

const XP_BY_DIFF = { easy: 10, medium: 25, hard: 50 };

const BADGE_TIERS = [
  { minLevel: 1,  name: "Bronze" },
  { minLevel: 5,  name: "Argent" },
  { minLevel: 10, name: "Or" },
  { minLevel: 15, name: "Diamant" },
  { minLevel: 25, name: "Champion" },
  { minLevel: 40, name: "Maître" },
];

const BADGE_IMAGES = {
  "Bronze": "bronze.png",
  "Argent": "argent.png",
  "Or": "or.png",
  "Diamant": "diamant.png",
  "Champion": "champion.png",
  "Maître": "maitre.png",
};

function xpNeededForNext(level) {
  return Math.floor(100 + (level - 1) * 30);
}

const STORAGE_KEY = "quests_app_v1";

function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function saveLocalState(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function diffLabel(diff) {
  if (diff === "easy") return "Facile";
  if (diff === "medium") return "Moyen";
  return "Difficile";
}

function typeLabel(type) {
  if (type === "daily") return "Daily";
  if (type === "weekly") return "Weekly";
  return "Ponctuelle";
}

function getBadgeForLevel(level) {
  let badge = BADGE_TIERS[0].name;
  for (const t of BADGE_TIERS) if (level >= t.minLevel) badge = t.name;
  return badge;
}

function defaultState() {
  return {
    xp: 0,
    level: 1,
    quests: [],
    lastDailyReset: todayKey(),
    lastWeeklyReset: weekKey(),
  };
}

// Etat courant (local)
let state = loadLocalState() ?? defaultState();
let currentUser = null;

// =======================
//  Toast
// =======================

let toastTimer = null;
function toast(message) {
  let node = document.getElementById("toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "toast";
    node.style.position = "fixed";
    node.style.left = "50%";
    node.style.bottom = "18px";
    node.style.transform = "translateX(-50%)";
    node.style.padding = "10px 12px";
    node.style.borderRadius = "12px";
    node.style.border = "1px solid rgba(255,255,255,0.10)";
    node.style.background = "rgba(15, 22, 48, 0.92)";
    node.style.color = "white";
    node.style.boxShadow = "0 12px 30px rgba(0,0,0,0.35)";
    node.style.fontWeight = "650";
    node.style.zIndex = "9999";
    node.style.maxWidth = "92vw";
    node.style.textAlign = "center";
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.style.opacity = "1";

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.style.opacity = "0"), 1800);
}

// =======================
//  Auth guard
// =======================

function requireAuth(message = "🔒 Connecte-toi pour faire ça.") {
  if (!currentUser) {
    toast(message);
    return false;
  }
  return true;
}

// =======================
//  Firestore : load/save
// =======================

async function loadFromCloud(userId) {
  const ref = doc(db, "users", userId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, { state, updatedAt: Date.now() }, { merge: true });
    toast("☁️ Première connexion : données envoyées sur le cloud");
    return state;
  }

  const cloudState = snap.data()?.state;
  return cloudState ?? defaultState();
}

let saveTimer = null;
function saveToCloudDebounced() {
  if (!currentUser) return;

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const ref = doc(db, "users", currentUser.uid);
      await setDoc(ref, { state, updatedAt: Date.now() }, { merge: true });
    } catch (e) {
      console.error("Erreur sauvegarde cloud:", e);
      toast("⚠️ Sauvegarde cloud impossible (voir console)");
    }
  }, 400);
}

// =======================
//  Reset logic
// =======================

function applyResets() {
  const tKey = todayKey();
  if (state.lastDailyReset !== tKey) {
    for (const q of state.quests) if (q.type === "daily") q.done = false;
    state.lastDailyReset = tKey;
  }

  const wKey = weekKey();
  if (state.lastWeeklyReset !== wKey) {
    for (const q of state.quests) if (q.type === "weekly") q.done = false;
    state.lastWeeklyReset = wKey;
  }
}

// =======================
//  Leveling
// =======================

function animateBadge() {
  if (!badgeImg) return;
  badgeImg.classList.remove("level-up");
  void badgeImg.offsetWidth; // force reflow
  badgeImg.classList.add("level-up");
  setTimeout(() => badgeImg.classList.remove("level-up"), 300);
}

function addXp(amount) {
  state.xp += amount;

  while (true) {
    const needed = xpNeededForNext(state.level);
    if (state.xp >= needed) {
      state.xp -= needed;
      state.level += 1;
      toast(`🎉 Niveau ${state.level} ! Badge: ${getBadgeForLevel(state.level)}`);
      animateBadge();
    } else {
      break;
    }
  }
}

// =======================
//  DOM
// =======================

const el = (id) => document.getElementById(id);

// Lists
const dailyList = el("dailyList");
const weeklyList = el("weeklyList");
const oneList = el("oneList");

const dailyEmpty = el("dailyEmpty");
const weeklyEmpty = el("weeklyEmpty");
const oneEmpty = el("oneEmpty");

const dailyCount = el("dailyCount");
const weeklyCount = el("weeklyCount");
const oneCount = el("oneCount");

// Timeline
const timelineList = el("timelineList");
const timelineEmpty = el("timelineEmpty");
const timelineCount = el("timelineCount");

// Stats
const badgeName = el("badgeName");
const badgeHint = el("badgeHint");
const badgeImg = el("badgeImg");
const levelEl = el("level");
const xpEl = el("xp");
const xpToNextEl = el("xpToNext");
const progressBar = el("progressBar");

// Modal
const addModal = el("addModal");
const openAdd = el("openAdd");
const closeAdd = el("closeAdd");
const qTitle = el("qTitle");
const qType = el("qType");
const qDiff = el("qDiff");
const addQuestBtn = el("addQuest");

// Reminder UI (optionnel si pas encore dans ton HTML)
const reminderDaily = el("reminderDaily");
const reminderWeekly = el("reminderWeekly");
const reminderOne = el("reminderOne");

const dailyTime1 = el("dailyTime1");
const dailyTime2 = el("dailyTime2");
const dailyTime3 = el("dailyTime3");
const dailyTime4 = el("dailyTime4");

const weeklyTime = el("weeklyTime");
const oneDate = el("oneDate");
const oneTime = el("oneTime");

// Tools
const resetProgressBtn = el("resetProgress");
const seedDemoBtn = el("seedDemo");

// Auth UI
const userLabel = el("userLabel");
const loginBtn = el("loginBtn");
const logoutBtn = el("logoutBtn");

// PWA install
const installBtn = el("installBtn");

// =======================
//  UI enable/disable
// =======================

function setUIEnabled(connected) {
  if (openAdd) openAdd.disabled = !connected;
  if (addQuestBtn) addQuestBtn.disabled = !connected;
  if (resetProgressBtn) resetProgressBtn.disabled = !connected;
  if (seedDemoBtn) seedDemoBtn.disabled = !connected;
}

// =======================
//  Reminder UI (form)
// =======================

function updateReminderUI() {
  if (!qType) return;

  const type = qType.value;

  if (reminderDaily) reminderDaily.style.display = (type === "daily") ? "block" : "none";
  if (reminderWeekly) reminderWeekly.style.display = (type === "weekly") ? "block" : "none";
  if (reminderOne) reminderOne.style.display = (type === "one") ? "block" : "none";

  if (type === "one" && oneDate && !oneDate.value) {
    oneDate.value = todayKey();
  }
}

qType?.addEventListener("change", updateReminderUI);

// =======================
//  Render
// =======================

function renderStats() {
  const badge = getBadgeForLevel(state.level);

  if (badgeName) badgeName.textContent = badge;
  if (badgeHint) badgeHint.textContent = `Niveau ${state.level}`;

  if (badgeImg) {
    badgeImg.src = BADGE_IMAGES[badge] || "bronze.png";
    badgeImg.alt = `Badge ${badge}`;
  }

  if (levelEl) levelEl.textContent = String(state.level);
  if (xpEl) xpEl.textContent = String(state.xp);

  const needed = xpNeededForNext(state.level);
  const remaining = Math.max(0, needed - state.xp);

  if (xpToNextEl) xpToNextEl.textContent = String(remaining);

  const pct = Math.max(0, Math.min(100, Math.round((state.xp / needed) * 100)));
  if (progressBar) progressBar.style.width = `${pct}%`;
}

function questItem(q) {
  const xpGain = XP_BY_DIFF[q.diff] ?? 10;

  const item = document.createElement("div");
  item.className = "item";

  const left = document.createElement("div");
  left.className = "item-left";

  const checkbox = document.createElement("div");
  checkbox.className = "checkbox" + (q.done ? " checked" : "");
  checkbox.textContent = q.done ? "✓" : "";

  const textWrap = document.createElement("div");

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = q.title;

  const meta = document.createElement("div");
  meta.className = "meta";

  const t1 = document.createElement("span");
  t1.className = "tag";
  t1.textContent = typeLabel(q.type);

  const t2 = document.createElement("span");
  t2.className = "tag";
  t2.textContent = diffLabel(q.diff);

  const t3 = document.createElement("span");
  t3.className = "tag xp";
  t3.textContent = `+${xpGain} XP`;

  meta.appendChild(t1);
  meta.appendChild(t2);
  meta.appendChild(t3);

  if (q.type === "one" && q.dueDate) {
    const t4 = document.createElement("span");
    t4.className = "tag";
    t4.textContent = `📅 ${q.dueDate}`;
    meta.appendChild(t4);
  }

  if (q.done) {
    const t5 = document.createElement("span");
    t5.className = "tag good";
    t5.textContent = "Validée";
    meta.appendChild(t5);
  }

  textWrap.appendChild(title);
  textWrap.appendChild(meta);

  left.appendChild(checkbox);
  left.appendChild(textWrap);

  const right = document.createElement("div");
  right.className = "item-right";

  const doneBtn = document.createElement("button");
  doneBtn.className = "small-btn done";
  doneBtn.textContent = q.done ? "Annuler" : "Valider";
  doneBtn.disabled = !currentUser;
  doneBtn.addEventListener("click", () => {
    if (!requireAuth("🔒 Connecte-toi pour valider une quête.")) return;
    toggleDone(q.id);
  });

  const delBtn = document.createElement("button");
  delBtn.className = "small-btn del";
  delBtn.textContent = "Supprimer";
  delBtn.disabled = !currentUser;
  delBtn.addEventListener("click", () => {
    if (!requireAuth("🔒 Connecte-toi pour supprimer une quête.")) return;
    removeQuest(q.id);
  });

  right.appendChild(doneBtn);
  right.appendChild(delBtn);

  item.appendChild(left);
  item.appendChild(right);

  return item;
}

function renderLists() {
  if (!dailyList || !weeklyList || !oneList) return;

  dailyList.innerHTML = "";
  weeklyList.innerHTML = "";
  oneList.innerHTML = "";

  const d = state.quests.filter(q => q.type === "daily");
  const w = state.quests.filter(q => q.type === "weekly");
  const o = state.quests.filter(q => q.type === "one");

  if (dailyCount) dailyCount.textContent = String(d.length);
  if (weeklyCount) weeklyCount.textContent = String(w.length);
  if (oneCount) oneCount.textContent = String(o.length);

  if (dailyEmpty) dailyEmpty.style.display = d.length ? "none" : "block";
  if (weeklyEmpty) weeklyEmpty.style.display = w.length ? "none" : "block";
  if (oneEmpty) oneEmpty.style.display = o.length ? "none" : "block";

  for (const q of d) dailyList.appendChild(questItem(q));
  for (const q of w) weeklyList.appendChild(questItem(q));
  for (const q of o) oneList.appendChild(questItem(q));
}

function persistAndMaybeCloud() {
  saveLocalState(state);
  saveToCloudDebounced();
}

// =======================
//  Timeline helpers
// =======================

function parseHHMM(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return { h: isNaN(h) ? 0 : h, m: isNaN(m) ? 0 : m };
}

function makeDateAtTime(baseDate, hhmm) {
  const d = new Date(baseDate);
  const { h, m } = parseHHMM(hhmm);
  d.setHours(h, m, 0, 0);
  return d;
}

function fmtDateFR(d) {
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function fmtTimeFR(d) {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function nextEventForQuest(q, now = new Date()) {
  const r = q.reminders || { enabled: false };
  if (!r.enabled) return null;

  if (q.type === "daily") {
    const times = Array.isArray(r.times) ? r.times : [];
    if (!times.length) return null;

    const sorted = times.slice().sort();
    for (const t of sorted) {
      const dt = makeDateAtTime(now, t);
      if (dt > now) return { dt, q };
    }

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { dt: makeDateAtTime(tomorrow, sorted[0]), q };
  }

  if (q.type === "weekly") {
    const days = Array.isArray(r.days) ? r.days : [];
    const times = Array.isArray(r.times) ? r.times : [];
    if (!days.length || !times.length) return null;

    const sortedTimes = times.slice().sort();
    let best = null;

    for (let add = 0; add <= 7; add++) {
      const d = new Date(now);
      d.setDate(d.getDate() + add);

      const js = d.getDay(); // 0 dim
      const dDay = js === 0 ? 7 : js;

      if (!days.includes(dDay)) continue;

      for (const t of sortedTimes) {
        const dt = makeDateAtTime(d, t);
        if (dt > now && (!best || dt < best.dt)) best = { dt, q };
      }
    }

    return best;
  }

  if (q.type === "one") {
    if (!q.dueDate) return null;

    const times = Array.isArray(r.times) ? r.times : ["09:00"];
    const sorted = times.slice().sort();

    const base = new Date(`${q.dueDate}T00:00:00`);
    if (isNaN(base.getTime())) return null;

    for (const t of sorted) {
      const dt = makeDateAtTime(base, t);
      if (dt > now) return { dt, q };
    }

    return null;
  }

  return null;
}

function renderTimeline() {
  if (!timelineList || !timelineEmpty || !timelineCount) return;

  const now = new Date();
  const events = state.quests
    .map(q => nextEventForQuest(q, now))
    .filter(Boolean)
    .sort((a, b) => a.dt - b.dt)
    .slice(0, 12);

  timelineCount.textContent = String(events.length);
  timelineList.innerHTML = "";
  timelineEmpty.style.display = events.length ? "none" : "block";

  for (const ev of events) {
    const row = document.createElement("div");
    row.className = "tl-item";

    const left = document.createElement("div");
    left.className = "tl-left";

    const title = document.createElement("div");
    title.className = "tl-title";
    title.textContent = ev.q.title;

    const meta = document.createElement("div");
    meta.className = "tl-meta";
    meta.textContent = `${typeLabel(ev.q.type)} • ${diffLabel(ev.q.diff)} • ${fmtDateFR(ev.dt)}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "tl-time";
    right.textContent = fmtTimeFR(ev.dt);

    row.appendChild(left);
    row.appendChild(right);

    timelineList.appendChild(row);
  }
}

function renderAll() {
  applyResets();
  renderStats();
  renderLists();
  renderTimeline();
  persistAndMaybeCloud();
}

// rafraîchit la timeline toutes les minutes
setInterval(() => {
  try { renderTimeline(); } catch {}
}, 60_000);

// =======================
//  Actions
// =======================

function addQuest() {
  if (!requireAuth("🔒 Connecte-toi pour ajouter une quête.")) return;

  const title = (qTitle?.value || "").trim();
  if (!title) return;

  const type = qType?.value || "daily";
  const diff = qDiff?.value || "easy";

  // Par défaut : rappels OFF si le bloc n'existe pas dans l'HTML
  let reminders = { enabled: false };
  let dueDate = null;

  // Si tu as bien créé les champs HTML, on lit les valeurs :
  if (type === "daily") {
    const times = [dailyTime1?.value, dailyTime2?.value, dailyTime3?.value, dailyTime4?.value]
      .map(t => (t || "").trim())
      .filter(Boolean);

    reminders = {
      enabled: true,
      times: Array.from(new Set(times)).sort()
    };
  }

  if (type === "weekly") {
    const days = Array.from(document.querySelectorAll(".wday:checked"))
      .map(x => Number(x.value))
      .filter(n => !isNaN(n));

    const t = (weeklyTime?.value || "18:00").trim();

    reminders = {
      enabled: true,
      days: days.length ? days : [1], // lundi par défaut
      times: [t]
    };
  }

  if (type === "one") {
    dueDate = (oneDate?.value || todayKey()).trim();
    const t = (oneTime?.value || "09:00").trim();

    reminders = {
      enabled: true,
      times: [t]
    };
  }

  // ✅ ICI : on AJOUTE VRAIMENT la quête (c’est ça qui te manquait)
  state.quests.unshift({
    id: uid(),
    title,
    type,
    diff,
    done: false,
    createdAt: Date.now(),
    dueDate,     // null si pas one
    reminders    // objet
  });

  if (qTitle) qTitle.value = "";
  addModal?.close();

  toast("✅ Quête ajoutée !");
  renderAll();
}

function toggleDone(id) {
  if (!requireAuth("🔒 Connecte-toi pour valider une quête.")) return;

  const q = state.quests.find(x => x.id === id);
  if (!q) return;

  const xpGain = XP_BY_DIFF[q.diff] ?? 10;

  if (!q.done) {
    q.done = true;
    addXp(xpGain);
  } else {
    q.done = false;
    toast("↩️ Quête dévalidée (XP non retirée)");
  }

  renderAll();
}

function removeQuest(id) {
  if (!requireAuth("🔒 Connecte-toi pour supprimer une quête.")) return;

  state.quests = state.quests.filter(q => q.id !== id);
  renderAll();
}

function resetProgress() {
  if (!requireAuth("🔒 Connecte-toi pour modifier ta progression.")) return;

  const ok = confirm("Tout effacer (XP + niveaux + quêtes) ?\nC’est irréversible.");
  if (!ok) return;

  state = defaultState();
  toast("🧹 Progression réinitialisée.");
  renderAll();
}

function seedDemo() {
  if (!requireAuth("🔒 Connecte-toi pour ajouter des quêtes d’exemple.")) return;

  const examples = [
    {
      title: "Boire 2 verres d’eau",
      type: "daily",
      diff: "easy",
      reminders: { enabled: true, times: ["09:00", "13:00", "18:00", "21:00"] }
    },
    {
      title: "10 min de marche",
      type: "daily",
      diff: "medium",
      reminders: { enabled: true, times: ["12:30"] }
    },
    {
      title: "Ranger 15 minutes",
      type: "weekly",
      diff: "medium",
      reminders: { enabled: true, days: [1, 4], times: ["18:00"] }
    },
    {
      title: "Sport (séance complète)",
      type: "weekly",
      diff: "hard",
      reminders: { enabled: true, days: [6], times: ["10:00"] } // samedi
    },
    {
      title: "Appeler quelqu’un de la famille",
      type: "one",
      diff: "easy",
      dueDate: todayKey(),
      reminders: { enabled: true, times: ["19:30"] }
    },
  ];

  for (const e of examples) {
    state.quests.unshift({
      id: uid(),
      title: e.title,
      type: e.type,
      diff: e.diff,
      done: false,
      createdAt: Date.now(),
      dueDate: e.dueDate ?? null,
      reminders: e.reminders ?? { enabled: false }
    });
  }

  toast("✨ Quêtes d’exemple ajoutées !");
  renderAll();
}

// =======================
//  Events UI
// =======================

openAdd?.addEventListener("click", () => {
  if (!requireAuth("🔒 Connecte-toi pour ajouter une quête.")) return;
  addModal?.showModal();
  updateReminderUI();
  qTitle?.focus();
});

closeAdd?.addEventListener("click", () => addModal?.close());

addQuestBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  addQuest();
});

resetProgressBtn?.addEventListener("click", resetProgress);
seedDemoBtn?.addEventListener("click", seedDemo);

// =======================
//  Auth events
// =======================

if (logoutBtn) logoutBtn.style.display = "none";

loginBtn?.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    toast("⚠️ Connexion impossible (popup bloquée ?)");
  }
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (e) {
    console.error(e);
    toast("⚠️ Déconnexion impossible");
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;

  if (!currentUser) {
    if (userLabel) userLabel.textContent = "Non connecté";
    if (loginBtn) loginBtn.style.display = "inline-block";
    if (logoutBtn) logoutBtn.style.display = "none";

    setUIEnabled(false);

    renderAll();
    return;
  }

  if (userLabel) userLabel.textContent = `Connecté : ${currentUser.displayName ?? "Utilisateur"}`;
  if (loginBtn) loginBtn.style.display = "none";
  if (logoutBtn) logoutBtn.style.display = "inline-block";

  setUIEnabled(true);

  try {
    const cloudState = await loadFromCloud(currentUser.uid);
    state = cloudState ?? defaultState();
    saveLocalState(state);
    toast("☁️ Données synchronisées !");
    renderAll();
  } catch (e) {
    console.error("Erreur chargement cloud:", e);
    toast("⚠️ Impossible de charger le cloud (voir console)");
    renderAll();
  }
}); // ✅ important : bien `});`

// =======================
//  Start
// =======================
renderAll();

// =======================
//  PWA Installation (Bouton Installer)
// =======================

let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = "inline-block";
});

installBtn?.addEventListener("click", async () => {
  if (!deferredPrompt) {
    toast("ℹ️ Installation non disponible sur ce navigateur.");
    return;
  }

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;

  if (outcome === "accepted") {
    console.log("✅ Application installée");
    toast("✅ Application installée !");
  } else {
    console.log("❌ Installation refusée");
    toast("❌ Installation refusée");
  }

  deferredPrompt = null;
  if (installBtn) installBtn.style.display = "none";
});

// optionnel mais propre
window.addEventListener("appinstalled", () => {
  console.log("🎉 App installée (event appinstalled)");
  toast("🎉 Application installée !");
  if (installBtn) installBtn.style.display = "none";
  deferredPrompt = null;
});
