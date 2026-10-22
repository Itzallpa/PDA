// Department Kiosk Logic with Batch Multi-Scan Support
let currentDeptId = 'IB';
let currentMode = 'CHECK_OUT'; // 'CHECK_OUT' | 'CHECK_IN'
let html5QrScanner = null;
let currentBatchDevices = []; // Holds devices staged in current batch
let currentCabinetDevices = []; // Holds devices belonging to current cabinet

const DEPT_NAMES = {
  'IB': { name: 'Inbound', desc: 'รับเข้าสินค้า' },
  'MS': { name: 'Manual Sort', desc: 'คัดแยกด้วยมือ' },
  'CBS': { name: 'Cross Belt Sort', desc: 'คัดแยกสายพาน Cross Belt' },
  'MCBS': { name: 'Mini Cross Belt Sort', desc: 'คัดแยกสายพาน Mini Cross Belt' },
  'OBI': { name: 'Outbound Induction', desc: 'อินดักชั่นขาออก' },
  'OBS': { name: 'Outbound Sort', desc: 'คัดแยกขาออก' },
  'OBD': { name: 'Outbound Dispatch', desc: 'จ่ายสินค้าออก' }
};

document.addEventListener('DOMContentLoaded', () => {
  initDepartment();
  initClock();
  setupScanInputListeners();
  loadCabinetData();

  // Auto-refresh cabinet list every 4 seconds
  setInterval(loadCabinetData, 4000);
});

function normalizeDeptCode(s) {
  return (s || '').replace(/[\s\-_]+/g, '').toUpperCase();
}

function isDepartmentCompatible(d1, d2, devDeptName = '') {
  if (!d1 || !d2) return true;
  const n1 = normalizeDeptCode(d1);
  const n2 = normalizeDeptCode(d2);
  if (n1 === n2) return true;
  if (devDeptName) {
    const nName = normalizeDeptCode(devDeptName);
    if (nName === n2) return true;
  }
  return false;
}

function initDepartment() {
  const pathParts = window.location.pathname.split('/');
  const deptIdx = pathParts.indexOf('dept');
  let dept = 'IB';

  if (deptIdx !== -1 && pathParts[deptIdx + 1]) {
    try {
      dept = decodeURIComponent(pathParts[deptIdx + 1]).trim();
    } catch (e) {
      dept = pathParts[deptIdx + 1].trim();
    }
  } else {
    const params = new URLSearchParams(window.location.search);
    if (params.get('dept')) {
      try {
        dept = decodeURIComponent(params.get('dept')).trim();
      } catch (e) {
        dept = params.get('dept').trim();
      }
    }
  }

  currentDeptId = dept || 'IB';

  // Set default initial UI headers from cache or fallback
  const info = DEPT_NAMES[currentDeptId] || { name: currentDeptId, desc: 'ตู้จัดเก็บประจำแผนก' };
  document.getElementById('kiosk-dept-badge').textContent = currentDeptId;
  document.getElementById('kiosk-dept-title').textContent = `ตู้จัดเก็บ PDA - แผนก ${info.name}`;
  document.getElementById('kiosk-dept-desc').textContent = info.desc.startsWith('ประจำ') ? info.desc : `ประจำแผนก${info.desc}`;
  document.getElementById('panel-dept-id').textContent = currentDeptId;
  
  document.title = `ตู้จัดเก็บ [${currentDeptId}] - PDA Storage`;

  // Fetch latest department names from API dynamically
  fetchDynamicDeptInfo();

  focusPrimaryInput();
}

async function fetchDynamicDeptInfo() {
  try {
    const res = await fetch('/api/departments');
    const data = await res.json();
    if (data.success && data.departments && data.departments.length > 0) {
      // 1. Populate top header quick-switch dropdown
      const quickSelect = document.getElementById('quick-dept-select');
      if (quickSelect) {
        quickSelect.innerHTML = data.departments.map(d => `
          <option value="${d.id}">${d.id} - ${d.name}</option>
        `).join('');
      }

      // 2. Resolve currentDeptId flexibly (Exact -> Case-insensitive -> Normalized -> Prefix -> Single Dept)
      let found = data.departments.find(d => d.id === currentDeptId);
      if (!found) {
        found = data.departments.find(d => d.id.toLowerCase() === currentDeptId.toLowerCase());
      }
      if (!found) {
        found = data.departments.find(d => normalizeDeptCode(d.id) === normalizeDeptCode(currentDeptId) || normalizeDeptCode(d.name) === normalizeDeptCode(currentDeptId));
      }
      if (!found) {
        found = data.departments.find(d => normalizeDeptCode(d.id).startsWith(normalizeDeptCode(currentDeptId)) || normalizeDeptCode(currentDeptId).startsWith(normalizeDeptCode(d.id)));
      }
      if (!found && data.departments.length === 1) {
        // If only 1 department exists in the system (e.g. OBD A), automatically bind to it!
        found = data.departments[0];
      }

      if (found) {
        currentDeptId = found.id;
        document.getElementById('kiosk-dept-badge').textContent = found.id;
        document.getElementById('kiosk-dept-title').textContent = `ตู้จัดเก็บ PDA - แผนก ${found.name}`;
        const descText = found.description || 'ตู้จัดเก็บประจำแผนก';
        document.getElementById('kiosk-dept-desc').textContent = descText.startsWith('ประจำ') ? descText : `ประจำแผนก${descText}`;
        document.getElementById('panel-dept-id').textContent = found.id;
        document.title = `ตู้จัดเก็บ [${found.id}] - PDA Storage`;
        if (quickSelect) quickSelect.value = found.id;
        
        // Re-load cabinet devices with resolved canonical dept id
        loadCabinetData();
      }
    }
  } catch (err) {
    console.warn('Silent dept fetch error:', err);
  }
}

