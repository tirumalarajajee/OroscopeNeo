// ======================= IMPORTS =======================
console.log("script_case.js LOADED");

import { caseGroups } from "./state.js";
window._debugCaseGroups = caseGroups;

function bindGroupCheckboxes() {
  document
    .querySelectorAll('input[type="checkbox"][data-group][data-key]')
    .forEach(cb => {
      cb.addEventListener("change", () => {
        const group = cb.dataset.group;
        const value = cb.dataset.key;

        if (!group || !value) return;

        if (cb.checked) {
          if (!caseGroups[group].includes(value)) {
            caseGroups[group].push(value);
          }
        } else {
          caseGroups[group] =
            caseGroups[group].filter(v => v !== value);
        }

        console.log("Updated groups:", caseGroups);
      });
    });
}

document.addEventListener("DOMContentLoaded", bindGroupCheckboxes);





import {
  auth,
  db,
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  collection,
  serverTimestamp,uploadFromSource
} from "./firebase.js";



// ======================= HELPERS =======================
function $(id){ return document.getElementById(id); }

function getEmailKey(user){
  return user.email.toLowerCase().replace(/\./g, "_");
}

// ---- CRITICAL: wait until script.js creates slots ----
function waitForSlots(){
  return new Promise(resolve => {
    const check = () => {
      if (window.slots && window.slots.length === 10) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
}

// ======================= STATE =========================
let currentUser = null;
let editingCaseId = null;

// ======================= AUTH ==========================
onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "index.html";
    return;
  }

  currentUser = user;

  const params = new URLSearchParams(location.search);
  if (params.has("caseId")) {
    editingCaseId = params.get("caseId");

    // ⛔ WAIT until script.js initSlots() runs
    await waitForSlots();
    await loadCase(editingCaseId);
  }
});

// ======================= UI RESTORE ====================
function restoreCheckbox(groupId, value){
  if (!value) return;
  document.querySelectorAll(`#${groupId} input[type=checkbox]`)
    .forEach(cb => cb.checked = cb.dataset.key === value);
}

function restoreMultiCheckbox(groupId, values){
  if (!Array.isArray(values)) return;
  document.querySelectorAll(`#${groupId} input[type=checkbox]`)
    .forEach(cb => cb.checked = values.includes(cb.dataset.key));
}

// ======================= RESTORE IMAGES =================
function restoreSlots(urls) {
  (window.slots || []).forEach((s, i) => {
    const url = urls[i];
    if (url) {
      s.remoteURL = url;

      if (s.previewEl) {
        s.previewEl.innerHTML =
          `<img src="${url}" style="max-width:100%; max-height:140px; display:block" />`;
      }
    } else {
      s.remoteURL = null;
      if (s.previewEl) {
        s.previewEl.innerHTML = '<div class="small">No image</div>';
      }
    }
  });
}



// ======================= LOAD CASE =====================
async function loadCase(caseId) {
  try {
    const key = getEmailKey(currentUser);
    const ref = doc(db, "users", key, "cases", caseId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const d = snap.data();

    $("name").value        = d.name || "";
    $("caseNumber").value  = d.caseNumber || "";
    $("caseId").value  = d.caseId || "";
    $("age").value         = d.age || "";
    $("gender").value      = d.gender || "";
    $("duration").value    = d.duration || "";
    $("prevVisit").value   = d.previsit || "";

    $("lesionLocation").value = d.mappingLocation || "";
    $("analysis").textContent = d.analysisText || "";
    $("provDiag").value    = d.provisionalDiagnosis || "";
    $("diffDiag").value    = d.differentialDiagnosis || "";
    $("advise").value      = d.advice || "";
    $("riskIndex").value = d.riskIndex;
    restoreCheckbox("ulcerGroup", d.ulcer);
    restoreCheckbox("patchGroup", d.patch);
    restoreCheckbox("growthGroup", d.growth);
    restoreCheckbox("pigmentationGroup", d.pigmentation);
    restoreCheckbox("mucosaGroup", d.mucosalTexture);
    restoreCheckbox("teethGroup", d.teeth);
    restoreCheckbox("illnessGroup", d.illness);

    restoreMultiCheckbox("symptomGroup", d.symptoms || []);
    restoreMultiCheckbox("habitGroup", d.habits || []);

    // ✅ Restore Storage image URLs into slots
    restoreSlots(d.imageUrls || []);

  } catch (e) {
    console.error("loadCase failed", e);
  }
}




// ======================= SAVE CASE =====================


async function saveCase() {
  if (!auth.currentUser) {
    alert("Login required");
    return;
  }

  $("status").textContent = "Saving...";

  const user = auth.currentUser;
  const key = getEmailKey(user);
  const caseId = editingCaseId || ("CASE_" + Date.now());

  // Upload all slot images and collect URLs
  const imageUrls = [];
  for (let i = 0; i < (window.slots || []).length; i++) {
    const dataUrl = window.slots[i]?.dataURL;
    if (dataUrl) {
      try {
        const url = await uploadFromSource(
          `users/${key}/cases/${caseId}/slot${i}.jpg`,
          dataUrl
        );
        imageUrls.push(url);
      } catch (err) {
        console.error("Upload failed for slot", i, err);
        imageUrls.push(null);
      }
    } else {
      imageUrls.push(null);
    }
  }

  const data = {
    caseId,
    email: user.email,
    caseNumber: $("caseNumber").value || "",
    caseId: $("caseId").value || "",
    name: $("name").value || "",
    age: $("age").value || "",
    gender: $("gender").value || "",
    duration: $("duration").value || "",
    previsit: $("prevVisit").value || "",
    ulcer: getCheckedKey("ulcerGroup"),
    patch: getCheckedKey("patchGroup"),
    growth: getCheckedKey("growthGroup"),
    pigmentation: getCheckedKey("pigmentationGroup"),
    mucosalTexture: getCheckedKey("mucosaGroup"),
    symptoms: getCheckedKeys("symptomGroup"),
    habits: getCheckedKeys("habitGroup"),
    teeth: getCheckedKey("teethGroup"),
    illness: getCheckedKey("illnessGroup"),

    mappingLocation: $("lesionLocation").value || "",
    analysisText: $("analysis").textContent || "",
    provisionalDiagnosis: $("provDiag").value || "",
    differentialDiagnosis: $("diffDiag").value || "",
    advice: $("advise").value || "",
     riskIndex: $("riskIndex").value || "",
    condensedKey: typeof window.ddnewfinaltxt === "function" ? window.ddnewfinaltxt() : "",
    imageUrls, // ✅ only URLs now
    updatedAt: serverTimestamp(),
    createdBy: user.uid
  };

  await setDoc(
    doc(collection(db, "users", key, "cases"), caseId),
    data,
    { merge: true }
  );

  $("status").textContent = "Saved";
  alert("Case saved successfully");
  location.href = "index.html";
}


// ======================= BUTTON ========================
document.addEventListener("DOMContentLoaded", () => {
  $("saveBtn")?.addEventListener("click", saveCase);
  
});

// ======================= CHECK HELPERS =================
function getCheckedKey(groupId){
  const els = document.querySelectorAll(`#${groupId} input[type=checkbox]`);
  for (const cb of els) if (cb.checked) return cb.dataset.key || "";
  return "";
}

function getCheckedKeys(groupId){
  return Array.from(
    document.querySelectorAll(`#${groupId} input[type=checkbox]`)
  )
  .filter(cb => cb.checked)
  .map(cb => cb.dataset.key || "");
}
