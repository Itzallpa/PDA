// Admin Dashboard Logic
let allDepartments = [];
let allDevices = [];
let currentDeptFilter = 'ALL';
let currentStatusFilter = 'ALL';
let currentSearchQuery = '';

// Admin Auth Management
let adminAuthToken = localStorage.getItem('pda_admin_token') || '';

function getAuthHeaders(extra = {}) {
  const headers = { ...extra };
  if (adminAuthToken) {
    headers['X-Admin-Token'] = adminAuthToken;
  }
  return headers;
}

async function verifyAdminAuth() {
  const authScreen = document.getElementById('admin-auth-screen');
  const mainWrapper = document.getElementById('admin-main-wrapper');
  const pwdInput = document.getElementById('admin-password-input');
  const errorMsg = document.getElementById('login-error-msg');

  if (!adminAuthToken) {
    if (authScreen) authScreen.style.display = 'flex';
    if (mainWrapper) mainWrapper.style.display = 'none';
    if (pwdInput) {
      pwdInput.value = '';
      setTimeout(() => pwdInput.focus(), 150);
    }
    return false;
  }

  try {
    const res = await fetch('/api/admin/check-auth', {
      headers: { 'X-Admin-Token': adminAuthToken }
    });
    const data = await res.json();
    if (data.authenticated) {
      if (authScreen) authScreen.style.display = 'none';
      if (mainWrapper) mainWrapper.style.display = 'block';
      if (errorMsg) errorMsg.style.display = 'none';
      return true;
    } else {
      localStorage.removeItem('pda_admin_token');
      adminAuthToken = '';
      if (authScreen) authScreen.style.display = 'flex';
      if (mainWrapper) mainWrapper.style.display = 'none';
      if (pwdInput) {
        pwdInput.value = '';
        setTimeout(() => pwdInput.focus(), 150);
      }
      return false;
    }
  } catch (err) {
    console.warn('Error checking admin auth:', err);
    if (authScreen) authScreen.style.display = 'flex';
    if (mainWrapper) mainWrapper.style.display = 'none';
    return false;
  }
}

async function handleAdminLogin(event) {
  if (event) event.preventDefault();
  const pwdInput = document.getElementById('admin-password-input');
  const errorMsg = document.getElementById('login-error-msg');
  const submitBtn = document.getElementById('btn-login-submit');

  const password = pwdInput ? pwdInput.value.trim() : '';
  if (!password) {
    if (errorMsg) {
      errorMsg.textContent = '❌ กรุณากรอกรหัสผ่าน Admin';
      errorMsg.style.display = 'block';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ กำลังตรวจสอบ...';
  }

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();

    if (data.success && data.token) {
      adminAuthToken = data.token;
      localStorage.setItem('pda_admin_token', data.token);

      const authScreen = document.getElementById('admin-auth-screen');
      const mainWrapper = document.getElementById('admin-main-wrapper');
      if (authScreen) authScreen.style.display = 'none';
      if (mainWrapper) mainWrapper.style.display = 'block';
      if (errorMsg) errorMsg.style.display = 'none';
      if (pwdInput) pwdInput.value = '';

      refreshData();
      if (typeof playSound === 'function') playSound('success');
    } else {
      if (errorMsg) {
        errorMsg.textContent = '❌ ' + (data.message || 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
        errorMsg.style.display = 'block';
      }
      if (pwdInput) {
        pwdInput.select();
        pwdInput.focus();
      }
      if (typeof playSound === 'function') playSound('error');
    }
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = '❌ ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้: ' + err.message;
      errorMsg.style.display = 'block';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '🔑 ยืนยันเข้าสู่ระบบ';
    }
  }
}

function adminLogout() {
  if (confirm('คุณต้องการออกจากระบบ Admin ใช่หรือไม่?')) {
    localStorage.removeItem('pda_admin_token');
    adminAuthToken = '';
    const authScreen = document.getElementById('admin-auth-screen');
    const mainWrapper = document.getElementById('admin-main-wrapper');
    const pwdInput = document.getElementById('admin-password-input');
    const errorMsg = document.getElementById('login-error-msg');

    if (mainWrapper) mainWrapper.style.display = 'none';
    if (authScreen) authScreen.style.display = 'flex';
    if (errorMsg) errorMsg.style.display = 'none';
    if (pwdInput) {
      pwdInput.value = '';
      setTimeout(() => pwdInput.focus(), 150);
    }
  }
}

function openChangePasswordModal() {
  const modal = document.getElementById('change-pwd-modal');
  const inputNew = document.getElementById('input-new-admin-pwd');
  const inputConfirm = document.getElementById('input-confirm-admin-pwd');
  const errDiv = document.getElementById('pwd-change-error');

  if (inputNew) inputNew.value = '';
  if (inputConfirm) inputConfirm.value = '';
  if (errDiv) {
    errDiv.style.display = 'none';
    errDiv.textContent = '';
  }

  if (modal) modal.classList.add('open');
  if (inputNew) setTimeout(() => inputNew.focus(), 150);
}

async function handleSaveNewPassword(event) {
  if (event) event.preventDefault();
  const inputNew = document.getElementById('input-new-admin-pwd');
  const inputConfirm = document.getElementById('input-confirm-admin-pwd');
  const errDiv = document.getElementById('pwd-change-error');
  const submitBtn = document.getElementById('btn-save-pwd-submit');

  const newPwd = inputNew ? inputNew.value.trim() : '';
  const confirmPwd = inputConfirm ? inputConfirm.value.trim() : '';

  if (!newPwd) {
    if (errDiv) {
      errDiv.textContent = '❌ กรุณาระบุรหัสผ่านใหม่';
      errDiv.style.display = 'block';
    }
    return;
  }

  if (newPwd !== confirmPwd) {
    if (errDiv) {
      errDiv.textContent = '❌ รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน';
      errDiv.style.display = 'block';
    }
    if (inputConfirm) inputConfirm.focus();
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ กำลังบันทึก...';
  }

  try {
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': adminAuthToken
      },
      body: JSON.stringify({ new_password: newPwd })
    });
    const data = await res.json();

    if (data.success) {
      if (data.token) {
        adminAuthToken = data.token;
        localStorage.setItem('pda_admin_token', data.token);
      }
      closeModal('change-pwd-modal');
      alert('✅ เปลี่ยนรหัสผ่าน Admin สำเร็จเรียบร้อย!\nรหัสผ่านใหม่ถูกบันทึกลงในไฟล์ data/config.json และฐานข้อมูลแล้ว');
      if (typeof playSound === 'function') playSound('success');
    } else {
      if (errDiv) {
        errDiv.textContent = '❌ ' + (data.message || 'ไม่สามารถเปลี่ยนรหัสผ่านได้');
        errDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errDiv) {
      errDiv.textContent = '❌ ข้อผิดพลาดในการเชื่อมต่อ: ' + err.message;
      errDiv.style.display = 'block';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '💾 บันทึกรหัสผ่านใหม่';
    }
  }
}