function initClock() {
  const clockElem = document.getElementById('live-clock');
  function updateTime() {
    const now = new Date();
    clockElem.textContent = now.toLocaleTimeString('th-TH');
  }
  updateTime();
  setInterval(updateTime, 1000);
}

function setMode(mode) {
  if (currentBatchDevices.length > 0) {
    if (!confirm('คุณมีรายการ PDA ที่สแกนค้างไว้ในชุด ต้องการสลับโหมดและล้างชุดรายการเดิมหรือไม่?')) {
      return;
    }
    clearBatchQueue();
  }

  currentMode = mode === 'CHECK_IN' ? 'CHECK_IN' : 'CHECK_OUT';
  const btnCheckout = document.getElementById('btn-mode-checkout');
  const btnCheckin = document.getElementById('btn-mode-checkin');
  const submitBtn = document.getElementById('btn-submit');
  const submitText = document.getElementById('submit-text');
  const reqMark = document.getElementById('req-staff-mark');

  btnCheckout.classList.remove('active');
  btnCheckin.classList.remove('active');
  submitBtn.classList.remove('checkout', 'checkin');

  if (currentMode === 'CHECK_OUT') {
    btnCheckout.classList.add('active');
    submitBtn.classList.add('checkout');
    if (submitText) submitText.textContent = 'ยืนยันเบิกออก';
    if (reqMark) reqMark.style.display = 'inline';
  } else {
    btnCheckin.classList.add('active');
    submitBtn.classList.add('checkin');
    if (submitText) submitText.textContent = 'ยืนยันคืนเข้าตู้';
    if (reqMark) reqMark.style.display = 'none';
  }

  updateSubmitButtonLabel();
  focusPrimaryInput();
}

function focusPrimaryInput() {
  const staffInput = document.getElementById('input-staff-id');
  const pdaInput = document.getElementById('input-pda-code');

  if (currentMode === 'CHECK_OUT') {
    if (!staffInput.value.trim()) {
      staffInput.focus();
    } else {
      pdaInput.focus();
    }
  } else {
    pdaInput.focus();
  }
}

let autoAddTimeout = null;

/**
 * Locks an input element so it can ONLY receive input from a hardware barcode scanner.
 * - Blocks paste, drop, cut, contextmenu
 * - Blocks manual keyboard typing (preventDefault on single keys, buffer in memory)
 * - Verifies inter-keystroke intervals (< 55ms average, < 85ms max)
 * - If user types slowly with keyboard or presses Backspace/Delete, displays warning and plays error sound
 * - Supports scanners terminating with Enter or Tab
 * - Also supports fast barcode bursts without Enter suffix via an inactivity check
 */
