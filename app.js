import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig, loginEmails, members } from "./firebase-config.js?v=uid-map-20261002";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const presets = [
  ["📚", "Studying"], ["📺", "Watching something"], ["🍜", "Eating"],
  ["🌙", "Sleeping"], ["🏫", "In college"], ["✈️", "Travelling"],
  ["💬", "Free to talk"], ["⏳", "Busy"], ["💛", "Missing you"],
];
const el = (selector) => document.querySelector(selector);
const views = ["login-view", "app-view"];
let currentUser = null;
let partnerUnsubscribe = null;
let firstPartnerSnapshot = true;
let lastBackgroundAt = null;
let selectedEmoji = "✨";
let customMode = false;

function showView(viewId) {
  for (const id of views) el(`#${id}`).hidden = id !== viewId;
  el("#logout-button").hidden = viewId !== "app-view";
}

function memberFor(uid) {
  return members[uid] ?? null;
}

function localKey(uid, suffix) {
  return `stepwise:${uid}:${suffix}`;
}

function showToast(message) {
  const toast = el("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => { toast.hidden = true; }, 3600);
}

async function showLocalNotification(message) {
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("StepWise", {
      body: message,
      icon: "./icons/icon.svg",
      badge: "./icons/icon.svg",
      tag: "partner-status",
      renotify: true,
      data: { url: "./" },
    });
  } catch (error) {
    console.error(error);
    showToast("I updated, but this browser couldn’t show the little notification.");
  }
}

function formatAge(value) {
  if (!value) return "just now";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
}

function paintPartnerStatus(status) {
  el("#partner-emoji").textContent = status?.emoji || "💭";
  el("#partner-status").textContent = status?.text || "Tell me how your day’s going";
  el("#partner-updated").textContent = `You told me ${formatAge(status?.updatedAt)}`;
}

function paintMyStatus(status) {
  el("#my-status-summary").textContent = status ? `${status.emoji} ${status.text}` : "Pick a little update";
  paintHistory(status?.history || []);
  if (status?.preset) {
    const selected = [...document.querySelectorAll(".preset")].find((button) => button.dataset.text === status.text);
    if (selected) selectPreset(selected);
  }
}

function paintHistory(history) {
  const list = el("#history-list");
  list.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("li");
    empty.className = "empty-history";
    empty.textContent = "The little things I’ve told you will show up here.";
    list.append(empty);
    return;
  }
  for (const entry of history.slice(0, 20)) {
    const item = document.createElement("li");
    const emoji = document.createElement("span");
    emoji.className = "history-item-emoji";
    emoji.textContent = entry.emoji;
    const text = document.createElement("span");
    text.className = "history-item-text";
    text.textContent = entry.text;
    const time = document.createElement("time");
    time.className = "history-item-time";
    time.textContent = formatAge(entry.at);
    item.append(emoji, text, time);
    list.append(item);
  }
}

function selectPreset(button) {
  for (const option of document.querySelectorAll(".preset")) option.setAttribute("aria-pressed", String(option === button));
  customMode = false;
  el("#custom-fields").hidden = true;
  selectedEmoji = button.dataset.emoji;
  el("#custom-text").value = "";
}

function createPresets() {
  const grid = el("#preset-grid");
  for (const [emoji, text] of presets) {
    const button = document.createElement("button");
    button.className = "preset";
    button.type = "button";
    button.dataset.emoji = emoji;
    button.dataset.text = text;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `<span aria-hidden="true">${emoji}</span><span>${text}</span>`;
    button.addEventListener("click", () => selectPreset(button));
    grid.append(button);
  }
}

function createEmojiPicker() {
  const emojis = ["✨", "💛", "🌿", "☕", "📚", "🎬", "🍜", "🌙", "🏋️", "✈️", "💬", "😊", "🥰", "😴", "🎧", "🌧️"];
  const picker = el("#emoji-picker");
  for (const emoji of emojis) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-choice";
    button.textContent = emoji;
    button.setAttribute("aria-label", `Choose ${emoji}`);
    button.setAttribute("aria-pressed", String(emoji === selectedEmoji));
    button.addEventListener("click", () => {
      selectedEmoji = emoji;
      for (const choice of picker.children) choice.setAttribute("aria-pressed", String(choice === button));
    });
    picker.append(button);
  }
}