/**
 * Strict Barcode Scanner Only Protection
 * - Blocks Copy/Paste, Cut, Drag & Drop, and Context Menu
 * - Detects inter-keystroke interval using performance.now()
 * - Real-time blocks manual keyboard typing (> 50ms per key)
 * - Validates scanner burst speed on Enter
 */
function setupScanOnlyProtection(inputElem, warningDivId, onValidScanSubmit) {
  if (!inputElem) return;

  const warningDiv = warningDivId ? document.getElementById(warningDivId) : null;
  let scanBuffer = '';
  let keyTimestamps = [];
  let burstTimer = null;
  let hideWarnTimer = null;

  function flashWarning(msg) {
    if (typeof playSound === 'function') playSound('error');

    if (warningDiv) {
      warningDiv.textContent = msg;
      warningDiv.style.display = 'block';
      clearTimeout(hideWarnTimer);
      hideWarnTimer = setTimeout(() => {
        warningDiv.style.display = 'none';
      }, 4000);
    } else {
      alert(msg);
    }

    inputElem.value = '';
    inputElem.style.borderColor = '#dc2626';
    inputElem.style.boxShadow = '0 0 0 3px rgba(220, 38, 38, 0.2)';
    setTimeout(() => {
      inputElem.style.borderColor = '';
      inputElem.style.boxShadow = '';
    }, 1200);
  }

  // 1. Block Paste & Drop events
  ['paste', 'drop'].forEach(evtName => {
    inputElem.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      scanBuffer = '';
      keyTimestamps = [];
      flashWarning('🚫 ไม่อนุญาตให้ Copy / Paste หรือวางข้อความ — กรุณาใช้เครื่องยิงสแกนบาร์โค้ดเท่านั้น!');
    });
  });

  // 2. Block Cut & Context Menu
  ['cut', 'contextmenu'].forEach(evtName => {
    inputElem.addEventListener(evtName, (e) => {
      e.preventDefault();
    });
  });

  // Prevent mobile soft keyboard popup
  inputElem.setAttribute('inputmode', 'none');
  inputElem.setAttribute('autocomplete', 'off');
  inputElem.setAttribute('autocorrect', 'off');
  inputElem.setAttribute('autocapitalize', 'off');
  inputElem.setAttribute('spellcheck', 'false');

  // 3. Intercept Keydown to block human typing while allowing rapid scanner bursts
  inputElem.addEventListener('keydown', (e) => {
    // Intercept Ctrl+V / Cmd+V / Shift+Insert
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V' || e.key === 'Insert')) {
      e.preventDefault();
      scanBuffer = '';
      keyTimestamps = [];
      flashWarning('🚫 ไม่อนุญาตให้กดวางข้อความ (Ctrl+V) — กรุณาใช้เครื่องยิงสแกนเท่านั้น!');
      return;
    }

    // Ignore non-character modifier keys
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) {
      return;
    }

    // Block Backspace / Delete (humans use backspace, scanners do not)
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      scanBuffer = '';
      keyTimestamps = [];
      flashWarning('🚫 ไม่อนุญาตให้แก้ไขด้วยมือ — กรุณาใช้เครื่องยิงสแกนบาร์โค้ดเท่านั้น!');
      return;
    }

    const now = performance.now();

    // When Enter is pressed (scanner suffix)
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

      // Scanner check: must have multiple keys and fast burst speed
      if (count < 2) {
        scanBuffer = '';
        keyTimestamps = [];
        flashWarning('🚫 ไม่อนุญาตให้พิมพ์ด้วยคีย์บอร์ด — ระบบล็อกให้ใช้เครื่องยิงสแกนบาร์โค้ดเท่านั้น!');
        return;
      }

      let total = 0;
      let maxInt = 0;
      for (let i = 1; i < count; i++) {
        const diff = keyTimestamps[i] - keyTimestamps[i - 1];
        total += diff;
        if (diff > maxInt) maxInt = diff;
      }
      const avg = total / (count - 1);

      if (avg > 55 || maxInt > 85) {
        scanBuffer = '';
        keyTimestamps = [];
        flashWarning('🚫 ตรวจพบการพิมพ์ด้วยมือ — ระบบอนุญาตเฉพาะการยิงสแกนบาร์โค้ดเท่านั้น!');
        return;
      }

      // Valid barcode scan!
      const scannedVal = val;
      scanBuffer = '';
      keyTimestamps = [];
      if (warningDiv) warningDiv.style.display = 'none';
      if (typeof onValidScanSubmit === 'function') {
        onValidScanSubmit(scannedVal);
      }
      return;
    }

    // Printable character keydown
    if (e.key.length === 1) {
      // Prevent key from appearing in DOM
      e.preventDefault();

      if (keyTimestamps.length > 0) {
        const diff = now - keyTimestamps[keyTimestamps.length - 1];
        // If slow typing detected between keys (> 60ms)
        if (diff > 60) {
          scanBuffer = '';
          keyTimestamps = [];
          clearTimeout(burstTimer);
          flashWarning('🚫 ไม่อนุญาตให้พิมพ์ด้วยมือ — ระบบล็อกให้ใช้เครื่องยิงสแกนบาร์โค้ดเท่านั้น!');
          return;
        }
      }

      scanBuffer += e.key;
      keyTimestamps.push(now);

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
          if (avg <= 45 && mx <= 80) {
            // Valid barcode scan without Enter suffix!
            const scannedVal = scanBuffer.trim();
            scanBuffer = '';
            keyTimestamps = [];
            if (warningDiv) warningDiv.style.display = 'none';
            if (typeof onValidScanSubmit === 'function') {
              onValidScanSubmit(scannedVal);
            }
            return;
          }
        }

        scanBuffer = '';
        keyTimestamps = [];
        flashWarning('🚫 ไม่อนุญาตให้พิมพ์ด้วยมือ — ระบบล็อกให้ใช้เครื่องยิงสแกนบาร์โค้ดเท่านั้น!');
      }, 65);
    }
  });
}