function bindScanOnlyField(inputElem, options = {}) {
  if (!inputElem) return;

  const warningDiv = options.warningDivId ? document.getElementById(options.warningDivId) : null;
  const onValidScan = options.onValidScan;
  const fieldLabel = options.fieldName || 'ช่องนี้';

  let scanBuffer = '';
  let keyTimestamps = [];
  let burstTimer = null;
  let warnTimer = null;

  function flashWarning(msg) {
    if (window.soundManager && typeof window.soundManager.playError === 'function') {
      window.soundManager.playError();
    }

    if (warningDiv) {
      warningDiv.textContent = msg;
      warningDiv.style.display = 'block';
      clearTimeout(warnTimer);
      warnTimer = setTimeout(() => {
        warningDiv.style.display = 'none';
      }, 3500);
    }

    inputElem.style.borderColor = '#dc2626';
    inputElem.style.boxShadow = '0 0 0 3px rgba(220, 38, 38, 0.25)';
    setTimeout(() => {
      inputElem.style.borderColor = '';
      inputElem.style.boxShadow = '';
    }, 1200);
  }

  // 1. Block Paste, Drop, Cut, ContextMenu
  ['paste', 'drop'].forEach(evt => {
    inputElem.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      scanBuffer = '';
      keyTimestamps = [];
      flashWarning(`🚫 ไม่อนุญาตให้ Copy / Paste (${fieldLabel}) — กรุณาใช้เครื่องยิงสแกนบาร์โค้ดเท่านั้น!`);
    });
  });

  ['cut', 'contextmenu'].forEach(evt => {
    inputElem.addEventListener(evt, (e) => {
      e.preventDefault();
    });
  });

  // 2. Prevent mobile on-screen keyboard from popping up on touchscreens/PDAs
  inputElem.setAttribute('inputmode', 'none');
  inputElem.setAttribute('autocomplete', 'off');
  inputElem.setAttribute('autocorrect', 'off');
  inputElem.setAttribute('autocapitalize', 'off');
  inputElem.setAttribute('spellcheck', 'false');

  // 3. Intercept Keydown to block human typing while allowing rapid scanner bursts
  inputElem.addEventListener('keydown', (e) => {
    // Intercept Ctrl/Cmd paste shortcuts (Ctrl+V, Shift+Insert)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V' || e.key === 'Insert')) {
      e.preventDefault();
      scanBuffer = '';
      keyTimestamps = [];
      flashWarning(`🚫 ไม่อนุญาตให้กดวางข้อความ (Ctrl+V) — กรุณาใช้เครื่องยิงสแกนเท่านั้น!`);
      return;
    }

    // Ignore modifier keys
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) {
      return;
    }

    // Block Backspace / Delete
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      scanBuffer = '';
      keyTimestamps = [];
      flashWarning(`🚫 ไม่อนุญาตให้พิมพ์หรือแก้ไขด้วยมือ (${fieldLabel}) — กรุณาใช้เครื่องยิงสแกนบาร์โค้ดเท่านั้น!`);
      return;
    }

    const now = performance.now();

    // Check for Scanner Terminating Key: Enter or Tab
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      clearTimeout(burstTimer);

      const val = scanBuffer.trim();
      const count = keyTimestamps.length;

      if (!val) {
        scanBuffer = '';
        keyTimestamps = [];
        return;
      }

      // Scanner check: must have at least 2 characters and fast burst speed
      if (count < 2) {
        scanBuffer = '';
        keyTimestamps = [];
        flashWarning(`🚫 ไม่อนุญาตให้พิมพ์ด้วยคีย์บอร์ด — ระบบล็อกให้ใช้เครื่องยิงสแกนบาร์โค้ดเท่านั้น!`);
        return;
      }

      let totalInterval = 0;
      let maxInterval = 0;
      for (let i = 1; i < count; i++) {
        const diff = keyTimestamps[i] - keyTimestamps[i - 1];
        totalInterval += diff;
        if (diff > maxInterval) maxInterval = diff;
      }
      const avgInterval = totalInterval / (count - 1);

      // Barcode scanners send keys in rapid bursts (avg < 110ms, max < 180ms)
      if (avgInterval > 110 || maxInterval > 180) {
        scanBuffer = '';
        keyTimestamps = [];
        flashWarning(`🚫 ตรวจพบการพิมพ์ด้วยมือ — ระบบอนุญาตเฉพาะการยิงสแกนบาร์โค้ดเท่านั้น!`);
        return;
      }

      // Valid barcode scan!
      const scannedVal = val;
      scanBuffer = '';
      keyTimestamps = [];
      if (warningDiv) warningDiv.style.display = 'none';

      if (typeof onValidScan === 'function') {
        onValidScan(scannedVal);
      }
      return;
    }

    // Printable single character (scanner or keyboard)
    if (e.key.length === 1) {
      // Prevent character from directly appearing in DOM input field
      e.preventDefault();

      if (keyTimestamps.length > 0) {
        const lastTime = keyTimestamps[keyTimestamps.length - 1];
        const diff = now - lastTime;

        // If gap between keys > 180ms, a human is typing with fingers
        if (diff > 180) {
          scanBuffer = '';
          keyTimestamps = [];
          clearTimeout(burstTimer);
          flashWarning(`🚫 ไม่อนุญาตให้พิมพ์ด้วยมือ — ระบบล็อกให้ใช้เครื่องยิงสแกนบาร์โค้ดเท่านั้น!`);
          return;
        }
      }

      scanBuffer += e.key;
      keyTimestamps.push(now);

      // Inactivity timeout:
      // If no next key arrives within 90ms:
      // Check if it was a valid fast scanner burst without an Enter suffix (>= 3 chars, fast avg)
      clearTimeout(burstTimer);
      burstTimer = setTimeout(() => {
        const len = scanBuffer.length;
        if (len >= 3) {
          let tot = 0;
          let mx = 0;
          for (let i = 1; i < keyTimestamps.length; i++) {
            const d = keyTimestamps[i] - keyTimestamps[i - 1];
            tot += d;
            if (d > mx) mx = d;
          }
          const avg = tot / (keyTimestamps.length - 1);
          if (avg <= 90 && mx <= 160) {
            // Valid barcode scan without Enter suffix!
            const scannedVal = scanBuffer.trim();
            scanBuffer = '';
            keyTimestamps = [];
            if (warningDiv) warningDiv.style.display = 'none';
            if (typeof onValidScan === 'function') {
              onValidScan(scannedVal);
            }
            return;
          }
        }

        // Slow key or single character from human typing
        scanBuffer = '';
        keyTimestamps = [];
        flashWarning(`🚫 ไม่อนุญาตให้พิมพ์ด้วยมือ (${fieldLabel}) — กรุณาใช้เครื่องยิงสแกนบาร์โค้ดเท่านั้น!`);
      }, 90);
    }
  });
}