async function unlock(user) {
  const member = memberFor(user.uid);
  if (!member) {
    await signOut(auth);
    el("#login-error").textContent = "Firebase signed you in, but this account UID is not configured yet. Add its UID to firebase-config.js and firestore.rules.";
    return;
  }
  currentUser = user;
  try {
    const profileRef = doc(db, "profiles", user.uid);
    const profile = await getDoc(profileRef);
    if (!profile.exists()) await setDoc(profileRef, { nickname: member.nickname });
    el("#my-nickname").textContent = member.nickname;
    el("#login-error").textContent = "";
    await enterSpace();
  } catch (error) {
    console.error("Could not open the shared space:", error.code, error.message);
    currentUser = null;
    await signOut(auth);
    showView("login-view");
    if (error.code === "permission-denied") {
      el("#login-error").textContent = "Firebase signed you in, but Firestore denied access. Publish the latest firestore.rules in Firebase Console, then reload.";
    } else {
      el("#login-error").textContent = `Firebase signed you in, but the shared space could not load (${error.code || "unknown error"}).`;
    }
  }
}

function subscribeToPartner() {
  const partner = Object.entries(members).find(([uid]) => uid !== currentUser.uid);
  if (!partner) return;
  const [partnerUid, partnerConfig] = partner;
  el("#partner-nickname").textContent = partnerConfig.nickname;
  const statusRef = doc(db, "users", partnerUid, "status", "current");
  partnerUnsubscribe = onSnapshot(statusRef, (snapshot) => {
    const status = snapshot.exists() ? snapshot.data() : null;
    paintPartnerStatus(status);
    if (!firstPartnerSnapshot && status) {
      const activity = status.preset ? status.text.toLowerCase() : status.text;
      const message = `${partnerConfig.nickname} just told me: ${activity} ${status.emoji}`;
      showToast(message);
      if (localStorage.getItem(localKey(currentUser.uid, "notifications")) === "on" && Notification.permission === "granted") {
        void showLocalNotification(message);
      }
    }
    firstPartnerSnapshot = false;
  }, (error) => {
    console.error(error);
    showToast("I couldn’t see your update. Let me check the connection.");
  });
}

async function enterSpace() {
  showView("app-view");
  const member = memberFor(currentUser.uid);
  const partner = Object.entries(members).find(([uid]) => uid !== currentUser.uid);
  const partnerMember = partner ? members[partner[0]] : null;
  const partnerNickname = partnerMember?.nickname || "your person";
  el("#my-status-owner").textContent = `FROM ME: ${member.nickname}`;
  el("#my-status-heading").textContent = `My update for ${partnerNickname}`;
  el("#partner-source").textContent = partnerNickname.toUpperCase();
  el("#custom-recipient").textContent = partnerNickname;
  el("#save-status-label").textContent = `Send to ${partnerNickname}`;
  el("#today-label").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(new Date());
  const cached = localStorage.getItem(localKey(currentUser.uid, "my-status"));
  paintMyStatus(cached ? JSON.parse(cached) : null);
  if (partner) {
    const partnerProfile = await getDoc(doc(db, "profiles", partner[0]));
    if (partnerProfile.exists()) el("#partner-nickname").textContent = partnerProfile.data().nickname;
  }
  subscribeToPartner();
  updateNotificationControl();
}

function updateNotificationControl() {
  const enabled = localStorage.getItem(localKey(currentUser.uid, "notifications")) === "on";
  el("#notifications-toggle").checked = enabled;
  el("#notification-state").textContent = enabled ? "On" : "Off";
}