// Load data on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Always load dynamic departments from database first so all dropdowns & kiosk links are based on created departments
  await loadDepartmentsPublic();

  const isAuthed = await verifyAdminAuth();
  if (isAuthed) {
    refreshData();
  }

  // Auto-refresh every 5 seconds to catch scans from kiosks (only when authenticated)
  setInterval(() => {
    if (adminAuthToken) {
      refreshDataSilently();
    }
  }, 5000);

  const scanInput = document.getElementById('sticker-quick-scan-input');
  if (scanInput) {
    setupScanOnlyProtection(scanInput, 'sticker-scan-warning', (scannedVal) => {
      handleStickerScanSubmit(scannedVal);
    });
  }
});

async function loadDepartmentsPublic() {
  try {
    const res = await fetch('/api/departments');
    const data = await res.json();
    if (data.success && data.departments) {
      allDepartments = data.departments;
      updateDepartmentDropdowns();
      renderDeptFilterTabs();
      renderQuickKioskLinks();
    }
  } catch (err) {
    console.warn('Could not load public departments:', err);
  }
}

async function refreshData() {
  try {
    await Promise.all([fetchStats(), fetchDevices()]);
  } catch (err) {
    console.error('Error refreshing data:', err);
  }
}

async function refreshDataSilently() {
  // Only refresh if modals are closed
  const modalsOpen = document.querySelectorAll('.modal-overlay.open').length > 0;
  if (!modalsOpen) {
    try {
      await Promise.all([fetchStats(true), fetchDevices(true)]);
    } catch (err) {
      console.warn('Silent refresh error:', err);
    }
  }
}

async function fetchStats(isSilent = false) {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success) {
      const stats = data.stats;
      document.getElementById('kpi-total').textContent = stats.total;
      document.getElementById('kpi-in-cabinet').textContent = stats.inCabinet;
      document.getElementById('kpi-checked-out').textContent = stats.checkedOut;
      document.getElementById('count-dept-all').textContent = stats.total;
      
      allDepartments = stats.departments;
      renderDeptFilterTabs();
      renderQuickKioskLinks();
      updateDepartmentDropdowns();
    }
  } catch (err) {
    if (!isSilent) console.error('Error fetching stats:', err);
  }
}

async function fetchDevices(isSilent = false) {
  try {
    const res = await fetch('/api/devices');
    const data = await res.json();
    if (data.success) {
      allDevices = data.devices;
      applyFiltersAndRender();
    }
  } catch (err) {
    if (!isSilent) console.error('Error fetching devices:', err);
  }
}

function renderDeptFilterTabs() {
  const container = document.getElementById('dept-filter-tabs');
  const allBtn = container.querySelector('button');
  
  // Keep first button, rebuild rest
  let html = allBtn.outerHTML;
  allDepartments.forEach(d => {
    const isActive = currentDeptFilter === d.id ? 'active' : '';
    html += `
      <button class="dept-tab ${isActive}" onclick="filterDepartment('${d.id}')">
        <span>${d.id} - ${d.name}</span>
        <span class="dept-badge-count">${d.total_devices || 0}</span>
      </button>
    `;
  });
  html += `
    <button class="dept-tab" onclick="openAddDeptModal()" style="border: 1.5px dashed #2563eb; color: #2563eb; background: #eff6ff; font-weight: 600;" title="เพิ่มตู้จัดเก็บหรือแผนกใหม่">
      ➕ เพิ่มตู้/แผนก
    </button>
  `;
  container.innerHTML = html;
}

function renderQuickKioskLinks() {
  const container = document.getElementById('quick-kiosk-links');
  if (!container) return;
  container.innerHTML = allDepartments.map(d => `
    <a href="/dept/${d.id}" target="_blank" class="btn-open-kiosk" title="เปิดหน้าตู้ ${d.name}">
      ${d.id}
    </a>
  `).join('');
}

