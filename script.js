// Analysis logic: if 'White' patch selected -> use isolationWhite(); else use red isolation
console.log("script.js LOADED");

import { ensureRiskIndexLoaded, getRiskValue } from "./riskIndexStore.js";

import { caseGroups } from "./state.js";
const ANALYSIS_MAX_DIM = 800;
const LESION_LABELS = [
  "NO ABNORMALITY DETECTED","LICHEN PLANUS","ORALLEUKOPLAKIA",
  "CANDIDIASIS","SPECKLEDLEUKOPLAKIA","SEVERE DYSPLASIA",
  "OSMF","VERRUCOUSLEUKOPLAKIA"
];
const SHOW_MASKS = true; // set false later

let model = null;
let predictionRunning = false;
let lastPredictionTime = 0;

let livePrediction = null;     // keeps updating
let frozenPrediction = null;   // snapshot at capture



const MODEL_LABELS = [
  "Normal",
  "Leukoplakia",
  "Lichenplanus",
  "Candidiasis",
  "Verrucous leukoplakia",
  "Speckled leukoplakia",
  "OSMF",
  "Severe Dysplasia"
];
//risk index
document.addEventListener("DOMContentLoaded", async () => {
  await ensureRiskIndexLoaded();
  console.log("Risk index CSV cached in IndexedDB");
});


const DIAGNOSIS_CODE_MAP = [
  ["NOTHING ABNORMAL DETECTED", "NAD"],
  ["APHTHOUS ULCER", "AU"],
  ["INFLAMMATORY LESION", "IL"],
  ["LINEA ALBA", "LA"],
  ["ORAL LEUKOPLAKIA", "OL"],
  ["ORAL LICHEN PLANUS", "OLP"],
  ["CANDIDIASIS", "C"],
  ["GEOGRAPHIC TONGUE", "GT"],
  ["MELANIN PIGMENTATION", "MNP"],
  ["TOBACCO POUCH KERATOSIS", "TPK"],
  ["FRICTIONAL KERATOSIS", "FK"],
  ["VERRUCOUS LEUKOPLAKIA", "VL"],
  ["OSMF", "OSMF"],
  ["BURNING MOUTH SYNDROME", "BMS"],
  ["FIBROMA", "F"],
  ["SPECKLED LEUKOPLAKIA", "SL"],
  ["TRAUMATIC ULCER", "TU"],
  ["ORAL SQUAMOUS CELL CARCINOMA", "OSCC"],
  ["VERRUCOUS CARCINOMA", "VC"],
  ["SQUAMOUS PAPILLOMA", "SP"],
  ["SEVERE DYSPLASIA", "SD"]
];

window.caseRisk = {
  diagnosisCode: null,   // AU, OL, OLP, etc.
  riskBand: null,        // VD / B / SD
  riskKey: null,         // e.g. AUVD
  riskScore: null,       // value from CSV
  computedAt: null       // timestamp
};


function normalize(str) {
  return str.toUpperCase().replace(/\s+/g, " ").trim();
}

function getDiagnosisCode(text) {
  if (!text) return null;

  const normalizedText = normalize(text);

  for (const [label, code] of DIAGNOSIS_CODE_MAP) {
    const normalizedLabel = normalize(label);

    if (
      normalizedText.includes(normalizedLabel) ||
      normalizedLabel.includes(normalizedText)
    ) {
      return code;
    }
  }

  return null;
}
function getRiskBandCode(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  if (t.includes("OBSERVE")) return "VD";
  if (t.includes("BORDERLINE")) return "B";
  if (t.includes("SUGGESTIVE")) return "SD";
  return null;
}



async function computeAndStoreRisk() {
  const diagnosisText = $("provDiag").value;
  const analysisText = $("analysis").textContent;

  const diagnosisCode = getDiagnosisCode(diagnosisText);
  const riskBand = getRiskBandCode(analysisText);
  console.log("Diagnosis text:", $("provDiag").value);
console.log("Diagnosis code:", getDiagnosisCode($("provDiag").value));

  if (!diagnosisCode || !riskBand) {
    console.warn("Risk computation skipped");
    return;
  }

  const riskKey = (diagnosisCode + riskBand).toUpperCase();

  const riskScore = await getRiskValue(riskKey);

  window.caseRisk = {
    diagnosisCode,
    riskBand,
    riskKey,
    riskScore: riskScore || "",
    computedAt: new Date().toISOString()
  };

  console.log("Risk computed:", window.caseRisk);

  updateRiskUI();
}

function updateRiskUI() {
  if (!window.caseRisk) return;
  $("riskIndex").value = window.caseRisk.riskScore || "";
}