function setupScanInputListeners() {
  const staffInput = document.getElementById('input-staff-id');
  const pdaInput = document.getElementById('input-pda-code');
  const btnClearStaff = document.getElementById('btn-clear-staff');

  // 1. Staff ID: Allows BOTH manual typing and barcode scanning
  staffInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const val = staffInput.value.trim();
      if (val) {
        if (window.soundManager) window.soundManager.playBeep();
        if (btnClearStaff) btnClearStaff.style.display = 'inline';

        // If PDA devices are already staged in batch queue, confirm/submit immediately!
        if (currentBatchDevices.length > 0) {
          submitBatchOrSingle();
        } else {
          pdaInput.focus();
        }
      }
    }
  });

  staffInput.addEventListener('input', () => {
    if (btnClearStaff) {
      btnClearStaff.style.display = staffInput.value.trim() ? 'inline' : 'none';
    }
  });

  // 2. PDA Code (รูป 2): STRICTLY SCAN-ONLY (ห้ามพิมพ์ด้วยมือเด็ดขาด - ล็อกใช้เครื่องยิงสแกนเท่านั้น)
  bindScanOnlyField(pdaInput, {
    warningDivId: 'warn-pda-code',
    fieldName: 'รหัส PDA',
    onValidScan: (scannedVal) => {
      const cleanVal = (scannedVal || '').trim();
      if (!cleanVal) return;

      pdaInput.value = '';
      processInputCodes(cleanVal);
    }
  });

  // 3. Document-level background scanner listener (ดักจับการยิงบาร์โค้ดแม้ไม่ได้คลิกช่อง input)
  let globalScanBuffer = '';
  let globalTimestamps = [];
  let globalTimer = null;

  document.addEventListener('keydown', (e) => {
    // If active element is input-staff-id, let user type/scan there normally
    if (document.activeElement === staffInput) return;
    // If active element is input-pda-code, bindScanOnlyField handles it
    if (document.activeElement === pdaInput) return;

    if (e.key === 'Enter' || e.key === 'Tab') {
      const val = globalScanBuffer.trim();
      const count = globalTimestamps.length;
      globalScanBuffer = '';
      globalTimestamps = [];
      clearTimeout(globalTimer);

      if (val && count >= 2) {
        let tot = 0;
        let mx = 0;
        for (let i = 1; i < count; i++) {
          const d = globalTimestamps[i] - globalTimestamps[i - 1];
          tot += d;
          if (d > mx) mx = d;
        }
        const avg = tot / (count - 1);
        if (avg <= 110 && mx <= 180) {
          // Scanner burst detected from background!
          e.preventDefault();
          pdaInput.value = '';
          processInputCodes(val);
        }
      }
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = performance.now();
      if (globalTimestamps.length > 0) {
        const last = globalTimestamps[globalTimestamps.length - 1];
        if (now - last > 180) {
          globalScanBuffer = '';
          globalTimestamps = [];
        }
      }
      globalScanBuffer += e.key;
      globalTimestamps.push(now);
      clearTimeout(globalTimer);
      globalTimer = setTimeout(() => {
        globalScanBuffer = '';
        globalTimestamps = [];
      }, 180);
    }
  });
}

function handleAddPdaButtonClick() {
  const pdaInput = document.getElementById('input-pda-code');
  clearTimeout(autoAddTimeout);
  const val = pdaInput.value.trim();
  if (val) {
    pdaInput.value = '';
    processInputCodes(val);
  } else {
    pdaInput.focus();
  }
}

function clearStaffId() {
  const staffInput = document.getElementById('input-staff-id');
  const btnClearStaff = document.getElementById('btn-clear-staff');
  staffInput.value = '';
  if (btnClearStaff) btnClearStaff.style.display = 'none';
  staffInput.focus();
}

// -------------------------------------------------------------
// Batch Queue Management & Smart Code Tokenizer
// -------------------------------------------------------------

function parseCodes(rawInput) {
  if (!rawInput) return [];
  const text = rawInput.trim();
  if (!text) return [];

  // 1. Delimiter-separated tokens (space, comma, semicolon, tab, newline)
  const rawTokens = text.split(/[\s,;\t\r\n]+/).filter(Boolean);
  const result = [];

  for (const token of rawTokens) {
    // 1. Direct match with any known device in cabinet (either custom_sn OR original_sn)
    if (currentCabinetDevices && currentCabinetDevices.length > 0) {
      const directMatch = currentCabinetDevices.find(
        d => (d.custom_sn && d.custom_sn.toLowerCase() === token.toLowerCase()) ||
             (d.original_sn && d.original_sn.toLowerCase() === token.toLowerCase())
      );
      if (directMatch) {
        result.push(token);
        continue;
      }
    }

    // 2. Match against known cabinet devices greedily (e.g. back-to-back scan like OB01OB02)
    if (currentCabinetDevices && currentCabinetDevices.length > 0) {
      let temp = token;
      const allKnown = currentCabinetDevices
        .flatMap(d => [d.custom_sn, d.original_sn])
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);

      const subList = [];
      let progress = true;
      while (temp.length > 0 && progress) {
        progress = false;
        for (const k of allKnown) {
          if (temp.toLowerCase().startsWith(k.toLowerCase())) {
            subList.push(temp.slice(0, k.length));
            temp = temp.slice(k.length);
            progress = true;
            break;
          }
        }
      }

      if (temp.length === 0 && subList.length > 1) {
        result.push(...subList);
        continue;
      }
    }

    // 3. Keep token intact (DO NOT split arbitrary serial numbers with regex)
    result.push(token);
  }

  return result;
}

async function processInputCodes(rawInput) {
  const codes = parseCodes(rawInput);
  if (codes.length === 0) return false;

  const staffInput = document.getElementById('input-staff-id');
  const pdaInput = document.getElementById('input-pda-code');

  let addedCount = 0;
  for (const code of codes) {
    const success = await addSinglePdaToBatch(code);
    if (success) addedCount++;
  }

  const staff_id = staffInput.value.trim();
  if (addedCount > 0) {
    if (window.soundManager) window.soundManager.playBeep();
    if (currentMode === 'CHECK_OUT' && !staff_id) {
      showFeedback('info', `✅ สแกนเครื่องเข้าชุดแล้ว (${currentBatchDevices.length} เครื่อง)<br>👉 กรุณาสแกนหรือกรอก <strong>"รหัสพนักงาน"</strong> เพื่อยืนยันการเบิก`);
      staffInput.focus();
      return true;
    }
  }

  pdaInput.focus();
  return addedCount > 0;
}

// Alias for camera scanner
function addPdaToBatch(code) {
  return processInputCodes(code);
}

// One-click switch to CHECK_OUT and stage device
window.switchAndQueue = async function(customSn) {
  setMode('CHECK_OUT');
  await processInputCodes(customSn);
};