function filterDepartment(deptId) {
  currentDeptFilter = deptId;
  const tabs = document.querySelectorAll('.dept-tab');
  tabs.forEach(tab => {
    if (deptId === 'ALL' && tab.textContent.includes('ทั้งหมด')) {
      tab.classList.add('active');
    } else if (tab.textContent.includes(`${deptId} -`)) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  applyFiltersAndRender();
}

function handleStatusFilter(val) {
  currentStatusFilter = val;
  applyFiltersAndRender();
}

function handleSearchInput() {
  currentSearchQuery = document.getElementById('search-input').value.toLowerCase().trim();
  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  let filtered = allDevices;

  // Filter department
  if (currentDeptFilter !== 'ALL') {
    filtered = filtered.filter(d => d.department_id === currentDeptFilter);
  }

  // Filter status
  if (currentStatusFilter !== 'ALL') {
    filtered = filtered.filter(d => d.status === currentStatusFilter);
  }

  // Filter search
  if (currentSearchQuery) {
    filtered = filtered.filter(d => 
      (d.original_sn && d.original_sn.toLowerCase().includes(currentSearchQuery)) ||
      (d.custom_sn && d.custom_sn.toLowerCase().includes(currentSearchQuery)) ||
      (d.model && d.model.toLowerCase().includes(currentSearchQuery)) ||
      (d.current_staff_id && d.current_staff_id.toLowerCase().includes(currentSearchQuery))
    );
  }

  renderCabinets(filtered);
}

function renderCabinets(devices) {
  const container = document.getElementById('cabinets-list');
  if (!container) return;

  const deptsToShow = (currentDeptFilter === 'ALL') 
    ? allDepartments 
    : allDepartments.filter(d => d.id === currentDeptFilter);

  if (deptsToShow.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 3rem;">ไม่พบข้อมูลตู้จัดเก็บ</p>`;
    return;
  }

  let html = '';
  deptsToShow.forEach(dept => {
    const deptDevices = devices.filter(d => d.department_id === dept.id);
    const inCabinetCount = deptDevices.filter(d => d.status === 'IN_CABINET').length;
    const checkedOutCount = deptDevices.filter(d => d.status === 'CHECKED_OUT').length;

    html += `
      <section class="cabinet-section">
        <div class="cabinet-header">
          <div class="cabinet-title-area">
            <span class="cabinet-badge">${dept.id}</span>
            <div>
              <h3>${dept.name}</h3>
              <p>${dept.description || 'ตู้จัดเก็บประจำแผนก'}</p>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
            <div class="cabinet-summary-pills">
              <span class="pill-status green">ในตู้: ${inCabinetCount}</span>
              <span class="pill-status red">เบิกใช้: ${checkedOutCount}</span>
            </div>
            ${deptDevices.length === 0 ? `
              <button class="btn-icon" onclick="deleteDepartment('${dept.id}')" style="color: #dc2626; border-color: #fecaca; background: #fef2f2; font-size: 0.78rem; padding: 0.35rem 0.6rem;" title="ลบตู้เปล่านี้">
                🗑️ ลบตู้
              </button>
            ` : ''}
            <a href="/dept/${dept.id}" target="_blank" class="btn-open-kiosk">
              เปิดหน้าตู้
            </a>
          </div>
        </div>

        <div class="device-rack-grid">
          ${deptDevices.length === 0 
            ? `<div style="grid-column: 1/-1; padding: 1.5rem; text-align: center; color: var(--text-muted); background: var(--bg-subtle); border: 1px dashed var(--border-default); border-radius: var(--radius);">
                 ไม่มี PDA ในตู้นี้
               </div>`
            : deptDevices.map(dev => renderDeviceCard(dev)).join('')
          }
        </div>
      </section>
    `;
  });

  container.innerHTML = html;
}

function renderDeviceCard(dev) {
  const isInCabinet = dev.status === 'IN_CABINET';
  const statusClass = isInCabinet ? 'in-cabinet' : 'checked-out';
  const statusLabel = isInCabinet ? 'ในตู้' : 'เบิกใช้';

  return `
    <div class="device-card ${statusClass}">
      <div class="device-top-row">
        <div class="custom-id-tag">
          ${dev.custom_sn}
        </div>
        <div class="status-led">
          <span class="led-dot"></span>
          <span>${statusLabel}</span>
        </div>
      </div>

      <div class="device-meta-row">
        <div class="meta-item">
          <span>SN:</span>
          <strong>${dev.original_sn}</strong>
        </div>
        <div class="meta-item">
          <span>รุ่น:</span>
          <span>${dev.model || '-'}</span>
        </div>
      </div>

      ${isInCabinet 
        ? `<div class="charging-banner">
             พร้อมใช้งานในตู้
           </div>`
        : `<div class="in-use-banner">
             <div class="staff-title">ผู้เบิก:</div>
             <div class="staff-val">${dev.current_staff_id || 'ไม่ทราบรหัส'}</div>
             <div class="time-ago">${dev.last_action_at || ''}</div>
           </div>`
      }

      <div class="device-actions-row">
        <button class="btn-icon" onclick="openQrModal(${dev.id})" title="พิมพ์สติ๊กเกอร์ QR ดวงนี้">
          🖨️ QR
        </button>
        <button class="btn-icon" onclick="openEditDeviceModal(${dev.id})" title="แก้ไข">
          แก้ไข
        </button>
        <button class="btn-icon" onclick="deleteDevice(${dev.id}, '${dev.custom_sn}', '${dev.original_sn}')" title="ลบ">
          ลบ
        </button>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// Modals & Device CRUD
// -------------------------------------------------------------

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
}

function openAddDeptModal() {
  const idInput = document.getElementById('form-dept-id');
  const nameInput = document.getElementById('form-dept-name');
  const descInput = document.getElementById('form-dept-desc');
  const errDiv = document.getElementById('dept-form-error');

  if (idInput) idInput.value = '';
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  if (errDiv) {
    errDiv.style.display = 'none';
    errDiv.textContent = '';
  }

  openModal('dept-modal');
  if (idInput) setTimeout(() => idInput.focus(), 150);
}

async function saveDepartment(event) {
  if (event) event.preventDefault();
  const idInput = document.getElementById('form-dept-id');
  const nameInput = document.getElementById('form-dept-name');
  const descInput = document.getElementById('form-dept-desc');
  const errDiv = document.getElementById('dept-form-error');
  const submitBtn = document.getElementById('btn-save-dept-submit');

  const id = idInput ? idInput.value.trim().toUpperCase() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const description = descInput ? descInput.value.trim() : '';

  if (!id || !name) {
    if (errDiv) {
      errDiv.textContent = '❌ กรุณากรอกรหัสย่อและชื่อแผนก';
      errDiv.style.display = 'block';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ กำลังบันทึก...';
  }

  try {
    const res = await fetch('/api/departments', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id, name, description })
    });
    const data = await res.json();

    if (data.success) {
      closeModal('dept-modal');
      await refreshData();
      alert(`✅ ${data.message}\nหน้าตู้ประจำแผนก /dept/${id} พร้อมใช้งานแล้ว!`);
      if (typeof playSound === 'function') playSound('success');
    } else {
      if (errDiv) {
        errDiv.textContent = '❌ ' + (data.message || 'ไม่สามารถเพิ่มแผนกได้');
        errDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errDiv) {
      errDiv.textContent = '❌ ข้อผิดพลาดในการเชื่อมต่อ: ' + err.message;
      errDiv.style.display = 'block';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '💾 บันทึกตู้จัดเก็บใหม่';
    }
  }
}

async function deleteDepartment(deptId) {
  if (!confirm(`คุณต้องการลบตู้จัดเก็บแผนก [${deptId}] ใช่หรือไม่?`)) return;
  try {
    const res = await fetch(`/api/departments/${deptId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.success) {
      await refreshData();
      alert(`✅ ${data.message}`);
    } else {
      alert(`❌ ${data.message || 'ไม่สามารถลบแผนกได้'}`);
    }
  } catch (err) {
    alert('ข้อผิดพลาดในการเชื่อมต่อ: ' + err.message);
  }
}

function updateDepartmentDropdowns() {
  // 1. Update #form-department in add/edit PDA modal
  const formDeptSelect = document.getElementById('form-department');
  if (formDeptSelect) {
    const currentVal = formDeptSelect.value;
    formDeptSelect.innerHTML = allDepartments.map(d => `
      <option value="${d.id}">${d.id} - ${d.name}</option>
    `).join('');
    if (currentVal && allDepartments.some(d => d.id === currentVal)) {
      formDeptSelect.value = currentVal;
    }
  }

  // 2. Update #import-default-dept in Excel/CSV Import modal (BASED ON CREATED DEPARTMENTS!)
  const importDeptSelect = document.getElementById('import-default-dept');
  if (importDeptSelect) {
    const currentVal = importDeptSelect.value;
    importDeptSelect.innerHTML = allDepartments.map(d => `
      <option value="${d.id}">${d.id} - ${d.name}</option>
    `).join('');
    if (currentVal && allDepartments.some(d => d.id === currentVal)) {
      importDeptSelect.value = currentVal;
    }
  }

  // 3. Update #batch-dept-filter in QR modal
  const batchDeptSelect = document.getElementById('batch-dept-filter');
  if (batchDeptSelect) {
    const currentVal = batchDeptSelect.value || 'ALL';
    let html = `<option value="ALL">ทุกแผนก (ทั้งหมด)</option>`;
    allDepartments.forEach(d => {
      html += `<option value="${d.id}">${d.id} - ${d.name}</option>`;
    });
    batchDeptSelect.innerHTML = html;
    if (currentVal) batchDeptSelect.value = currentVal;
  }

  // 4. Update #log-dept-filter in Logs History
  const logDeptSelect = document.getElementById('log-dept-filter');
  if (logDeptSelect) {
    const currentVal = logDeptSelect.value || 'ALL';
    let html = `<option value="ALL">ทุกแผนก</option>`;
    allDepartments.forEach(d => {
      html += `<option value="${d.id}">${d.id} - ${d.name}</option>`;
    });
    logDeptSelect.innerHTML = html;
    if (currentVal) logDeptSelect.value = currentVal;
  }

  // 5. Update #login-kiosk-links on Admin Lock Screen
  const loginKioskContainer = document.getElementById('login-kiosk-links');
  if (loginKioskContainer) {
    loginKioskContainer.innerHTML = allDepartments.map(d => `
      <a href="/dept/${d.id}" class="btn-secondary" style="font-size: 0.78rem; padding: 0.4rem 0.6rem; text-align: center; text-decoration: none; display: block;">
        ${d.id} - ${d.name}
      </a>
    `).join('');
  }

  // 6. Update KPI depts count
  const kpiDepts = document.getElementById('kpi-depts');
  if (kpiDepts) {
    kpiDepts.textContent = `${allDepartments.length} แผนก`;
  }
}

async function openAddDeviceModal() {
  document.getElementById('modal-device-title').textContent = 'เพิ่ม PDA เครื่องใหม่เข้าสู่ระบบ';
  document.getElementById('form-device-id').value = '';
  document.getElementById('form-orig-sn').value = '';
  document.getElementById('form-model').value = 'Zebra TC26';
  document.getElementById('form-notes').value = '';
  
  if (currentDeptFilter !== 'ALL') {
    document.getElementById('form-department').value = currentDeptFilter;
  }

  await autoSuggestCustomSn();
  document.getElementById('device-modal').classList.add('open');
  document.getElementById('form-orig-sn').focus();
}

async function autoSuggestCustomSn() {
  try {
    const res = await fetch('/api/devices/suggest-custom-sn');
    const data = await res.json();
    if (data.success) {
      document.getElementById('form-custom-sn').value = data.custom_sn;
    }
  } catch (err) {
    console.error('Error suggesting custom sn:', err);
  }
}

function openEditDeviceModal(id) {
  const dev = allDevices.find(d => d.id === id);
  if (!dev) return;

  document.getElementById('modal-device-title').textContent = `แก้ไขข้อมูล PDA: ${dev.custom_sn}`;
  document.getElementById('form-device-id').value = dev.id;
  document.getElementById('form-orig-sn').value = dev.original_sn;
  document.getElementById('form-custom-sn').value = dev.custom_sn;
  document.getElementById('form-model').value = dev.model || '';
  document.getElementById('form-department').value = dev.department_id;
  document.getElementById('form-notes').value = dev.notes || '';

  document.getElementById('device-modal').classList.add('open');
}

async function saveDevice() {
  const id = document.getElementById('form-device-id').value;
  const original_sn = document.getElementById('form-orig-sn').value.trim();
  const custom_sn = document.getElementById('form-custom-sn').value.trim();
  const department_id = document.getElementById('form-department').value;
  const model = document.getElementById('form-model').value.trim();
  const notes = document.getElementById('form-notes').value.trim();

  if (!original_sn) {
    alert('กรุณากรอก Original Serial Number');
    return;
  }
  if (!custom_sn) {
    alert('กรุณากรอกรหัสย่อ Custom QR Code');
    return;
  }

  try {
    const url = id ? `/api/devices/${id}` : '/api/devices';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ original_sn, custom_sn, department_id, model, notes })
    });
    const result = await res.json();

    if (result.success) {
      closeModal('device-modal');
      refreshData();
    } else {
      alert('เกิดข้อผิดพลาด: ' + (result.message || 'ไม่สามารถบันทึกได้'));
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + err.message);
  }
}