//checkboxes must condition
function validateAtLeastOneSelection(caseGroups) {
  if (!caseGroups || typeof caseGroups !== "object") return false;

  return Object.values(caseGroups).some(
    arr => Array.isArray(arr) && arr.length > 0
  );
}

function getEmptyCaseGroups(caseGroups) {
  return Object.entries(caseGroups)
    .filter(([_, arr]) => Array.isArray(arr) && arr.length === 0)
    .map(([key]) => key);
}




function bindGroupCheckboxesToState() {
  document
    .querySelectorAll('input[type="checkbox"][data-group][data-key]')
    .forEach(cb => {
      cb.addEventListener("change", () => {
        const group = cb.dataset.group;
        const value = cb.dataset.key;

        if (!group || !value || !caseGroups[group]) return;

        if (cb.checked) {
          if (!caseGroups[group].includes(value)) {
            caseGroups[group].push(value);
          }
        } else {
          caseGroups[group] =
            caseGroups[group].filter(v => v !== value);
        }

        console.log("caseGroups updated:", caseGroups);
      });
    });
}





function updateGroup(groupArray, checked, value) {
  if (checked) {
    if (!groupArray.includes(value)) {
      groupArray.push(value);
    }
  } else {
    const idx = groupArray.indexOf(value);
    if (idx !== -1) {
      groupArray.splice(idx, 1);
    }
  }
}


document.addEventListener("click", e => {
  if (e.target && e.target.id === "pdfBtn") {
    generateCasePDF();
  }
});








const PREDICTION_INTERVAL_MS = 500; // 2 per second (clinical-safe)
const CONFIDENCE_THRESHOLD = 0.80;


let slots = [], tfliteModel = null, csvCache = null, stream = null;
window.slots = slots;

function $(id){ return document.getElementById(id) }
const q = sel => document.querySelector(sel);
const isChecked = sel => !!q(sel) && !!q(sel).checked;
const valText = sel => (q(sel)?.value || '').toLowerCase();

// ------------------------ Image helpers ------------------------
function imageToCanvas(img, maxDim){
  const canvas = document.createElement('canvas');
  let w = img.width, h = img.height;
  if(maxDim){
    const scale = Math.min(1, maxDim / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
  }
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas;
}

function dataUrlToImage(dataUrl){
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = dataUrl;
    img.crossOrigin = 'anonymous';
  });
}

function getImageDataFromDataUrlResized(dataUrl, maxDim){
  return dataUrlToImage(dataUrl).then(img => {
    const c = imageToCanvas(img, maxDim);
    return c.getContext('2d').getImageData(0, 0, c.width, c.height);
  });
}

function imageDataToDataUrl(imageData){
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c.toDataURL('image/png');
}



// ------------------------ Slots UI ------------------------
function initSlots() {
  // Reset the same array object
  slots.length = 0;

  const slotEls = document.querySelectorAll('#slotsContainer .slot');
  console.log("Found slot elements:", slotEls.length);

  slotEls.forEach((slotEl, i) => {
    const selCb = document.getElementById(`slot-select-${i}`);
    
    const previewEl = slotEl.querySelector('.preview');
    const fileInput = slotEl.querySelector('input[type=file]');
    const capBtn = slotEl.querySelectorAll('button.btn.btn-ghost')[0];
    const remBtn = slotEl.querySelectorAll('button.btn.btn-ghost')[1];

    if (fileInput) {
  fileInput.addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // First file goes to this slot
    handleFileSelect(i, files[0]);

    // Remaining files fill next slots automatically
    let next = i + 1;
    for (let k = 1; k < files.length && next < slots.length; k++, next++) {
      handleFileSelect(next, files[k]);
    }

    e.target.value = ""; // reset input
  });
}


    if (capBtn) capBtn.addEventListener('click', () => captureToSlot(i));
    if (remBtn) remBtn.addEventListener('click', () => removeSlot(i));

    // ✅ SINGLE SOURCE OF TRUTH
    const slotObj = {
  dataURL: null,
  remoteURL: null,
  selected: selCb ? selCb.checked : false,
  selectedEl: selCb,
  previewEl
};

if (selCb) {
  selCb.addEventListener("change", () => {
    const count = window.slots.filter(s => s.selected).length;

    if (selCb.checked && count >= 2) {
      selCb.checked = false;
      return alert("Select only two images");
    }

    slotObj.selected = selCb.checked;
  });
}

slots.push(slotObj);

  });

  window.slots = slots;
}