async function addSinglePdaToBatch(code) {
  const cleanCode = (code || '').trim();
  if (!cleanCode) return false;

  const scannerBox = document.getElementById('scanner-box');
  const staffInput = document.getElementById('input-staff-id');
  const pdaInput = document.getElementById('input-pda-code');

  // Check if device is already in current batch queue
  const isAlreadyInQueue = currentBatchDevices.some(
    d => d.original_sn.toLowerCase() === cleanCode.toLowerCase() || d.custom_sn.toLowerCase() === cleanCode.toLowerCase()
  );
  if (isAlreadyInQueue) {
    if (window.soundManager) window.soundManager.playBeep();
    showFeedback('info', `ℹ️ รหัส "${cleanCode}" ถูกเพิ่มไว้ในชุดรายการนี้แล้ว`);
    return false;
  }

  // Resolve device from API
  try {
    const res = await fetch(`/api/devices/resolve/${encodeURIComponent(cleanCode)}`);
    const data = await res.json();

    if (!data.success || !data.device) {
      if (window.soundManager) window.soundManager.playError();
      scannerBox.classList.remove('flash-success');
      scannerBox.classList.add('flash-error');
      setTimeout(() => scannerBox.classList.remove('flash-error'), 800);

      // Record Abnormal log for unregistered/unknown barcode immediately
      const staffVal = staffInput.value.trim() || 'UNKNOWN';
      try {
        await fetch('/api/logs/abnormal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: cleanCode,
            original_sn: cleanCode,
            custom_sn: cleanCode,
            department_id: currentDeptId || 'UNKNOWN',
            staff_id: staffVal,
            notes: `ยิงเครื่องไม่พบในระบบ: สแกนรหัส "${cleanCode}" ที่ตู้ [${currentDeptId || 'UNKNOWN'}]`
          })
        });
        localStorage.setItem('pda_abnormal_updated', Date.now().toString());
      } catch (err) {
        console.error('Error logging abnormal scan:', err);
      }

      showFeedback('error', `
        <div style="display: inline-block; background: #dc2626; color: #fff; font-size: 0.82rem; font-weight: 800; padding: 0.25rem 0.75rem; border-radius: 9999px; margin-bottom: 0.6rem; letter-spacing: 0.05em; box-shadow: 0 2px 4px rgba(220,38,38,0.25);">
          🚨 ไม่พบในระบบ (บันทึก Log Abnormal แล้ว)
        </div>
        <div style="font-size: 1.12rem; font-weight: 800; color: #dc2626; margin-bottom: 0.35rem;">
          ❌ ไม่พบอุปกรณ์รหัส "${cleanCode}" ในระบบฐานข้อมูล
        </div>
        <div style="font-size: 0.92rem; color: #7f1d1d; margin-bottom: 0.5rem; line-height: 1.45;">
          กรุณาตรวจสอบว่าลงทะเบียนเครื่องแล้วหรือยัง (ระบบบันทึกประวัติ Abnormal ลงหน้า Log เรียบร้อยแล้ว)
        </div>
      `, '⚠️ ไม่พบข้อมูลอุปกรณ์');
      return false;
    }

    // If API returned a compound match of multiple devices (e.g. ad003ad004)
    if (data.isCompound && Array.isArray(data.devices)) {
      for (const dev of data.devices) {
        addDeviceToQueueDirect(dev);
      }
      renderBatchList();
      hideFeedback();
      return true;
    }

    const device = data.device;

    // Strict Department Validation:
    // Device MUST belong to this cabinet's department!
    // Reject scanning foreign devices that do not belong to this cabinet.
    const devDeptName = device.department_name || device.department_id;
    if (device.department_id && currentDeptId && !isDepartmentCompatible(device.department_id, currentDeptId, devDeptName)) {
      if (window.soundManager) window.soundManager.playError();
      scannerBox.classList.remove('flash-success');
      scannerBox.classList.add('flash-error');
      setTimeout(() => scannerBox.classList.remove('flash-error'), 800);

      // Record Abnormal log to backend immediately
      const modeLabel = currentMode === 'CHECK_OUT' ? 'เบิกออก' : 'คืนเข้าตู้';
      const staffVal = staffInput.value.trim() || 'UNKNOWN';
      try {
        await fetch('/api/logs/abnormal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: device.id,
            original_sn: device.original_sn,
            custom_sn: device.custom_sn,
            department_id: currentDeptId,
            staff_id: staffVal,
            notes: `ยิงผิดตู้: เครื่องสังกัดตู้ [${device.department_id} - ${devDeptName}] ถูกนำมายิงที่ตู้ [${currentDeptId}] (โหมด${modeLabel})`
          })
        });
        localStorage.setItem('pda_abnormal_updated', Date.now().toString());
      } catch (err) {
        console.error('Error logging abnormal scan:', err);
      }

      showFeedback('error', `
        <div style="display: inline-block; background: #dc2626; color: #fff; font-size: 0.82rem; font-weight: 800; padding: 0.25rem 0.75rem; border-radius: 9999px; margin-bottom: 0.6rem; letter-spacing: 0.05em; box-shadow: 0 2px 4px rgba(220,38,38,0.25);">
          🚨 ยิงผิดตู้ (บันทึก Log Abnormal แล้ว)
        </div>
        <div style="font-size: 1.12rem; font-weight: 800; color: #dc2626; margin-bottom: 0.35rem;">
          ❌ ยิงผิดตู้! อุปกรณ์ [${device.custom_sn || device.original_sn}] สังกัดตู้แผนก "${devDeptName}"
        </div>
        <div style="font-size: 0.92rem; color: #7f1d1d; margin-bottom: 0.5rem; line-height: 1.45;">
          เครื่องนี้ไม่ได้ผูกไว้กับตู้ของแผนก <strong>[${currentDeptId}]</strong> ระบบไม่อนุญาตให้ทำรายการที่ตู้นี้
        </div>
        <div style="font-size: 0.85rem; color: #991b1b; background: #fee2e2; border: 1px solid #fca5a5; padding: 0.45rem 0.75rem; border-radius: 6px; margin-bottom: 0.35rem;">
          👉 กรุณานำ PDA เครื่องนี้ไปสแกนทำรายการที่ <strong>หน้าตู้ประจำแผนก ${devDeptName}</strong>
        </div>
        <div style="font-size: 0.78rem; color: #6b7280;">
          (บันทึกเหตุการณ์ลงหน้า Log เรียบร้อยแล้ว)
        </div>
      `, '⚠️ ยิงผิดตู้');
      return false;
    }

    // Status Validations with Actionable Guidance
    if (currentMode === 'CHECK_OUT' && device.status === 'CHECKED_OUT') {
      // In warehouse, if device was marked CHECKED_OUT in system but is physically present in cabinet:
      // Allow taking it out and auto-transferring to the new staff!
      device.autoTransferFrom = device.current_staff_id;
      if (window.soundManager) window.soundManager.playBeep();
      showFeedback('info', `
        <div style="font-size: 1rem; font-weight: 700; color: #b45309; margin-bottom: 0.25rem;">
          🔄 นำเครื่อง [${device.custom_sn}] เข้าชุดเบิกออกแล้ว
        </div>
        <div style="font-size: 0.85rem; color: #92400e;">
          (เดิมค้างชื่อผู้เบิก: ${device.current_staff_id || 'คนก่อนหน้า'} — ระบบจะโอนย้ายชื่อเป็นผู้เบิกใหม่ให้อัตโนมัติเมื่อยืนยัน)
        </div>
      `);
      addDeviceToQueueDirect(device);
      renderBatchList();
      return true;
    }

    if (currentMode === 'CHECK_IN' && device.status === 'IN_CABINET') {
      if (window.soundManager) window.soundManager.playBeep();
      showFeedback('info', `
        <div style="font-size: 1.05rem; font-weight: 700; color: #2563eb; margin-bottom: 0.25rem;">
          ℹ️ เครื่อง [${device.custom_sn}] อยู่ในตู้ชาร์จเรียบร้อยแล้ว
        </div>
        <div style="margin-bottom: 0.45rem; color: #1e3a8a;">พร้อมใช้งาน! ต้องการเบิกเครื่องนี้ออกไปใช้ใช่หรือไม่?</div>
        <button type="button" onclick="switchAndQueue('${device.custom_sn}')" style="display: inline-block; padding: 0.5rem 1rem; background: #2563eb; color: #fff; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 0.92rem;">
          👉 คลิกเพื่อสลับเป็น "เบิกออก" เครื่องนี้ทันที
        </button>
      `);
      return false;
    }

    // Verification passed! Add device to batch queue
    addDeviceToQueueDirect(device);
    renderBatchList();
    hideFeedback();
    return true;

  } catch (err) {
    if (window.soundManager) window.soundManager.playError();
    showFeedback('error', 'การเชื่อมต่อขัดข้อง: ' + err.message);
    return false;
  }
}