async function deleteDevice(id, customSn, origSn) {
  if (!confirm(`คุณต้องการลบอุปกรณ์ [${customSn}] (SN: ${origSn}) ใช่หรือไม่?`)) return;

  try {
    const res = await fetch(`/api/devices/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const result = await res.json();
    if (result.success) {
      refreshData();
    } else {
      alert(result.message || 'ลบไม่สำเร็จ');
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// -------------------------------------------------------------
// QR Sticker Generator & Printing
// -------------------------------------------------------------

function openQrModal(deviceId) {
  const dev = allDevices.find(d => d.id === deviceId);
  if (!dev) return;

  document.getElementById('sticker-dept-badge').textContent = dev.department_id;
  document.getElementById('sticker-custom-sn').textContent = dev.custom_sn;
  document.getElementById('sticker-orig-sn').textContent = dev.original_sn;
  document.getElementById('sticker-help-custom').textContent = dev.custom_sn;
  document.getElementById('sticker-help-orig').textContent = dev.original_sn;

  const subtitle = document.getElementById('single-modal-subtitle');
  if (subtitle) {
    subtitle.textContent = `${dev.custom_sn} (${dev.department_id} - ${dev.original_sn})`;
  }

  const qrContainer = document.getElementById('sticker-qr-container');
  qrContainer.innerHTML = '';

  // Generate QR Code containing custom_sn (e.g. OB01)
  new QRCode(qrContainer, {
    text: dev.custom_sn,
    width: 140,
    height: 140,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });

  document.getElementById('qr-modal').classList.add('open');
}

function openBatchQrModal(deptId = null, devCustomSn = null) {
  const modal = document.getElementById('batch-qr-modal');
  modal.classList.add('open');

  const deptSelect = document.getElementById('batch-dept-filter');
  if (deptId && deptId !== 'ALL') {
    deptSelect.value = deptId;
  }
  
  populateBatchDeviceDropdown();
  
  if (devCustomSn) {
    const devSelect = document.getElementById('batch-device-filter');
    if (devSelect) devSelect.value = devCustomSn;
  }
  
  renderBatchStickers();

  // Auto-focus quick scanner input for instant shooting with barcode scanner
  const scanInput = document.getElementById('sticker-quick-scan-input');
  if (scanInput) {
    scanInput.value = '';
    setTimeout(() => scanInput.focus(), 150);
  }
}

function handleStickerScanSubmit(directCode = null) {
  const scanInput = document.getElementById('sticker-quick-scan-input');
  const rawCode = (directCode || (scanInput ? scanInput.value : '')).trim();
  if (!rawCode) {
    alert('ℹ️ กรุณาใช้เครื่องยิงสแกนบาร์โค้ด PDA เพื่อสั่งพิมพ์ดวงนี้ (ระบบล็อกห้ามพิมพ์ด้วยมือ)');
    if (scanInput) scanInput.focus();
    return;
  }

  // Search case-insensitively in allDevices (matching custom_sn OR original_sn)
  const targetDev = allDevices.find(
    d => (d.custom_sn && d.custom_sn.toLowerCase() === rawCode.toLowerCase()) ||
         (d.original_sn && d.original_sn.toLowerCase() === rawCode.toLowerCase())
  );

  if (targetDev) {
    // Found device! Set department filter and device filter
    const deptSelect = document.getElementById('batch-dept-filter');
    if (deptSelect) deptSelect.value = targetDev.department_id;
    populateBatchDeviceDropdown();

    const devSelect = document.getElementById('batch-device-filter');
    if (devSelect) devSelect.value = targetDev.custom_sn;

    renderBatchStickers();

    // Clear input and trigger print dialog
    if (scanInput) scanInput.value = '';
    setTimeout(() => {
      window.print();
    }, 200);
  } else {
    alert(`❌ ไม่พบอุปกรณ์รหัส "${rawCode}" ในระบบ\n(กรุณาตรวจสอบว่ายิง Custom Code เช่น OB01 หรือ Original Serial Number ถูกต้อง)`);
    if (scanInput) scanInput.select();
  }
}

function onBatchDeptChange() {
  populateBatchDeviceDropdown();
  renderBatchStickers();
}

function populateBatchDeviceDropdown() {
  const deptFilter = document.getElementById('batch-dept-filter').value;
  const devSelect = document.getElementById('batch-device-filter');
  if (!devSelect) return;

  let targetDevices = allDevices;
  if (deptFilter !== 'ALL') {
    targetDevices = targetDevices.filter(d => d.department_id === deptFilter);
  }

  // Sort by custom_sn natural order
  targetDevices.sort((a, b) => (a.custom_sn || '').localeCompare(b.custom_sn || '', undefined, { numeric: true }));

  let html = `<option value="ALL">📋 แสดงทุกเครื่อง (${targetDevices.length} เครื่อง)</option>`;
  targetDevices.forEach(d => {
    html += `<option value="${d.custom_sn}">🏷️ ${d.custom_sn} (${d.original_sn})</option>`;
  });
  devSelect.innerHTML = html;
}

function resetStickerFilter() {
  const devSelect = document.getElementById('batch-device-filter');
  if (devSelect) devSelect.value = 'ALL';
  renderBatchStickers();
}

function printThisSticker(customSn) {
  // Isolate to this single sticker in the view
  const devSelect = document.getElementById('batch-device-filter');
  if (devSelect) {
    devSelect.value = customSn;
  }
  renderBatchStickers();

  // Trigger print dialog
  setTimeout(() => {
    window.print();
  }, 200);
}

function printStickersNow() {
  window.print();
}

function renderBatchStickers() {
  const container = document.getElementById('batch-stickers-container');
  const deptFilter = document.getElementById('batch-dept-filter').value;
  const devFilter = document.getElementById('batch-device-filter') ? document.getElementById('batch-device-filter').value : 'ALL';
  const countBadge = document.getElementById('batch-count-badge');
  const resetBtn = document.getElementById('btn-reset-filter');

  let targetDevices = allDevices;
  if (deptFilter !== 'ALL') {
    targetDevices = targetDevices.filter(d => d.department_id === deptFilter);
  }

  if (devFilter !== 'ALL') {
    targetDevices = targetDevices.filter(d => d.custom_sn === devFilter);
    if (resetBtn) resetBtn.style.display = 'inline-flex';
  } else {
    if (resetBtn) resetBtn.style.display = 'none';
  }

  // Sort by custom_sn
  targetDevices.sort((a, b) => (a.custom_sn || '').localeCompare(b.custom_sn || '', undefined, { numeric: true }));

  if (countBadge) {
    countBadge.textContent = `${targetDevices.length} เครื่อง`;
  }

  container.innerHTML = '';
  if (targetDevices.length === 0) {
    container.className = 'print-sheet-grid';
    container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 2.5rem; color: var(--text-muted); font-size: 0.95rem;">ไม่มีอุปกรณ์ตามเงื่อนไขที่เลือก</p>';
    return;
  }

  // If printing 1 device, add special styling class
  if (targetDevices.length === 1) {
    container.className = 'print-sheet-grid single-item';
  } else {
    container.className = 'print-sheet-grid';
  }

  targetDevices.forEach(dev => {
    const box = document.createElement('div');
    box.className = 'sticker-preview-box';
    box.innerHTML = `
      <div class="sticker-header">
        <span>PDA ASSET TAG</span>
        <span class="sticker-dept-tag">${dev.department_id}</span>
      </div>
      <div class="sticker-qr-canvas" id="batch-qr-${dev.id}"></div>
      <div class="sticker-custom-sn">${dev.custom_sn}</div>
      <div class="sticker-orig-sn">SN: ${dev.original_sn}</div>
      <button type="button" class="sticker-print-btn no-print" onclick="printThisSticker('${dev.custom_sn}')" title="สั่งพิมพ์เฉพาะเครื่องนี้ 1 ดวง">
        <span>🖨️ พิมพ์เฉพาะดวงนี้</span>
      </button>
    `;
    container.appendChild(box);

    new QRCode(box.querySelector(`#batch-qr-${dev.id}`), {
      text: dev.custom_sn,
      width: 120,
      height: 120,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  });
}