function setSlotImage(idx, dataUrl, autoSelect = false) {
  const s = window.slots[idx];
  if (!s) return;

  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image")) {
    console.error("setSlotImage received non-base64:", dataUrl);
    return;
  }

  s.dataURL = dataUrl;

  // ✅ ONLY auto-select when explicitly requested
  if (autoSelect) {
    s.selected = true;
    if (s.selectedEl) s.selectedEl.checked = true;
  }

  if (s.previewEl) {
    s.previewEl.innerHTML =
      `<img src="${dataUrl}" style="max-width:100%; max-height:140px; display:block">`;
  }
}





function removeSlot(idx) {
  const s = window.slots[idx];
  if (!s) return;

  s.dataURL = null;
  s.remoteURL = null; // 🔑 prevent stale Firebase URLs
  s.selected = false;

  if (s.previewEl) s.previewEl.innerHTML = '<div class="small">No image</div>';
  if (s.selectedEl) s.selectedEl.checked = false;
  if (s.amberEl) s.amberEl.checked = false;
}


function handleFileSelect(idx, file) {
  const reader = new FileReader();

  reader.onload = e => {
    const result = e.target.result;

    // 🔑 ENSURE BASE64 STRING
    if (typeof result === "string" && result.startsWith("data:image")) {
      setSlotImage(idx, result, true);
    } else {
      console.error("FileReader returned non-base64:", result);
    }
  };

  reader.readAsDataURL(file);
}


function enforceSingleSelection(groupId) {
  const checkboxes = document.querySelectorAll(`#${groupId} input[type=checkbox]`);
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        checkboxes.forEach(other => {
          if (other !== cb) other.checked = false;
        });
      }
    });
  });
}

// Call this once for each group
['ulcerGroup','patchGroup','growthGroup','pigmentationGroup','mucosaGroup','sharpGroup']
  .forEach(enforceSingleSelection);

async function captureToSlot(idx) {
  const video = document.getElementById("cameraPreview");
  if (!video || !video.srcObject) {
    alert("Camera not started");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  canvas.getContext("2d").drawImage(video, 0, 0);

  const base64 = canvas.toDataURL("image/jpeg", 0.9);

  // 🔑 PASS STRING ONLY
  setSlotImage(idx, base64, true); // ✔ auto-select




  // 🔑 FREEZE AI PREDICTION FOR FIRST SLOT (View 1)
  if (idx === 0) {
    frozenPrediction = livePrediction
      ? { ...livePrediction }
      : null;

    console.log("📌 Frozen AI prediction for View 1:", frozenPrediction);
  }
}




// ------------------------ Camera ------------------------
async function refreshCameras(){
  const select = $('cameraSelect'); select.innerHTML = '';
  try{
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    cams.forEach((c, i) => {
      const opt = document.createElement('option');
      opt.value = c.deviceId;
      opt.textContent = c.label || `Camera ${i+1}`;
      select.appendChild(opt);
    });
  }catch(e){ console.warn('enumerateDevices', e); }
}

async function startCamera() {
  const sel = $('cameraSelect').value;

  if (stream) stopCamera();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: sel ? { exact: sel } : undefined }
    });

    const video = $('cameraPreview'); // ✅ DEFINE VIDEO HERE
    video.srcObject = stream;
    await video.play();

    startLivePrediction(video); // ✅ PASS CORRECT VARIABLE
  } catch (e) {
    console.error(e);
    alert('Cannot start camera: ' + e.message);
  }
}


function stopCamera(){
  if(stream){
    stream.getTracks().forEach(t => t.stop());
    stream = null; $('cameraPreview').srcObject = null;
  }
}

// ------------------------ CSV and TFLite ------------------------
function safeCsvSplit(line){
  const out = []; let cur = ''; let inQuotes = false;
  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(ch === '"'){ inQuotes = !inQuotes; }
    else if(ch === ',' && !inQuotes){ out.push(cur); cur = ''; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}

async function loadCsv(){
  if (csvCache) return csvCache;
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/tirumalarajajee/OroscopeNeo/main/finalDDoroscope3825new.csv'
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const txt = await res.text();
    const rows = txt.trim().split(/\r?\n/).map(safeCsvSplit);
    csvCache = rows;
    return rows;
  } catch (e) {
    console.warn('CSV load error', e);
    csvCache = [];
    return [];
  }
}


async function loadTflite(){
  try{
    tfliteModel = await tflite.loadTFLiteModel('assets/modellesion25.11.24.tflite');
    console.log('tflite loaded');
  }catch(e){ console.warn('tflite load failed', e); tfliteModel = null; }
}