function addDeviceToQueueDirect(device) {
  const exists = currentBatchDevices.some(d => d.id === device.id);
  if (!exists) {
    currentBatchDevices.push(device);
  }
}

function renderBatchList() {
  const container = document.getElementById('batch-items-container');
  const listElem = document.getElementById('batch-items-list');
  const badge = document.getElementById('batch-counter-badge');
  const countVal = document.getElementById('batch-count-val');

  if (currentBatchDevices.length === 0) {
    container.style.display = 'none';
    badge.style.display = 'none';
    updateSubmitButtonLabel();
    return;
  }

  container.style.display = 'block';
  badge.style.display = 'inline-block';
  
  const abnormalCount = currentBatchDevices.filter(d => d.isAbnormal).length;
  if (abnormalCount > 0) {
    badge.style.background = '#fee2e2';
    badge.style.color = '#dc2626';
    badge.innerHTML = `ในชุด: <strong>${currentBatchDevices.length}</strong> เครื่อง (⚠️ ผิดปกติ <strong>${abnormalCount}</strong>)`;
  } else {
    badge.style.background = 'var(--blue-subtle)';
    badge.style.color = 'var(--blue)';
    badge.innerHTML = `ในชุด: <strong>${currentBatchDevices.length}</strong> เครื่อง`;
  }

  listElem.innerHTML = currentBatchDevices.map((dev, idx) => {
    if (dev.isAbnormal) {
      return `
        <div class="batch-item-chip" style="background: #fef2f2; border: 1.5px solid #ef4444; border-left: 5px solid #dc2626; padding: 0.6rem 0.75rem; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
              <span style="background: #dc2626; color: #fff; font-size: 0.68rem; font-weight: 800; padding: 0.15rem 0.5rem; border-radius: 9999px; letter-spacing: 0.03em;">🚨 ABNORMAL</span>
              <span class="code-badge" style="background: #fee2e2; color: #991b1b; font-weight: 800; font-size: 0.95rem;">${dev.custom_sn}</span>
              <span style="color: #7f1d1d; font-size: 0.78rem; font-family: monospace;">(SN: ${dev.original_sn})</span>
            </div>
            <div style="font-size: 0.8rem; color: #991b1b; font-weight: 700; margin-top: 0.25rem;">
              ⚠️ ${dev.abnormalReason || 'เครื่องผิดปกติ'}
            </div>
          </div>
          <button type="button" class="remove-btn" onclick="removeFromBatch(${idx})" title="นำเครื่องที่ผิดปกติออก" style="background: #dc2626; color: white; border: none; border-radius: 6px; padding: 0.35rem 0.65rem; font-weight: 700; font-size: 0.82rem; cursor: pointer; white-space: nowrap;">
            ✕ นำออก
          </button>
        </div>
      `;
    }

    return `
      <div class="batch-item-chip">
        <div>
          <span class="code-badge">${dev.custom_sn}</span>
          <span style="color: var(--text-muted); font-size: 0.78rem; margin-left: 0.4rem;">
            SN: ${dev.original_sn} (${dev.model || 'PDA'})
          </span>
        </div>
        <button type="button" class="remove-btn" onclick="removeFromBatch(${idx})" title="ลบออกจากชุด">
          ✕
        </button>
      </div>
    `;
  }).join('');

  updateSubmitButtonLabel();
}