// -------------------------------------------------------------
// Tabs: Matrix vs Logs
// -------------------------------------------------------------

function switchMainTab(tab) {
  const matrixSec = document.getElementById('section-matrix');
  const logsSec = document.getElementById('section-logs');
  const navLinks = document.querySelectorAll('header.app-header .nav-link');

  navLinks.forEach(l => l.classList.remove('active'));

  if (tab === 'matrix') {
    matrixSec.style.display = 'block';
    logsSec.style.display = 'none';
    navLinks[0].classList.add('active');
  } else {
    matrixSec.style.display = 'none';
    logsSec.style.display = 'block';
    navLinks[1].classList.add('active');
    fetchLogs();
  }
}

async function fetchLogs() {
  const search = document.getElementById('log-search-input').value.trim();
  const department = document.getElementById('log-dept-filter').value;
  const action = document.getElementById('log-action-filter').value;

  try {
    const params = new URLSearchParams({ search, department, action, limit: '100' });
    const res = await fetch(`/api/logs?${params.toString()}`);
    const data = await res.json();
    if (data.success) {
      renderLogsTable(data.logs);
    }
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

function renderLogsTable(logs) {
  const tbody = document.getElementById('logs-table-body');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">ไม่พบประวัติรายการ</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const isOut = l.action === 'CHECK_OUT';
    const actionBadge = isOut 
      ? `<span class="pill-status red">📤 เบิกออก</span>`
      : `<span class="pill-status green">📥 คืนเข้าตู้</span>`;

    return `
      <tr>
        <td style="font-family: 'JetBrains Mono', monospace; color: var(--text-muted); font-size: 0.8rem;">#${l.id}</td>
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: var(--text-body);">${l.timestamp}</td>
        <td><strong style="color: #1d4ed8;">${l.department_id}</strong> <span style="color: var(--text-muted);">(${l.department_name || ''})</span></td>
        <td>${actionBadge}</td>
        <td><strong style="font-family: 'JetBrains Mono', monospace; color: var(--text-main); font-size: 0.95rem;">${l.custom_sn}</strong></td>
        <td style="font-family: 'JetBrains Mono', monospace; color: var(--text-muted);">${l.original_sn}</td>
        <td><strong style="color: #0f172a;">${l.staff_id || '-'}</strong></td>
        <td>${isOut ? '<span style="color: var(--color-red-text); font-weight: 600;">กำลังใช้งาน</span>' : '<span style="color: var(--color-green-text); font-weight: 600;">อยู่ในตู้</span>'}</td>
      </tr>
    `;
  }).join('');
}