async function runTFLitePredictionOnImageData(imageData){
  if(!tfliteModel) return '';
  const tfimg = tf.browser.fromPixels(imageData)
    .resizeBilinear([224,224])
    .toFloat()
    .div(255.0)
    .expandDims(0);
  const out = tfliteModel.predict(tfimg);
  const arr = Array.from(out.dataSync());
  const maxIndex = arr.indexOf(Math.max(...arr));
  // no dispose available for tfliteModel outputs in some runtimes; ensure tfimg is dereferenced
  return LESION_LABELS[maxIndex] || '';
}

async function getCsvDiagnosisFull(){
  let rows = [];
  try{
    rows = await loadCsv();
  }catch(e){
    console.warn('CSV load failed', e);
    return { provisional:'', differential:'', advice:'' };
  }

  let key = '';
  try{
    key = (ddnewfinaltxt() || '').trim().toUpperCase();
  }catch(e){
    console.warn('ddnewfinaltxt() failed', e);
    return { provisional:'', differential:'', advice:'' };
  }

  for(const row of rows){
    const col0 = (row[0] || '').trim().toUpperCase();
    if(col0 && col0 === key){
      return {
        provisional: (row[1] || '').trim(),
        differential: (row[2] || '').trim(),
        advice: (row[3] || '').trim()
      };
    }
  }
  return { provisional:'', differential:'', advice:'' };
}

// ------------------------ Analyze + Predict + Fuse ------------------------
async function analyzePredictAndFuse() {
 const selected = window.slots
  .map((s, i) => ({ ...s, i }))
  .filter(s => s.dataURL && s.selected);

if (selected.length !== 2) {
  alert("Please select exactly two images");
  return;
}



  // Determine patch type
 

  const patchKeys = getCheckedKeys("patchGroup");

const patchType =
  patchKeys.some(k => k.toLowerCase().includes("white"))
    ? "WHITE"
    : "RED";

const payload = {
  imgA: selected[0].dataURL,
  imgB: selected[1].dataURL,
  patchType,

  rules: {
    "Ulcer": getCheckedKey("ulcerGroup"),
    "Patch": getCheckedKey("patchGroup"),
    "Growth": getCheckedKey("growthGroup"),
    "Mucosal Condition": getCheckedKey("mucosaGroup"),
    "Pigmentation": getCheckedKey("pigmentationGroup"),
    "Sharp Objects": getCheckedKey("teethGroup"),

    "Symptoms": getCheckedKeys("symptomGroup").join(";"),
    "Habits": getCheckedKeys("habitGroup").join(";"),
    "Oral Mapping": document.getElementById("lesionLocation").value || ""
  }
};



  // 🔗 CLOUD FUNCTION URL (USE YOUR a.run.app URL)
  const FUNCTION_URL = "https://analyze-pg3snxql4q-uc.a.run.app";
  

  let result;
  try {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error("Server error: " + res.status);
    }

    result = await res.json();
    if (SHOW_MASKS) {
 if (result.bwA_png)   setSlotImage(6, result.bwA_png, false);
if (result.bwB_png)   setSlotImage(7, result.bwB_png, false);
if (result.maskA_png) setSlotImage(8, result.maskA_png, false);
if (result.maskB_png) setSlotImage(9, result.maskB_png, false);

}


  } catch (err) {
    console.error(err);
    alert("Analysis failed: " + err.message);
    return;
  }

  // ---------------- Display results ----------------
  $('analysis').textContent =
    `Img1 G-count: ${result.countA}\n` +
    `Img2 G-count: ${result.countB}\n` +
    `Variation: ${result.percent}%\n\n` +
    `Conclusion: ${result.conclusion}`;

  $('provDiag').value = result.provisional || "";
  $('diffDiag').value = result.differential || "";
  $('advise').value = result.advice || "";
  await computeAndStoreRisk();
updateRiskUI();


  if (frozenPrediction && frozenPrediction.label) {

  const provisional = ($('provDiag').value || "").trim();
  const aiLabel = frozenPrediction.label;

  // Only act if both values exist and are different
  if (provisional && aiLabel && provisional !== aiLabel) {

    const diffField = $('diffDiag');

    // Normalize existing differential diagnoses
    const existing = diffField.value
      .split(',')
      .map(v => v.trim())
      .filter(v => v.length > 0);

    // Prevent duplicates
    if (!existing.includes(aiLabel)) {
      existing.push(aiLabel);
      diffField.value = existing.join(', ');
    }
  }
}
}


// ------------------------ ddnewfinaltxt (Android condensation rules) ------------------------
function getCheckedKey(groupId){
  const group = document.querySelectorAll(`#${groupId} input[type=checkbox]`);
  for(const cb of group){
    if(cb.checked) return cb.dataset.key;
  }
  return "MISSING"; // fallback marker
}


function getCheckedKeys(groupId){
  return Array.from(document.querySelectorAll(`#${groupId} input[type=checkbox]`))
              .filter(cb => cb.checked)
              .map(cb => cb.dataset.key || "");
}

