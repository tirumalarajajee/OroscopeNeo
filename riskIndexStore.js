// riskIndexStore.js

const DB_NAME = "oroscope-db";
const STORE = "riskIndex";
const VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRiskIndex(rows) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);

  rows.forEach(([key, value]) => {
    store.put({ key, value });
  });

  return tx.complete;
}

export async function getRiskValue(key) {
  const db = await openDB();
  return new Promise(resolve => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result?.value || null);
  });
}

export async function ensureRiskIndexLoaded() {
  const probe = await getRiskValue("AUVD"); // any known key
  if (probe !== null) return;

  const res = await fetch("./assets/Riskindexcsvnew.csv", {
    cache: "no-store"
  });

  const text = await res.text();

  const rows = text
    .split("\n")
    .map(r => r.split(",").map(x => x.trim()))
    .filter(r => r.length >= 2);

  await saveRiskIndex(rows);
}
