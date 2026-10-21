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

function isDepartmentCompatible(d1, d2) {
  if (!d1 || !d2) return true;
  const n1 = normalizeDeptCode(d1);
  const n2 = normalizeDeptCode(d2);
  if (n1 === n2) return true;
  if (n1.startsWith(n2) || n2.startsWith(n1)) return true;
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

function setupScanInputListeners() {
  const staffInput = document.getElementById('input-staff-id');
  const pdaInput = document.getElementById('input-pda-code');
  const btnClearStaff = document.getElementById('btn-clear-staff');

  // When staff barcode / ID is scanned or entered (Enter or Tab)
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
          pdaInput.select();
        }
      }
    }
  });

  staffInput.addEventListener('input', () => {
    if (btnClearStaff) {
      btnClearStaff.style.display = staffInput.value.trim() ? 'inline' : 'none';
    }
  });

  // When PDA barcode / QR is scanned or entered (Enter or Tab)
  pdaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      clearTimeout(autoAddTimeout);
      const val = pdaInput.value.trim();

      if (!val) {
        if (currentBatchDevices.length > 0) {
          submitBatchOrSingle();
        }
        return;
      }

      pdaInput.value = '';
      processInputCodes(val);
    }
  });

  // Auto-detect compound scan (e.g. 'ad003ad004') or auto-match on barcode input
  pdaInput.addEventListener('input', () => {
    clearTimeout(autoAddTimeout);
    const val = pdaInput.value.trim();
    if (!val) return;

    // 1. If input contains multiple codes (e.g. ad003ad004 or space-separated)
    const parsed = parseCodes(val);
    if (parsed.length > 1) {
      pdaInput.value = '';
      processInputCodes(val);
      return;
    }

    // 2. If scanner does not emit Enter suffix: auto-add when it matches a known device in this cabinet
    if (currentCabinetDevices && currentCabinetDevices.length > 0) {
      const match = currentCabinetDevices.find(
        d => d.custom_sn.toLowerCase() === val.toLowerCase() || d.original_sn.toLowerCase() === val.toLowerCase()
      );
      if (match) {
        autoAddTimeout = setTimeout(() => {
          if (pdaInput.value.trim().toLowerCase() === val.toLowerCase()) {
            pdaInput.value = '';
            processInputCodes(val);
          }
        }, 220);
      }
    }
  });

  // Paste support
  pdaInput.addEventListener('paste', () => {
    setTimeout(() => {
      const val = pdaInput.value.trim();
      if (val) {
        pdaInput.value = '';
        processInputCodes(val);
      }
    }, 20);
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
      // If code was not found as a device, check if staff ID is empty
      // If so, the user likely scanned their staff ID card into the scanner!
      if (!staffInput.value.trim() && cleanCode.length >= 3 && currentMode === 'CHECK_OUT') {
        staffInput.value = cleanCode;
        const btnClearStaff = document.getElementById('btn-clear-staff');
        if (btnClearStaff) btnClearStaff.style.display = 'inline';
        if (window.soundManager) window.soundManager.playBeep();

        if (currentBatchDevices.length > 0) {
          // If there are already PDAs queued, submit now!
          submitBatchOrSingle();
          return false;
        }

        showFeedback('success', `👤 บันทึกรหัสพนักงาน: <strong>${cleanCode}</strong> เรียบร้อยแล้ว 👉 สแกนรหัส PDA ต่อได้เลย`);
        pdaInput.focus();
        return false;
      }

      if (window.soundManager) window.soundManager.playError();
      scannerBox.classList.remove('flash-success');
      scannerBox.classList.add('flash-error');
      setTimeout(() => scannerBox.classList.remove('flash-error'), 800);

      showFeedback('error', `❌ ไม่พบอุปกรณ์รหัส "${cleanCode}" ในระบบฐานข้อมูล (กรุณาตรวจสอบว่าลงทะเบียนเครื่องแล้วหรือยัง)`);
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

    // Tolerant department handling - Allow scanning any device smoothly across cabinets
    if (device.department_id && currentDeptId && !isDepartmentCompatible(device.department_id, currentDeptId)) {
      device.assigned_dept_notice = device.department_id;
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
  countVal.textContent = currentBatchDevices.length;

  listElem.innerHTML = currentBatchDevices.map((dev, idx) => `
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
  `).join('');

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
  if (!submitText) return;

  const count = currentBatchDevices.length;
  const isCheckout = currentMode === 'CHECK_OUT';

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
      // Specific error feedback is already displayed by processInputCodes!
      pdaInput.focus();
      return;
    }
  }

  if (currentBatchDevices.length === 0) {
    showFeedback('error', 'กรุณายิงรหัส PDA อย่างน้อย 1 เครื่อง เพื่อทำรายการ');
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
    const codes = currentBatchDevices.map(d => d.custom_sn);
    const res = await fetch('/api/scan/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codes,
        staff_id,
        department_id: currentDeptId,
        action: currentMode
      })
    });

    const data = await res.json();

    if (data.success) {
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
        ${currentMode === 'CHECK_OUT' ? `พนักงานผู้เบิก: <strong>${data.staff_id}</strong>` : `คืนเข้าตู้แผนก: <strong>${currentDeptId}</strong>`}
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
      if (window.soundManager) window.soundManager.playError();
      scannerBox.classList.remove('flash-success');
      scannerBox.classList.add('flash-error');
      setTimeout(() => scannerBox.classList.remove('flash-error'), 800);

      const errorDetails = (data.errors && data.errors.length > 0)
        ? data.errors.map(e => e.message).join('<br>')
        : (data.message || 'เกิดข้อผิดพลาดในการทำรายการ');
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

function showFeedback(type, htmlContent) {
  const banner = document.getElementById('result-banner');
  const title = document.getElementById('result-title');
  const msg = document.getElementById('result-message');

  banner.style.display = 'block';
  banner.className = `result-banner ${type}`;
  if (type === 'success') {
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