function getText(sel){
  const el = document.querySelector(sel);
  return el ? el.textContent : "";
}


function ddnewfinaltxt(){
  let ulcertext="", patchtext="", growthtext="", mucotext="",  pigtext="", sharptext="";
  let symptext="", habittext="";

  // Single‑choice groups
  ulcertext  = getCheckedKey("ulcerGroup");
  patchtext  = getCheckedKey("patchGroup");
  growthtext = getCheckedKey("growthGroup");
  mucotext   = getCheckedKey("mucosaGroup");
  pigtext    = getCheckedKey("pigmentationGroup");
  
  sharptext  = getCheckedKey("teethGroup");

  // Symptoms (multiple selection + collapse rules)
  let sympArr = getCheckedKeys("symptomGroup");
  if(sympArr.includes("No")) {
    symptext = "No";
  } else {
    symptext = sympArr.join('');
    if(symptext.includes("Mouth")) {
      symptext = "Yes Mouth";
    } else if(/Pain|Redness|Swelling|Burning|Blanching/.test(symptext)) {
      symptext = "Yes";
    }
  }

  // Habits (multiple selection + collapse rules)
  let habitArr = getCheckedKeys("habitGroup");
  if(habitArr.includes("Hno")) {
    habittext = "Hno";
  } else if(habitArr.includes("Smoking") && habitArr.length > 1) {
    habittext = "Hyes";
  } else if(habitArr.includes("Smoking")) {
    habittext = "Smoking";
  } else if(habitArr.length > 0) {
    habittext = "Hyes";
  }

  // Mapping areas (multiple selection + collapse rules)
  


const lesion = document.getElementById('lesionLocation').value || "";
  let maptext = "";

  if (lesion.includes("Buccal mucosa")) maptext = "Bmucosa";
  else if (lesion.includes("Buccal sulcus")) maptext = "Bsulcus";
  else if (lesion.includes("Palate")) maptext = "Palate";
  else if (lesion.includes("Tongue dorsum")) maptext = "Dorsumtongue";
  else if (lesion.includes("Lateral tongue")) maptext = "Lateraltongue";
  else if (lesion.includes("Retromolar")) maptext = "Retromolar area";
  else if (lesion.includes("Floor of mouth")) maptext = "Mouth";
  else if (lesion.includes("Alveolus")) maptext = "Alveolus";
  else if (lesion.includes("Labial mucosa")) maptext = "Lmucosa";
  else if (lesion.includes("Lip")) maptext = "Lip";
  else if (lesion.includes("Gingiva")) maptext = "Gingiva";

  // collapse to Mixedareas if any of the mixed sites are present
  if (/Lateraltongue|Retromolar area|Mouth|Lmucosa|Lip|Gingiva|Alveolus/.test(maptext)) {
    maptext = "Mixedareas";
  }







  // Final concatenation
  const ddnewfinaltext = ulcertext+patchtext+growthtext+mucotext+pigtext+sharptext+symptext+habittext+maptext;
  return ddnewfinaltext;
}




