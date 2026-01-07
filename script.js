// Analysis logic: if 'White' patch selected -> use isolationWhite(); else use red isolation
const ANALYSIS_MAX_DIM = 800;
const LESION_LABELS = [
  "NO ABNORMALITY DETECTED","LICHEN PLANUS","ORALLEUKOPLAKIA",
  "CANDIDIASIS","SPECKLEDLEUKOPLAKIA","SEVERE DYSPLASIA",
  "OSMF","VERRUCOUSLEUKOPLAKIA"
];
let tmModel = null;
let tmLiveRunning = false;
let tmLastRun = 0;


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

// ------------------------ Algorithms ------------------------
function convertToBlackAndWhite(imageData){
  const w = imageData.width, h = imageData.height;
  const out = new ImageData(w, h);
  for(let i = 0; i < imageData.data.length; i += 4){
    const r = imageData.data[i], g = imageData.data[i+1], b = imageData.data[i+2];
    const y = 0.299*r + 0.587*g + 0.114*b;
    out.data[i] = out.data[i+1] = out.data[i+2] = y; out.data[i+3] = 255;
  }
  return out;
}

function changeRedcolor(imageData){
  const out = new ImageData(imageData.width, imageData.height);
  const debugMode = q('#debugToggle')?.checked;
  for(let i = 0; i < imageData.data.length; i += 4){
    const r = imageData.data[i], g = imageData.data[i+1], b = imageData.data[i+2];
    const gray = 0.299*r + 0.587*g + 0.114*b;
    const isDark = gray < 100; // simulate valMask3 dark mask
    if(isDark){
      // dark → green (to count)
      out.data[i] = 0; out.data[i+1] = 255; out.data[i+2] = 0; out.data[i+3] = 255;
    } else {
      // keep original
      out.data[i] = r; out.data[i+1] = g; out.data[i+2] = b; out.data[i+3] = 255;
    }
  }
  return out;
}

function isolationWhite(imageData){
  const out = new ImageData(imageData.width, imageData.height);
  for(let i = 0; i < imageData.data.length; i += 4){
    const r = imageData.data[i], g = imageData.data[i+1], b = imageData.data[i+2];
    const gray = 0.299*r + 0.587*g + 0.114*b;
    const isWhiteRange = gray >= 75 && gray <= 179;
    if(isWhiteRange){
      out.data[i] = r; out.data[i+1] = g; out.data[i+2] = b; out.data[i+3] = 255;
    } else {
      out.data[i] = 0; out.data[i+1] = 255; out.data[i+2] = 0; out.data[i+3] = 255;
    }
  }
  return out;
}

// Count only pure green pixels
function getCount(imageData){
  let greenCount = 0;
  for(let i = 0; i < imageData.data.length; i += 4){
    const r = imageData.data[i], g = imageData.data[i+1], b = imageData.data[i+2];
    if(r === 0 && g === 255 && b === 0){
      greenCount += g;
    }
  }
  return greenCount;
}

// ------------------------ Slots UI ------------------------
function initSlots() {
  // Reset the same array object
  slots.length = 0;

  const slotEls = document.querySelectorAll('#slotsContainer .slot');
  console.log("Found slot elements:", slotEls.length);

  slotEls.forEach((slotEl, i) => {
    const selCb = document.getElementById(`slot-select-${i}`);
    const amberCb = document.getElementById(`slot-amber-${i}`);
    const previewEl = slotEl.querySelector('.preview');
    const fileInput = slotEl.querySelector('input[type=file]');
    const capBtn = slotEl.querySelectorAll('button.btn.btn-ghost')[0];
    const remBtn = slotEl.querySelectorAll('button.btn.btn-ghost')[1];

    if (fileInput) {
      fileInput.addEventListener('change', e => {
        if (e.target.files && e.target.files[0]) {
          handleFileSelect(i, e.target.files[0]);
        }
      });
    }
    if (capBtn) capBtn.addEventListener('click', () => captureToSlot(i));
    if (remBtn) remBtn.addEventListener('click', () => removeSlot(i));

    slots.push({
      dataURL: null,
      selectedEl: selCb,
      amberEl: amberCb,
      previewEl: previewEl
    });
  });

  // Keep window.slots pointing to the same array
  window.slots = slots;
}