function removeFromBatch(index) {
  currentBatchDevices.splice(index, 1);
  renderBatchList();
  document.getElementById('input-pda-code').focus();
}

function clearBatchQueue() {
  currentBatchDevices = [];
  renderBatchList();
  document.getElementById('input-pda-code').value = '';
  document.getElementById('input-pda-code').focus();
}

function updateSubmitButtonLabel() {
  const submitText = document.getElementById('submit-text');
  const submitBtn = document.getElementById('btn-submit');
  if (!submitText || !submitBtn) return;

  const count = currentBatchDevices.length;
  const isCheckout = currentMode === 'CHECK_OUT';
  const abnormals = currentBatchDevices.filter(d => d.isAbnormal);

  if (abnormals.length > 0) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';
    submitBtn.style.cursor = 'not-allowed';
    submitBtn.style.backgroundColor = '#991b1b';
    submitText.innerHTML = `⚠️ ไม่สามารถยืนยันได้ (มีรายการผิดตู้ ${abnormals.length} เครื่อง — กรุณากด [✕ นำออก])`;
    return;
  }

  submitBtn.disabled = false;
  submitBtn.style.opacity = '1';
  submitBtn.style.cursor = 'pointer';
  submitBtn.style.backgroundColor = '';

  if (count > 0) {
    submitText.textContent = isCheckout 
      ? `ยืนยันเบิกออกทั้งหมด (${count} เครื่อง)`
      : `ยืนยันคืนเข้าตู้ทั้งหมด (${count} เครื่อง)`;
  } else {
    submitText.textContent = isCheckout ? 'ยืนยันเบิกออก' : 'ยืนยันคืนเข้าตู้';
  }
}

// -------------------------------------------------------------
// Submit Batch or Single
// -------------------------------------------------------------

async function submitBatchOrSingle() {
  const pdaInput = document.getElementById('input-pda-code');
  const staffInput = document.getElementById('input-staff-id');
  const scannerBox = document.getElementById('scanner-box');
  const submitBtn = document.getElementById('btn-submit');

  const pendingCode = pdaInput.value.trim();

  // If user typed/scanned something and hit submit button directly, process all parsed codes first!
  if (pendingCode) {
    pdaInput.value = '';
    const added = await processInputCodes(pendingCode);
    if (!added && currentBatchDevices.length === 0) {
      pdaInput.focus();
      return;
    }
  }

  if (currentBatchDevices.length === 0) {
    showFeedback('error', 'กรุณายิงรหัส PDA อย่างน้อย 1 เครื่อง เพื่อทำรายการ');
    pdaInput.focus();
    return;
  }

  // Block submission if any abnormal device is present in the batch
  const abnormalItems = currentBatchDevices.filter(d => d.isAbnormal);
  if (abnormalItems.length > 0) {
    if (window.soundManager) window.soundManager.playError();
    showFeedback('error', `❌ ไม่สามารถยืนยันรายการได้: มี PDA ผิดปกติ (Abnormal / ผิดตู้) อยู่ในชุดจำนวน ${abnormalItems.length} เครื่อง<br>👉 กรุณากดปุ่ม <strong>[✕ นำออก]</strong> ที่เครื่องสีแดงก่อนยืนยัน`);
    pdaInput.focus();
    return;
  }

  const staff_id = staffInput.value.trim();
  if (currentMode === 'CHECK_OUT' && !staff_id) {
    showFeedback('error', 'กรุณากรอกหรือสแกนรหัสพนักงานผู้เบิก');
    staffInput.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.style.opacity = '0.7';

  try {
    const codes = currentBatchDevices.map(d => d.custom_sn || d.original_sn);
    const resolvedDept = currentDeptId || (currentBatchDevices[0] && currentBatchDevices[0].department_id) || 'OBD A';
    const res = await fetch('/api/scan/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codes,
        staff_id,
        department_id: resolvedDept,
        action: currentMode
      })
    });

    const data = await res.json();

    if (data.success) {
      // Notify other tabs (like Admin Log page)
      localStorage.setItem('pda_data_updated', Date.now().toString());

      // Success feedback
      if (window.soundManager) window.soundManager.playSuccess();
      scannerBox.classList.remove('flash-error');
      scannerBox.classList.add('flash-success');
      setTimeout(() => scannerBox.classList.remove('flash-success'), 900);

      const actionText = currentMode === 'CHECK_OUT' ? 'เบิกออกสำเร็จ' : 'คืนเข้าตู้สำเร็จ';
      const deviceNames = data.processed.map(d => `<span style="font-family: monospace; font-weight: 700; color: #111;">${d.custom_sn}</span>`).join(', ');

      showFeedback('success', `
        <strong>${actionText} ${data.processedCount} เครื่อง!</strong><br>
        รายการ: ${deviceNames}<br>
        ${currentMode === 'CHECK_OUT' ? `พนักงานผู้เบิก: <strong>${data.staff_id}</strong>` : `คืนเข้าตู้แผนก: <strong>${resolvedDept}</strong>`}
      `);

      // Clear batch list
      currentBatchDevices = [];
      renderBatchList();

      // Refresh side panel locker devices
      loadCabinetData();

      // Ready for next scan
      pdaInput.value = '';
      pdaInput.focus();
    } else {
      localStorage.setItem('pda_abnormal_updated', Date.now().toString());
      if (window.soundManager) window.soundManager.playError();
      scannerBox.classList.remove('flash-success');
      scannerBox.classList.add('flash-error');
      setTimeout(() => scannerBox.classList.remove('flash-error'), 800);

      const errorDetails = (data.errors && data.errors.length > 0)
        ? data.errors.map(e => e.message || e.error || e.code).join('<br>')
        : (data.message || data.error || 'เกิดข้อผิดพลาดในการทำรายการ');
      showFeedback('error', errorDetails);
    }
  } catch (err) {
    if (window.soundManager) window.soundManager.playError();
    showFeedback('error', 'การเชื่อมต่อขัดข้อง: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
  }
}