// ------------------------ Mapping engine (optional UI) ------------------------
(function(){
  const mapImg = document.getElementById('mapImage');
  const mapCanvas = document.getElementById('mapCanvas');
  const lesionInput = document.getElementById('lesionLocation');
  let mapCtx = null;

  const regionMap = [
    { name: "Upper lip",        label:[0.4246, 0.0716], selected:false },
    { name: "Labial mucosa",    label:[0.4020, 0.1156], selected:false },
    { name: "Gingiva",          label:[0.3342, 0.1676], selected:false },
    { name: "Palate",           label:[0.4849, 0.3196], selected:false },
    { name: "Buccal mucosa",    label:[0.2035, 0.4436], selected:false },
    { name: "Retro molar area", label:[0.8040, 0.5416], selected:false },
    { name: "Tongue dorsum",    label:[0.3191, 0.5516], selected:false },
    { name: "Lateral tongue",   label:[0.5352, 0.5836], selected:false },
    { name: "Floor of mouth",   label:[0.4246, 0.7276], selected:false },
    { name: "Buccal sulcus",    label:[0.7362, 0.7896], selected:false },
    { name: "Labial mucosa (lower)", label:[0.4523, 0.8896], selected:false },
    { name: "Lip",              label:[0.4849, 0.9356], selected:false }
  ];

  function resizeCanvasToImage(){
    mapCanvas.width = mapImg.naturalWidth;
    mapCanvas.height = mapImg.naturalHeight;
    mapCanvas.style.width = mapImg.clientWidth + 'px';
    mapCanvas.style.height = mapImg.clientHeight + 'px';
    mapCtx = mapCanvas.getContext('2d');
  }

  function scalePoint([px, py], img){
    return [px * img.naturalWidth, py * img.naturalHeight];
  }

  function drawRegions(){
    mapCtx.clearRect(0,0,mapCanvas.width,mapCanvas.height);
    mapCtx.drawImage(mapImg,0,0,mapCanvas.width,mapCanvas.height);

    mapCtx.font = "15px Arial";
    mapCtx.textAlign = "center";
    mapCtx.textBaseline = "middle";

    for(const region of regionMap){
      const [lx,ly] = scalePoint(region.label, mapImg);
      const textWidth = mapCtx.measureText(region.name).width;

      if(region.selected){
  // background box in semi‑transparent green
  mapCtx.fillStyle = "rgba(127,255,0,0.5)";
  mapCtx.fillRect(lx-textWidth/2-5, ly-15, textWidth+10, 30);
  // text in solid green
  mapCtx.fillStyle = "#7FFF00";
} else {
  // unselected text also in green
  mapCtx.fillStyle = "#7FFF00";
}
mapCtx.fillText(region.name, lx, ly);

    }
  }

  function updateLesionInput(){
    const selectedNames = regionMap.filter(r=>r.selected).map(r=>r.name);
    lesionInput.value = selectedNames.join(', ');
  }

  function attachClickHandler(){
    mapCanvas.addEventListener('click', function(e){
      if (!mapCtx) return;

      const rect = mapCanvas.getBoundingClientRect();
      const scaleX = mapImg.naturalWidth / rect.width;
      const scaleY = mapImg.naturalHeight / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      let toggled = false;
      mapCtx.font = "10px Arial";
      mapCtx.textAlign = "center";
      mapCtx.textBaseline = "middle";

      for(const region of regionMap){
        const [lx,ly] = scalePoint(region.label, mapImg); // FIX: scale to pixels
        const textWidth = mapCtx.measureText(region.name).width;
        const box = { x: lx - textWidth/2 - 8, y: ly - 18, w: textWidth + 16, h: 36 };
        if(x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h){
          region.selected = !region.selected;
          toggled = true;
          break;
        }
      }
      if(toggled){
        drawRegions();
        updateLesionInput();
      }
    });
  }

  function init(){
    if(!mapImg || !mapCanvas || !lesionInput){
      console.error('Mapping elements not found');
      return;
    }
    const ready = ()=>{
      resizeCanvasToImage();
      drawRegions();
      attachClickHandler();
    };
    if (mapImg.complete && mapImg.naturalWidth){
      ready();
    } else {
      mapImg.onload = ready;
      mapImg.onerror = ()=>console.error('Failed to load mapping image');
    }
    window.addEventListener('resize', ()=>{
      if(!mapCtx) return;
      resizeCanvasToImage();
      drawRegions();
    });
  }

  init();
})();



// ------------------------ Init & wiring ------------------------
async function init(){
  initSlots();
  bindGroupCheckboxesToState();
  await refreshCameras().catch(()=>{});
  //await loadTflite().catch(()=>{});
  await loadModel(); 
  // wire buttons
  $('refreshCams').addEventListener('click', refreshCameras);
  $('startCam').addEventListener('click', startCamera);
  $('stopCam').addEventListener('click', stopCamera);
  $('clearBtn').addEventListener('click', ()=>location.reload());
  wireAnalyze();
}

function wireAnalyze() {
  const btn = $('analyzeBtn');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Analyzing...';

    try {
      const empty = getEmptyCaseGroups(caseGroups);

      // ❌ ALL groups empty → block analysis
      if (empty.length === Object.keys(caseGroups).length) {
        alert("Please select at least one clinical finding before analysis.");
        return;
      }

      // ✅ Proceed
      await analyzePredictAndFuse();

    } catch (e) {
      console.error(e);
      alert('Analysis error: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Analyze Selected Images';
    }
  });
}


window.addEventListener('DOMContentLoaded', init);



// ------------------------ putMaskPreviewInSlot ------------------------
function putMaskPreviewInSlot(slotIndex, imageData, count){
  const s = slots[slotIndex]; if(!s) return;
  const url = imageDataToDataUrl(imageData);
  setSlotImage(slotIndex, url);
  if(!s.previewEl) return;
  const existing = s.previewEl.querySelector('.mask-badge'); if(existing) existing.remove();
  const badge = document.createElement('div');
  badge.className = 'mask-badge';
  badge.textContent = 'G:' + count;
  s.previewEl.style.position = 'relative';
  s.previewEl.appendChild(badge);
  s.maskedDataUrl = url; s.maskedCount = count;
}