function exportLogsCsv() {
  const search = document.getElementById('log-search-input').value.trim();
  const department = document.getElementById('log-dept-filter').value;
  const action = document.getElementById('log-action-filter').value;

  const params = new URLSearchParams({ search, department, action });
  window.location.href = `/api/logs/export?${params.toString()}`;
}

// -------------------------------------------------------------
// Batch Import PDA from Excel / CSV Logic
// -------------------------------------------------------------
let parsedImportDevices = [];

function openImportModal() {
  updateDepartmentDropdowns(); // Ensure latest departments created are populated in dropdown
  parsedImportDevices = [];
  document.getElementById('import-file-input').value = '';
  document.getElementById('drop-zone-text').textContent = 'คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่';
  document.getElementById('import-summary-badge').style.display = 'none';
  document.getElementById('import-preview-container').style.display = 'none';
  document.getElementById('btn-confirm-import').disabled = true;
  document.getElementById('btn-confirm-import').style.opacity = '0.6';
  document.getElementById('import-btn-count').textContent = '0';

  setupDragAndDrop();
  document.getElementById('import-modal').classList.add('open');
}

function setupDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone || dropZone.dataset.setupDone) return;
  dropZone.dataset.setupDone = 'true';

  ['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '#2563eb';
      dropZone.style.backgroundColor = '#eff6ff';
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '#cbd5e1';
      dropZone.style.backgroundColor = '#ffffff';
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  });
}

function handleFileSelected(e) {
  const files = e.target.files;
  if (files && files.length > 0) {
    processFile(files[0]);
  }
}