async function saveStatus() {
  let text;
  let emoji;
  const chosen = document.querySelector('.preset[aria-pressed="true"]');
  if (customMode) {
    text = el("#custom-text").value.trim().slice(0, 60);
    emoji = selectedEmoji;
    if (!text) {
      el("#custom-text").focus();
      return;
    }
  } else if (chosen) {
    text = chosen.dataset.text;
    emoji = chosen.dataset.emoji;
  } else {
    showToast("Pick a little update for her first.");
    return;
  }

  const previous = JSON.parse(localStorage.getItem(localKey(currentUser.uid, "my-status")) || "null");
  const history = Array.isArray(previous?.history) ? previous.history : [];
  history.unshift({ emoji, text, at: new Date().toISOString() });
  const status = { emoji, text, preset: !customMode, updatedAt: new Date().toISOString(), history: history.slice(0, 20) };
  const statusRef = doc(db, "users", currentUser.uid, "status", "current");
  try {
    await setDoc(statusRef, { ...status, updatedAt: serverTimestamp() });
    localStorage.setItem(localKey(currentUser.uid, "my-status"), JSON.stringify(status));
    paintMyStatus(status);
    showToast("Sent her my little update ♥");
  } catch (error) {
    console.error(error);
    showToast("That didn’t send. Let me check the connection and try again.");
  }
}

async function enableNotifications(enabled) {
  if (!enabled) {
    localStorage.setItem(localKey(currentUser.uid, "notifications"), "off");
    updateNotificationControl();
    return;
  }
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    showToast("This browser can’t show little notifications, but updates still appear while I’m here.");
    updateNotificationControl();
    return;
  }
  const permission = await Notification.requestPermission();
  const granted = permission === "granted";
  localStorage.setItem(localKey(currentUser.uid, "notifications"), granted ? "on" : "off");
  updateNotificationControl();
  if (!granted) showToast("No worries. I’ll still show updates here while the app’s open.");
}

async function initializeAuth() {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.error(error);
  }
  onAuthStateChanged(auth, async (user) => {
    if (partnerUnsubscribe) partnerUnsubscribe();
    partnerUnsubscribe = null;
    if (!user) {
      currentUser = null;
      showView("login-view");
      return;
    }
    await unlock(user);
  });
}

createPresets();
createEmojiPicker();
initializeAuth();

el("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  el("#login-error").textContent = "";
  const nickname = el("#account-nickname").value;
  const email = loginEmails[nickname];
  if (!email || email.startsWith("REPLACE_WITH_")) {
    el("#login-error").textContent = `Add the Firebase email for ${nickname} in firebase-config.js first.`;
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, el("#account-password").value);
  } catch (error) {
    console.error("Firebase sign-in failed:", error.code, error.message);
    const code = error.code || "";
    if (code === "auth/configuration-not-found" || code === "auth/operation-not-allowed") {
      el("#login-error").textContent = "Email/Password sign-in is not enabled in this Firebase project yet.";
    } else if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(code)) {
      el("#login-error").textContent = "Firebase rejected that password for the selected account.";
    } else if (code === "auth/network-request-failed") {
      el("#login-error").textContent = "Couldn’t reach Firebase. Check the internet connection and try again.";
    } else {
      el("#login-error").textContent = `Firebase sign-in failed (${code || "unknown error"}). Check the browser console for details.`;
    }
  }
});

el("#logout-button").addEventListener("click", async () => {
  if (partnerUnsubscribe) partnerUnsubscribe();
  partnerUnsubscribe = null;
  await signOut(auth);
});
el("#save-status").addEventListener("click", saveStatus);
el("#custom-toggle").addEventListener("click", () => {
  customMode = true;
  for (const button of document.querySelectorAll(".preset")) button.setAttribute("aria-pressed", "false");
  el("#custom-fields").hidden = false;
  el("#custom-text").focus();
});
el("#notifications-toggle").addEventListener("change", (event) => enableNotifications(event.target.checked));

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    lastBackgroundAt = Date.now();
  } else if (lastBackgroundAt && Date.now() - lastBackgroundAt >= 30000 && auth.currentUser) {
    void signOut(auth);
    lastBackgroundAt = null;
  }
});

window.addEventListener("pagehide", () => {
  if (partnerUnsubscribe) partnerUnsubscribe();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
}