const MODEL_HTTP_URL =
  "https://tirumalarajajee.github.io/OroscopeNeo/assets/jsonimage_model/model.json";

const MODEL_VERSION = "v1"; // change ONLY when model changes
const LOCAL_MODEL_KEY = `indexeddb://oroscope_model_${MODEL_VERSION}`;



async function loadModel() {
  await tf.setBackend("wasm");
  await tf.ready();

  try {
    model = await tf.loadLayersModel(LOCAL_MODEL_KEY);
    console.log("Model loaded from IndexedDB");
  } catch (e) {
    console.log("Downloading model from server...");
    model = await tf.loadLayersModel(MODEL_HTTP_URL);
    await model.save(LOCAL_MODEL_KEY);
    console.log("Model saved to IndexedDB");
  }
  window._model = model;
console.log("MODEL OBJECT:", model);
console.log("MODEL OUTPUT SHAPE:", model.outputs[0].shape);

}

function startLivePrediction(video) {
  console.log("startLivePrediction called");
 // if (predictionRunning) return;
  predictionRunning = true;

  async function loop() {
    console.log("prediction loop tick");

    if (!predictionRunning) return;

    const now = performance.now();
    if (now - lastPredictionTime < PREDICTION_INTERVAL_MS) {
      requestAnimationFrame(loop);
      return;
    }
    lastPredictionTime = now;

    const input = tf.tidy(() =>
      tf.browser.fromPixels(video)
        .resizeBilinear([224, 224])
        .toFloat()
        .div(255)
        .expandDims(0)
    );

    const output = model.predict(input);
    const scores = output.dataSync();

    tf.dispose(output);

    handlePrediction(scores);
    console.log("Scores:", scores, "Length:", scores.length);


    requestAnimationFrame(loop);
  }

  loop();
}


function handlePrediction(scores) {
  let maxIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[maxIdx]) maxIdx = i;
  }

  const confidence = scores[maxIdx];

  if (confidence < CONFIDENCE_THRESHOLD) {
    livePrediction = null;
    updateUI("--", 0);
    return;
  }

  // 🔑 SOURCE OF TRUTH
  livePrediction = {
    label: MODEL_LABELS[maxIdx],
    confidence: confidence
  };

  // 🔑 UI IS JUST A VIEW
  updateUI(livePrediction.label, livePrediction.confidence);
}

function updateUI(label, confidence) {
  const el = document.getElementById("livePrediction");
  console.log("Updating UI", label, confidence, el);

  if (!el) {
    alert("livePrediction element NOT FOUND");
    return;
  }

  el.style.position = "fixed";
  el.style.top = "10px";
  el.style.left = "10px";
  el.style.zIndex = "9999";
  el.style.background = "black";
  el.style.color = "lime";
  el.style.fontSize = "20px";
  el.style.padding = "10px";

  el.innerText = `${label} (${(confidence * 100).toFixed(1)}%)`;
  

}


function getGroupValues(selector) {
  return [...document.querySelectorAll(selector)]
    .filter(el => el.checked)
    .map(el => el.value || el.parentElement.textContent.trim());
}


function addGroupSection(pdf, title, values, y) {
  if (!values || values.length === 0) return y;

  // Page overflow check
  if (y > 270) {
    pdf.addPage();
    y = 10;
  }

  pdf.setFontSize(11);
  pdf.text(title, 10, y);
  y += 6;

  pdf.setFontSize(9);
  values.forEach(v => {
    if (y > 280) {
      pdf.addPage();
      y = 10;
    }
    pdf.text(`• ${v}`, 12, y);
    y += 4;
  });

  return y + 4;
}

async function getSelectedSlotImages() {
  const out = [];

  for (let i = 0; i < window.slots.length; i++) {
    const s = window.slots[i];
    if (!s.selected) continue;

    // 1️⃣ Base64 available → use directly
    if (typeof s.dataURL === "string" && s.dataURL.startsWith("data:image")) {
      out.push({ index: i, dataURL: s.dataURL });
      continue;
    }

    // 2️⃣ Fallback: Firebase URL → convert to base64
    if (s.remoteURL) {
      try {
        const res = await fetch(s.remoteURL);
        const blob = await res.blob();

        const base64 = await new Promise(resolve => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.readAsDataURL(blob);
        });

        out.push({ index: i, dataURL: base64 });
      } catch (e) {
        console.warn("Failed to load remote image", i, e);
      }
    }
  }

  return out;
}







//fucntion pdf

function getCheckedValuesByGroup(groupId) {
  return Array.from(
    document.querySelectorAll(`#${groupId} input[type="checkbox"]:checked`)
  ).map(cb => cb.dataset.key || cb.parentElement.textContent.trim());
}