function setSlotImage(idx, dataUrl) {
  const s = window.slots[idx];
  if (!s) return;
  s.dataURL = dataUrl;
  if (s.previewEl) {
    s.previewEl.innerHTML = `<img src="${dataUrl}" style="max-width:100%; max-height:140px; display:block" />`;
  }
}

function removeSlot(idx) {
  const s = window.slots[idx];
  if (!s) return;
  s.dataURL = null;
  if (s.previewEl) s.previewEl.innerHTML = '<div class="small">No image</div>';
  if (s.selectedEl) s.selectedEl.checked = false;
  if (s.amberEl) s.amberEl.checked = false;
}

function handleFileSelect(idx, file) {
  const reader = new FileReader();
  reader.onload = e => setSlotImage(idx, e.target.result);
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
  const video = $('cameraPreview');
  if (!video || !video.srcObject) {
    alert('Camera not started');
    return;
  }
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.9);
  setSlotImage(idx, dataUrl);
}

async function loadTMWhiteModel() {
  if (tmModel) return;

  console.log("⏳ Loading TM model...");

  const modelURL = "assets/jsonimage_model/model.json";
  const metadataURL = "assets/jsonimage_model/metadata.json";

  tmModel = await tmImage.load(modelURL, metadataURL);

  console.log("✅ TM model loaded", tmModel.getClassLabels());
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

async function startCamera(){
  const sel = $('cameraSelect').value;
  if(stream) stopCamera();
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video:{ deviceId: sel ? { exact: sel } : undefined } });
    $('cameraPreview').srcObject = stream;
  }catch(e){ console.error(e); alert('Cannot start camera: '+e.message); }
  await startLiveLesionDetection();

}

function stopCamera(){
  if(stream){
    stream.getTracks().forEach(t => t.stop());
    stream = null; $('cameraPreview').srcObject = null;
  }
  stopLiveLesionDetection();

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
  if(csvCache) return csvCache;
  try{
    const res = await fetch('assets/finalDDoroscope3825new.csv');
    const txt = await res.text();
    const rows = txt.trim().split(/\r?\n/).map(safeCsvSplit);
    csvCache = rows; return rows;
  }catch(e){ console.warn('CSV load error', e); csvCache = []; return []; }
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
  console.log(window.slots.map((s,i) => ({ i, hasImage: !!s.dataURL, selected: s.selectedEl?.checked, amber: s.amberEl?.checked })));
  // Gather selected slots
  const selected = slots.map((s,i)=>({i,sel:s.selectedEl?.checked,url:s.dataURL}))
                        .filter(x=>x.url && x.sel);
                        console.log("Slots state:", slots);
console.log("Selected:", selected);

  if (selected.length !== 2) {
  alert('Select exactly two images (with checkboxes ticked).');
  return;
}


  // Amber slot must be exactly one
  const amber = slots.map((s,i)=>({i,amber:s.amberEl?.checked,url:s.dataURL}))
                     .filter(x=>x.url && x.amber);
  if (amber.length !== 1) {
    alert('Please mark exactly ONE Amber image.');
    return;
  }

  // Detect patch type from UI
  const patchSelected = Array.from(document.querySelectorAll('#patchGroup input'))
    .filter(cb => cb.checked)
    .map(cb => (cb.dataset.key||'').toString().trim().toUpperCase());
  const useWhiteIsolation = patchSelected.includes('WHITE');

  // Get imageData for both selected images
  const idA = await getImageDataFromDataUrlResized(selected[0].url, ANALYSIS_MAX_DIM);
  const idB = await getImageDataFromDataUrlResized(selected[1].url, ANALYSIS_MAX_DIM);

  // Convert to BW first
  const bwA = convertToBlackAndWhite(idA);
  const bwB = convertToBlackAndWhite(idB);

  // Apply isolation
  const maskA = useWhiteIsolation ? isolationWhite(bwA) : changeRedcolor(bwA);
  const maskB = useWhiteIsolation ? isolationWhite(bwB) : changeRedcolor(bwB);

  // Counts
  const countA = getCount(maskA);
  const countB = getCount(maskB);

  // Percent variation
  const denom = Math.max(countA, countB, 1);
  const percents = (Math.abs(countA - countB) / denom) * 100;

  // TFLite predictions
  let predA = '', predB = '', predText = '';
  try {
    predA = await runTFLitePredictionOnImageData(idA);
    predB = await runTFLitePredictionOnImageData(idB);
    predText = predA === predB ? (predA || 'N/A') : `${predA || 'N/A'} | ${predB || 'N/A'}`;
  } catch(e) {
    console.warn('TFLite prediction failed', e);
    predText = 'N/A';
  }

  // Push mask previews
  try{ putMaskPreviewInSlot(8, maskA, countA); }catch(e){ console.warn('slot9 failed', e); }
  try{ putMaskPreviewInSlot(9, maskB, countB); }catch(e){ console.warn('slot10 failed', e); }
  try{ putMaskPreviewInSlot(6, bwA, countA); }catch(e){ console.warn('slot7 failed', e); }
  try{ putMaskPreviewInSlot(7, bwB, countB); }catch(e){ console.warn('slot8 failed', e); }

  // CSV diagnosis
  const csvResult = await getCsvDiagnosisFull();
  const csvText = (csvResult.provisional || csvResult.differential || csvResult.advice)
    ? `Provisional: ${csvResult.provisional}\nDifferential: ${csvResult.differential}\nAdvice: ${csvResult.advice}`
    : 'No CSV match found';
  $('provDiag').value = csvResult.provisional  || '';
  $('diffDiag').value = csvResult.differential || '';
  $('advise').value = csvResult.advice || '';

  // Status
  $('status').textContent = `Mask counts → Img1: ${countA}, Img2: ${countB}`;

  // Conclusion bands
  let resultText = '';
  if (percents < 120) {
    resultText = 'Variable Diagnosis, observe two weeks.';
  } else if (percents <= 124) {
    resultText = 'Borderline Dysplasia ? refer to a specialist.';
  } else {
    resultText = 'Suggestive of Dysplasia refer to a specialist.';
  }

  // Final analysis output
  $('analysis').textContent =
    `Img1 G-sum: ${countA}\n` +
    `Img2 G-sum: ${countB}\n` +
    `Variation%: ${percents.toFixed(2)}%\n` +
    `TFLite: ${predText}\n\n` +
    `Condensed Key: ${ddnewfinaltxt()}\n\n` + 
    `${csvText}\n\n` +
    `Conclusion: ${resultText}`;
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

  async function init(){
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
    await loadTMWhiteModel();

  }

  init();
})();