function showFeedback(type, htmlContent, customTitle = null) {
  const banner = document.getElementById('result-banner');
  const title = document.getElementById('result-title');
  const msg = document.getElementById('result-message');

  banner.style.display = 'block';
  banner.className = `result-banner ${type}`;
  if (customTitle) {
    title.innerHTML = customTitle;
  } else if (type === 'success') {
    title.innerHTML = 'รายการสำเร็จ';
  } else if (type === 'info') {
    title.innerHTML = 'แจ้งเตือน / แนะนำขั้นตอน';
  } else {
    title.innerHTML = 'ข้อผิดพลาด';
  }
  msg.innerHTML = htmlContent;
}

function hideFeedback() {
  const banner = document.getElementById('result-banner');
  banner.className = 'result-banner';
  banner.style.display = 'none';
}

// -------------------------------------------------------------
// Side Panel Data Loading
// -------------------------------------------------------------

async function loadCabinetData() {
  try {
    const res = await fetch(`/api/devices?department=${encodeURIComponent(currentDeptId)}`);
    const devData = await res.json();
    if (devData.success) {
      currentCabinetDevices = devData.devices || [];
      renderLockerDevices(currentCabinetDevices);
    }
  } catch (err) {
    console.warn('Error polling cabinet data:', err);
  }
}

function renderLockerDevices(devices) {
  const container = document.getElementById('locker-device-list');
  const countsPill = document.getElementById('panel-counts-pill');

  const inCabinetCount = devices.filter(d => d.status === 'IN_CABINET').length;
  const checkedOutCount = devices.filter(d => d.status === 'CHECKED_OUT').length;
  countsPill.innerHTML = `🟢 ในตู้: ${inCabinetCount} | 🔴 เบิกไป: ${checkedOutCount}`;

  if (devices.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 1.5rem; font-size: 0.85rem;">ยังไม่มี PDA ที่ผูกไว้กับตู้นี้</div>`;
    return;
  }

  container.innerHTML = devices.map(d => {
    const isGreen = d.status === 'IN_CABINET';
    return `
      <div class="locker-item" style="border-left: 3px solid ${isGreen ? 'var(--green)' : 'var(--red)'};">
        <div>
          <div class="item-id">
            <span style="color: ${isGreen ? 'var(--green)' : 'var(--red)'}; font-size: 0.8rem;">●</span>
            ${d.custom_sn}
          </div>
          <div class="item-orig">SN: ${d.original_sn} (${d.model || 'PDA'})</div>
        </div>
        <div style="text-align: right;">
          ${isGreen 
            ? `<span class="pill-status green" style="font-size: 0.75rem; padding: 0.15rem 0.5rem;">ชาร์จในตู้</span>`
            : `<div style="font-size: 0.8rem; font-weight: 600; color: var(--red);">👤 ${d.current_staff_id || 'มีผู้เบิก'}</div>
               <div style="font-size: 0.7rem; color: var(--text-muted);">${d.last_action_at ? d.last_action_at.split(' ')[1] : ''}</div>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function toggleSound() {
  if (window.soundManager) {
    window.soundManager.enabled = !window.soundManager.enabled;
    const btn = document.getElementById('sound-toggle-btn');
    if (window.soundManager.enabled) {
      btn.textContent = 'เสียง: เปิด';
      window.soundManager.playBeep();
    } else {
      btn.textContent = 'เสียง: ปิด';
    }
  }
}

// -------------------------------------------------------------
// Camera QR Scanner Modal (html5-qrcode)
// -------------------------------------------------------------

function openCameraScanner() {
  document.getElementById('camera-modal').classList.add('open');

  if (typeof Html5Qrcode === 'undefined') {
    alert('ระบบสแกนด้วยกล้องกำลังโหลด กรุณาลองใหม่อีกครั้ง');
    return;
  }

  html5QrScanner = new Html5Qrcode("camera-reader");
  const config = { fps: 10, qrbox: { width: 250, height: 250 } };

  html5QrScanner.start(
    { facingMode: "environment" },
    config,
    (decodedText) => {
      addPdaToBatch(decodedText);
      closeCameraScanner();
    },
    (errorMessage) => {
      // Ignore scan frame misses
    }
  ).catch(err => {
    alert('ไม่สามารถเปิดกล้องได้: ' + err);
    closeCameraScanner();
  });
}

function closeCameraScanner() {
  document.getElementById('camera-modal').classList.remove('open');
  if (html5QrScanner) {
    html5QrScanner.stop().then(() => {
      html5QrScanner.clear();
      html5QrScanner = null;
    }).catch(err => console.warn(err));
  }
}