function processFile(file) {
  if (!file) return;
  document.getElementById('drop-zone-text').innerHTML = `📄 กำลังอ่านไฟล์: <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)`;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (rawRows.length === 0) {
        alert('ไฟล์ไม่มีข้อมูล หรือตารางว่างเปล่า');
        return;
      }

      parseAndPreviewRows(rawRows);
    } catch (err) {
      alert('ไม่สามารถอ่านไฟล์ได้: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseAndPreviewRows(rawRows) {
  const defaultDept = document.getElementById('import-default-dept').value || (allDepartments[0] ? allDepartments[0].id : 'IB');
  parsedImportDevices = [];

  rawRows.forEach((row, idx) => {
    // Dynamically match column headers in Thai or English
    let original_sn = '';
    let custom_sn = '';
    let department_id = '';
    let model = '';
    let notes = '';

    for (const [key, val] of Object.entries(row)) {
      const k = key.toLowerCase().trim();
      const v = (val || '').toString().trim();

      if (k.includes('original') || k === 'sn' || k.includes('serial') || k.includes('เดิม') || k.includes('รหัสเครื่อง')) {
        original_sn = v;
      } else if (k.includes('custom') || k.includes('alias') || k.includes('ad') || k.includes('qr') || k.includes('รหัสย่อ')) {
        custom_sn = v;
      } else if (k.includes('dept') || k.includes('department') || k.includes('แผนก') || k.includes('ตู้')) {
        department_id = v.toUpperCase();
      } else if (k.includes('model') || k.includes('รุ่น') || k.includes('brand') || k.includes('ยี่ห้อ')) {
        model = v;
      } else if (k.includes('note') || k.includes('remark') || k.includes('หมายเหตุ')) {
        notes = v;
      }
    }

    // Fallback: If only 1 column exists without recognizable header, treat as original_sn
    if (!original_sn && Object.values(row).length > 0) {
      original_sn = Object.values(row)[0].toString().trim();
    }

    if (original_sn) {
      const fileDept = department_id;
      let resolvedDept = '';

      if (fileDept) {
        // 1. Exact match with existing departments
        const found = allDepartments.find(d => 
          d.id.toLowerCase() === fileDept.toLowerCase() ||
          (d.name && d.name.toLowerCase() === fileDept.toLowerCase())
        );
        if (found) {
          resolvedDept = found.id;
        } else {
          // 2. Prefix match (e.g. file has 'OBD' and system has 'OBD A')
          const prefixMatch = allDepartments.find(d => 
            d.id.toLowerCase().startsWith(fileDept.toLowerCase()) ||
            fileDept.toLowerCase().startsWith(d.id.toLowerCase())
          );
          if (prefixMatch) {
            resolvedDept = prefixMatch.id;
          } else {
            // Keep the file's department directly (backend will auto-create this new cabinet!)
            resolvedDept = fileDept;
          }
        }
      } else {
        // No department in file -> use selected default department
        resolvedDept = defaultDept;
      }

      parsedImportDevices.push({
        original_sn,
        custom_sn,
        file_dept: fileDept,
        department_id: resolvedDept,
        model: model || 'Standard PDA',
        notes
      });
    }
  });

  renderImportPreview();
}

function recalculatePreview() {
  const defaultDept = document.getElementById('import-default-dept').value || (allDepartments[0] ? allDepartments[0].id : 'IB');
  parsedImportDevices.forEach(d => {
    // If no department specified in file, apply newly selected default department
    if (!d.file_dept) {
      d.department_id = defaultDept;
    }
  });
  renderImportPreview();
}

function renderImportPreview() {
  const tbody = document.getElementById('import-preview-body');
  const previewContainer = document.getElementById('import-preview-container');
  const summaryBadge = document.getElementById('import-summary-badge');
  const confirmBtn = document.getElementById('btn-confirm-import');
  const btnCount = document.getElementById('import-btn-count');

  if (parsedImportDevices.length === 0) {
    previewContainer.style.display = 'none';
    summaryBadge.style.display = 'none';
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.6';
    btnCount.textContent = '0';
    return;
  }

  // All rows with Original SN are accepted
  let validCount = parsedImportDevices.length;
  tbody.innerHTML = parsedImportDevices.map((d, idx) => {
    const isNewDept = !allDepartments.some(dept => dept.id.toLowerCase() === (d.department_id || '').toLowerCase());
    const isExistingDev = allDevices.some(ex => ex.original_sn.toLowerCase() === d.original_sn.toLowerCase());

    return `
      <tr>
        <td style="color: var(--text-muted);">${idx + 1}</td>
        <td>
          <strong style="font-family: monospace;">${d.original_sn}</strong>
          ${isExistingDev ? '<span style="color: #2563eb; font-size: 0.72rem; display: block;">🔄 มีในระบบแล้ว (จะอัปเดตข้อมูล)</span>' : ''}
        </td>
        <td>
          <span style="font-family: monospace; color: ${d.custom_sn ? 'var(--text-main)' : '#2563eb'};">
            ${d.custom_sn || '<em>[รันเลขอัตโนมัติ: ad...]</em>'}
          </span>
        </td>
        <td>
          <span class="pill-status" style="background: #eff6ff; color: #1d4ed8; padding: 0.15rem 0.5rem; font-weight: 600;">
            ${d.department_id || '-'}
          </span>
          ${isNewDept ? '<span style="color: #059669; font-size: 0.72rem; display: block;">✨ ตู้ใหม่ (สร้างอัตโนมัติ)</span>' : ''}
        </td>
        <td style="color: var(--text-muted);">${d.model || '-'}</td>
        <td style="color: var(--text-muted);">${d.notes || '-'}</td>
      </tr>
    `;
  }).join('');

  previewContainer.style.display = 'block';
  summaryBadge.style.display = 'inline-block';
  summaryBadge.innerHTML = `ตรวจพบ <strong>${parsedImportDevices.length}</strong> เครื่อง (พร้อมนำเข้า <strong>${validCount}</strong> เครื่อง)`;

  btnCount.textContent = validCount;
  confirmBtn.disabled = validCount === 0;
  confirmBtn.style.opacity = validCount > 0 ? '1' : '0.6';
}

async function executeBatchImport() {
  if (parsedImportDevices.length === 0) return;

  const btn = document.getElementById('btn-confirm-import');
  btn.disabled = true;
  btn.innerHTML = '⏳ กำลังนำเข้าข้อมูล...';

  try {
    const res = await fetch('/api/devices/batch-import', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ devices: parsedImportDevices })
    });

    const data = await res.json();
    if (data.success) {
      let msg = `✅ นำเข้าข้อมูลสำเร็จเรียบร้อย!\n- บันทึกสำเร็จ: ${data.imported} เครื่อง`;
      if (data.failed > 0) {
        msg += `\n⚠️ ข้าม (ไม่ผ่าน): ${data.failed} เครื่อง`;
        if (data.errors && data.errors.length > 0) {
          const reasons = data.errors.slice(0, 5).map(e => `• แถว ${e.row} (${e.sn}): ${e.error}`).join('\n');
          msg += `\n\nสาเหตุที่ไม่ผ่าน:\n${reasons}`;
          if (data.errors.length > 5) {
            msg += `\n...และอีก ${data.errors.length - 5} รายการ`;
          }
        }
      }
      alert(msg);
      closeModal('import-modal');
      refreshData();
    } else {
      alert('เกิดข้อผิดพลาด: ' + (data.message || data.error || 'ไม่สามารถนำเข้าข้อมูลได้'));
    }
  } catch (err) {
    alert('การเชื่อมต่อขัดข้อง: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '💾 ยืนยันนำเข้าข้อมูล';
  }
}

function downloadImportTemplate(type) {
  const sampleRows = [
    {
      "Original SN": "SN-2024-001",
      "Custom Code": "ad015",
      "Department": "IB",
      "Model": "Zebra TC26",
      "Notes": "ตู้ชั้น 1"
    },
    {
      "Original SN": "SN-2024-002",
      "Custom Code": "",
      "Department": "MS",
      "Model": "Honeywell EDA51",
      "Notes": "เว้นว่าง Custom Code ให้ระบบรันเลขอัตโนมัติได้"
    },
    {
      "Original SN": "SN-2024-003",
      "Custom Code": "",
      "Department": "CBS",
      "Model": "Zebra TC52",
      "Notes": ""
    },
    {
      "Original SN": "SN-2024-004",
      "Custom Code": "",
      "Department": "MCBS",
      "Model": "Zebra TC26",
      "Notes": ""
    },
    {
      "Original SN": "SN-2024-005",
      "Custom Code": "",
      "Department": "OBS",
      "Model": "Zebra TC52",
      "Notes": ""
    }
  ];

  if (type === 'xlsx') {
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PDA_Template");
    XLSX.writeFile(wb, "pda_import_template.xlsx");
  } else {
    const headers = ["Original SN", "Custom Code", "Department", "Model", "Notes"];
    const csvLines = [headers.join(',')];
    sampleRows.forEach(r => {
      csvLines.push(`"${r['Original SN']}","${r['Custom Code']}","${r['Department']}","${r['Model']}","${r['Notes']}"`);
    });
    const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pda_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