// ------------------------ Init & wiring ------------------------
async function init(){
  initSlots();
  await refreshCameras().catch(()=>{});
  await loadTflite().catch(()=>{});
  // wire buttons
  $('refreshCams').addEventListener('click', refreshCameras);
  $('startCam').addEventListener('click', startCamera);
  $('stopCam').addEventListener('click', stopCamera);
  $('clearBtn').addEventListener('click', ()=>location.reload());
  wireAnalyze();
}

function wireAnalyze(){
  const btn = $('analyzeBtn');
  btn.addEventListener('click', async ()=>{
    btn.disabled = true; btn.textContent = 'Analyzing...';
    try{
      await analyzePredictAndFuse();
    }catch(e){
      console.error(e); alert('Analysis error: '+e.message);
    }finally{
      btn.disabled = false; btn.textContent = 'Analyze Selected Images';
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

async function predictFromCameraFrame() {
  if (!tmModel) {
    console.warn("❌ TM model not loaded");
    return null;
  }

  const video = document.getElementById("cameraPreview");
  if (!video || video.readyState < 2) {
    console.warn("❌ Video not ready");
    return null;
  }

  const predictions = await tmModel.predict(video);
  console.log("📊 Predictions:", predictions);

  predictions.sort((a, b) => b.probability - a.probability);
  return predictions;
}



async function startLiveLesionDetection() {
  if (tmLiveRunning) return;

  await loadTMWhiteModel();   // ✅ now legal

  tmLiveRunning = true;
  tmLastRun = 0;

  const loop = async () => {
    if (!tmLiveRunning) return;

    const now = performance.now();
    if (now - tmLastRun > 600) {
      tmLastRun = now;
      try {
        const preds = await predictFromCameraFrame();
        if (preds && preds.length) {
          displayLivePrediction(preds);
        }
      } catch (e) {
        console.warn("TM live prediction failed", e);
      }
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}


function stopLiveLesionDetection() {
  tmLiveRunning = false;
}

function displayLivePrediction(predictions) {
  const el = document.getElementById("livePrediction");
  if (!el) {
    console.warn("❌ livePrediction element missing");
    return;
  }

  const top = predictions[0];
  el.textContent = `${top.className} : ${(top.probability * 100).toFixed(1)}%`;
}






