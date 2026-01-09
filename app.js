// =======================
//  Quêtes & Badges - Login Google + Cloud Sync (Firestore)
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

// ✅ Ton firebaseConfig
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

// État courant (on charge d’abord le local, puis on synchronise si connecté)
let state = loadLocalState() ?? defaultState();
let currentUser = null;

// =======================
//  Cloud (Firestore) : charger / sauvegarder
// =======================

async function loadFromCloud(userId) {
  const ref = doc(db, "users", userId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // Si c'est le 1er login, on "monte" l'état local dans le cloud
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
      // (optionnel) toast discret:
      // toast("☁️ Sauvegardé");
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

function addXp(amount) {
  state.xp += amount;

  while (true) {
    const needed = xpNeededForNext(state.level);
    if (state.xp >= needed) {
      state.xp -= needed;
      state.level += 1;
      toast(`🎉 Niveau ${state.level} ! Badge: ${getBadgeForLevel(state.level)}`);
    } else {
      break;
    }
  }
}

// =======================
//  DOM
// =======================

const el = (id) => document.getElementById(id);

const dailyList = el("dailyList");
const weeklyList = el("weeklyList");
const oneList = el("oneList");

const dailyEmpty = el("dailyEmpty");
const weeklyEmpty = el("weeklyEmpty");
const oneEmpty = el("oneEmpty");

const badgeName = el("badgeName");
const badgeHint = el("badgeHint");
const levelEl = el("level");
const xpEl = el("xp");
const xpToNextEl = el("xpToNext");
const progressBar = el("progressBar");

const dailyCount = el("dailyCount");
const weeklyCount = el("weeklyCount");
const oneCount = el("oneCount");

// Modal
const addModal = el("addModal");
const openAdd = el("openAdd");
const closeAdd = el("closeAdd");
const qTitle = el("qTitle");
const qType = el("qType");
const qDiff = el("qDiff");
const addQuestBtn = el("addQuest");

// Tools
const resetProgressBtn = el("resetProgress");
const seedDemoBtn = el("seedDemo");

// Auth UI
const userLabel = el("userLabel");
const loginBtn = el("loginBtn");
const logoutBtn = el("logoutBtn");

// =======================
//  Render
// =======================

function renderStats() {
  badgeName.textContent = getBadgeForLevel(state.level);
  badgeHint.textContent = `Niveau ${state.level}`;

  levelEl.textContent = String(state.level);
  xpEl.textContent = String(state.xp);

  const needed = xpNeededForNext(state.level);
  const remaining = Math.max(0, needed - state.xp);
  xpToNextEl.textContent = String(remaining);

  const pct = Math.max(0, Math.min(100, Math.round((state.xp / needed) * 100)));
  progressBar.style.width = `${pct}%`;
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

  if (q.done) {
    const t4 = document.createElement("span");
    t4.className = "tag good";
    t4.textContent = "Validée";
    meta.appendChild(t4);
  }

  meta.appendChild(t1);
  meta.appendChild(t2);
  meta.appendChild(t3);

  textWrap.appendChild(title);
  textWrap.appendChild(meta);

  left.appendChild(checkbox);
  left.appendChild(textWrap);

  const right = document.createElement("div");
  right.className = "item-right";

  const doneBtn = document.createElement("button");
  doneBtn.className = "small-btn done";
  doneBtn.textContent = q.done ? "Annuler" : "Valider";
  doneBtn.addEventListener("click", () => toggleDone(q.id));

  const delBtn = document.createElement("button");
  delBtn.className = "small-btn del";
  delBtn.textContent = "Supprimer";
  delBtn.addEventListener("click", () => removeQuest(q.id));

  right.appendChild(doneBtn);
  right.appendChild(delBtn);

  item.appendChild(left);
  item.appendChild(right);

  return item;
}

function renderLists() {
  dailyList.innerHTML = "";
  weeklyList.innerHTML = "";
  oneList.innerHTML = "";

  const d = state.quests.filter(q => q.type === "daily");
  const w = state.quests.filter(q => q.type === "weekly");
  const o = state.quests.filter(q => q.type === "one");

  dailyCount.textContent = String(d.length);
  weeklyCount.textContent = String(w.length);
  oneCount.textContent = String(o.length);

  dailyEmpty.style.display = d.length ? "none" : "block";
  weeklyEmpty.style.display = w.length ? "none" : "block";
  oneEmpty.style.display = o.length ? "none" : "block";

  for (const q of d) dailyList.appendChild(questItem(q));
  for (const q of w) weeklyList.appendChild(questItem(q));
  for (const q of o) oneList.appendChild(questItem(q));
}

function persistAndMaybeCloud() {
  saveLocalState(state);
  saveToCloudDebounced();
}

function renderAll() {
  applyResets();
  renderStats();
  renderLists();
  persistAndMaybeCloud();
}

// =======================
//  Actions
// =======================

function addQuest() {
  const title = (qTitle.value || "").trim();
  if (!title) return;

  state.quests.unshift({
    id: uid(),
    title,
    type: qType.value,
    diff: qDiff.value,
    done: false,
    createdAt: Date.now(),
  });

  qTitle.value = "";
  addModal.close();

  toast("✅ Quête ajoutée !");
  renderAll();
}

function toggleDone(id) {
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
  state.quests = state.quests.filter(q => q.id !== id);
  renderAll();
}

function resetProgress() {
  const ok = confirm("Tout effacer (XP + niveaux + quêtes) ?\nC’est irréversible.");
  if (!ok) return;

  state = defaultState();
  toast("🧹 Progression réinitialisée.");
  renderAll();
}

function seedDemo() {
  const examples = [
    { title: "Boire 2 verres d’eau", type: "daily", diff: "easy" },
    { title: "10 min de marche", type: "daily", diff: "medium" },
    { title: "Ranger 15 minutes", type: "weekly", diff: "medium" },
    { title: "Sport (séance complète)", type: "weekly", diff: "hard" },
    { title: "Appeler quelqu’un de la famille", type: "one", diff: "easy" },
  ];

  for (const e of examples) {
    state.quests.unshift({
      id: uid(),
      title: e.title,
      type: e.type,
      diff: e.diff,
      done: false,
      createdAt: Date.now(),
    });
  }

  toast("✨ Quêtes d’exemple ajoutées !");
  renderAll();
}

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
//  Events UI
// =======================

openAdd.addEventListener("click", () => {
  addModal.showModal();
  qTitle.focus();
});
closeAdd.addEventListener("click", () => addModal.close());

addQuestBtn.addEventListener("click", (e) => {
  e.preventDefault();
  addQuest();
});

resetProgressBtn.addEventListener("click", resetProgress);
seedDemoBtn.addEventListener("click", seedDemo);

// =======================
//  Auth events
// =======================

logoutBtn.style.display = "none";

loginBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    toast("⚠️ Connexion impossible (popup bloquée ?)");
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (e) {
    console.error(e);
    toast("⚠️ Déconnexion impossible");
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    userLabel.textContent = "Non connecté";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";

    // On reste en local
    renderAll();
    return;
  }

  userLabel.textContent = `Connecté : ${user.displayName ?? "Utilisateur"}`;
  loginBtn.style.display = "none";
  logoutBtn.style.display = "inline-block";

  // 🔥 Charger depuis le cloud (ou créer 1ère fois)
  try {
    const cloudState = await loadFromCloud(user.uid);

    // On remplace l'état local par le cloud (source de vérité)
    state = cloudState ?? defaultState();

    // On écrit aussi en local pour que ça marche même hors ligne
    saveLocalState(state);

    toast("☁️ Données synchronisées !");
    renderAll();
  } catch (e) {
    console.error("Erreur chargement cloud:", e);
    toast("⚠️ Impossible de charger le cloud (voir console)");
    renderAll();
  }
});

// Start
renderAll();
console.log("🔥 app.js est bien chargé");