async function generateCasePDF() {
  if (!window.jspdf?.jsPDF) {
    alert("PDF library not loaded");
    return;
  }

  const pdf = new window.jspdf.jsPDF("p", "mm", "a4");
  let y = 10;

  /* ---------- DATE ---------- */
  pdf.setFontSize(10);
  pdf.text(`Date: ${new Date().toLocaleString()}`, 10, y);
  y += 8;

  /* ---------- PATIENT DETAILS ---------- */
  pdf.setFontSize(11);
  pdf.text("Patient Details", 10, y);
  y += 6;

  pdf.setFontSize(10);
  [
    ["Name", $("name").value],
    ["Case No", $("caseNumber").value],
    ["Case ID", $("caseId").value],
    ["Age", $("age").value],
    ["Gender", $("gender").value]
  ].forEach(([k, v]) => {
    pdf.text(`${k}: ${v || "-"}`, 10, y);
    y += 5;
  });

  y += 6;

  /* ---------- CLINICAL GROUPS ---------- */
  y = addGroupSection(pdf, "Ulcer Group", getCheckedValuesByGroup("ulcerGroup"), y);

  pdf.setFontSize(10);
  pdf.text(`Duration: ${$("duration").value || "-"}`, 10, y);
  y += 8;

  y = addGroupSection(pdf, "Patch Group", getCheckedValuesByGroup("patchGroup"), y);
  y = addGroupSection(pdf, "Growth", getCheckedValuesByGroup("growthGroup"), y);
  y = addGroupSection(pdf, "Mucosa", getCheckedValuesByGroup("mucosaGroup"), y);
  y = addGroupSection(pdf, "Pigmentation", getCheckedValuesByGroup("pigmentationGroup"), y);
  y = addGroupSection(pdf, "Habit History", getCheckedValuesByGroup("habitGroup"), y);
  y = addGroupSection(pdf, "Symptoms", getCheckedValuesByGroup("symptomGroup"), y);
  y = addGroupSection(pdf, "Sharp Teeth", getCheckedValuesByGroup("teethGroup"), y);
  y = addGroupSection(pdf, "Past History", getCheckedValuesByGroup("illnessGroup"), y);

    pdf.setFontSize(10);
  pdf.text(`Previous Visit: ${$("prevVisit").value || "-"}`, 10, y);
  y += 10;

  /* ---------- LESION LOCATION ---------- */
  pdf.setFontSize(10);
  pdf.text(`Lesion Location: ${$("lesionLocation").value || "-"}`, 10, y);
  y += 10;

  /* ---------- CLINICAL IMAGES ---------- */
  const images = await getSelectedSlotImages();

  if (images.length) {
    pdf.addPage();
    y = 10;

    pdf.setFontSize(11);
    pdf.text("Clinical Images", 10, y);
    y += 6;

    let x = 10;
    const imgW = 60;
    const imgH = 45;

    images.forEach(img => {
      if (!img.dataURL?.startsWith("data:image")) return;

      if (y + imgH > 280) {
        pdf.addPage();
        y = 10;
        x = 10;
      }

      pdf.addImage(img.dataURL, "JPEG", x, y, imgW, imgH);
      pdf.setFontSize(8);
      pdf.text(`View ${img.index + 1}`, x, y + imgH + 4);

      x += imgW + 6;
      if (x > 140) {
        x = 10;
        y += imgH + 12;
      }
    });
  }

  /* ---------- ANALYSIS ---------- */
  pdf.addPage();
  y = 10;

  pdf.setFontSize(11);
  pdf.text("Analysis", 10, y);
  y += 6;

  pdf.setFontSize(9);
  pdf.text(
    pdf.splitTextToSize($("analysis").textContent || "-", 190),
    10,
    y
  );
  y += 25;

  /* ---------- DIAGNOSIS ---------- */
  pdf.setFontSize(11);
  pdf.text("Diagnosis", 10, y);
  y += 6;

  pdf.setFontSize(10);
  pdf.text(`Provisional: ${$("provDiag").value || "-"}`, 10, y);
  y += 5;
  pdf.text(`Differential: ${$("diffDiag").value || "-"}`, 10, y);
  y += 5;
  pdf.text(`Advice: ${$("advise").value || "-"}`, 10, y);
  if ($("riskIndex").value) {
  y += 6;
  pdf.setFontSize(10);
  pdf.text(`Risk Index: ${$("riskIndex").value}`, 10, y);
}


  /* ---------- SAVE ---------- */
  pdf.save(`Case_${$("caseNumber").value || "Report"}.pdf`);
}



  




