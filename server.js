import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data folder exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const dbPath = path.join(dataDir, 'pda_storage.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_sn TEXT UNIQUE NOT NULL COLLATE NOCASE,
    custom_sn TEXT UNIQUE NOT NULL COLLATE NOCASE,
    model TEXT,
    department_id TEXT NOT NULL REFERENCES departments(id),
    status TEXT DEFAULT 'IN_CABINET',
    current_staff_id TEXT,
    last_action_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER,
    original_sn TEXT NOT NULL,
    custom_sn TEXT NOT NULL,
    department_id TEXT NOT NULL,
    action TEXT NOT NULL, -- 'CHECK_OUT' | 'CHECK_IN'
    staff_id TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now', 'localtime')),
    notes TEXT
  );
`);

// Pre-populate departments if empty
const deptCount = db.prepare('SELECT COUNT(*) as count FROM departments').get().count;
if (deptCount === 0) {
  const defaultDepts = [
    { id: 'IB', name: 'Inbound', description: 'รับเข้าสินค้า', display_order: 1 },
    { id: 'MS', name: 'Manual Sort', description: 'คัดแยกด้วยมือ', display_order: 2 },
    { id: 'CBS', name: 'Cross Belt Sort', description: 'คัดแยกสายพาน Cross Belt', display_order: 3 },
    { id: 'MCBS', name: 'Mini Cross Belt Sort', description: 'คัดแยกสายพาน Mini Cross Belt', display_order: 4 },
    { id: 'OBI', name: 'Outbound Induction', description: 'อินดักชั่นขาออก', display_order: 5 },
    { id: 'OBS', name: 'Outbound Sort', description: 'คัดแยกขาออก', display_order: 6 },
    { id: 'OBD', name: 'Outbound Dispatch', description: 'จ่ายสินค้าออก', display_order: 7 }
  ];

  const insertDept = db.prepare(`
    INSERT INTO departments (id, name, description, display_order)
    VALUES (?, ?, ?, ?)
  `);

  for (const d of defaultDepts) {
    insertDept.run(d.id, d.name, d.description, d.display_order);
  }
}

// Pre-populate sample devices if empty
const devCount = db.prepare('SELECT COUNT(*) as count FROM devices').get().count;
if (devCount === 0) {
  const sampleDevices = [
    // IB
    { orig: 'SN001', custom: 'ad001', model: 'Zebra TC26', dept: 'IB', status: 'IN_CABINET', staff: null },
    { orig: 'SN002', custom: 'ad002', model: 'Zebra TC26', dept: 'IB', status: 'CHECKED_OUT', staff: 'EMP-1021' },
    // MS
    { orig: 'SN003', custom: 'ad003', model: 'Honeywell EDA51', dept: 'MS', status: 'IN_CABINET', staff: null },
    { orig: 'SN004', custom: 'ad004', model: 'Honeywell EDA51', dept: 'MS', status: 'IN_CABINET', staff: null },
    // CBS
    { orig: 'SN005', custom: 'ad005', model: 'Zebra TC52', dept: 'CBS', status: 'IN_CABINET', staff: null },
    { orig: 'SN006', custom: 'ad006', model: 'Zebra TC52', dept: 'CBS', status: 'CHECKED_OUT', staff: 'EMP-3044' },
    // MCBS
    { orig: 'SN007', custom: 'ad007', model: 'Zebra TC26', dept: 'MCBS', status: 'IN_CABINET', staff: null },
    { orig: 'SN008', custom: 'ad008', model: 'Zebra TC26', dept: 'MCBS', status: 'IN_CABINET', staff: null },
    // OBI
    { orig: 'SN009', custom: 'ad009', model: 'Honeywell EDA51', dept: 'OBI', status: 'IN_CABINET', staff: null },
    { orig: 'SN010', custom: 'ad010', model: 'Honeywell EDA51', dept: 'OBI', status: 'IN_CABINET', staff: null },
    // OBS
    { orig: 'SN011', custom: 'ad011', model: 'Zebra TC52', dept: 'OBS', status: 'IN_CABINET', staff: null },
    { orig: 'SN012', custom: 'ad012', model: 'Zebra TC52', dept: 'OBS', status: 'CHECKED_OUT', staff: 'EMP-5012' },
    // OBD
    { orig: 'SN013', custom: 'ad013', model: 'Zebra TC26', dept: 'OBD', status: 'IN_CABINET', staff: null },
    { orig: 'SN014', custom: 'ad014', model: 'Zebra TC26', dept: 'OBD', status: 'IN_CABINET', staff: null }
  ];

  const insertDev = db.prepare(`
    INSERT INTO devices (original_sn, custom_sn, model, department_id, status, current_staff_id, last_action_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `);

  const insertLog = db.prepare(`
    INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `);

  for (const s of sampleDevices) {
    const res = insertDev.run(s.orig, s.custom, s.model, s.dept, s.status, s.staff);
    if (s.status === 'CHECKED_OUT' && s.staff) {
      insertLog.run(res.lastInsertRowid, s.orig, s.custom, s.dept, 'CHECK_OUT', s.staff);
    }
  }
}

// Ensure OBD A department exists
db.prepare(`
  INSERT OR IGNORE INTO departments (id, name, description, display_order)
  VALUES ('OBD A', 'Outbound Dispatch Zone A', 'จ่ายสินค้าออก Zone A', 8)
`).run();

// Seed OB devices from seed_ob_devices.json if not present
const seedFilePath = path.join(__dirname, 'seed_ob_devices.json');
if (fs.existsSync(seedFilePath)) {
  try {
    const obList = JSON.parse(fs.readFileSync(seedFilePath, 'utf8'));
    const checkDev = db.prepare('SELECT id FROM devices WHERE original_sn = ? OR custom_sn = ?');
    const addDev = db.prepare(`
      INSERT INTO devices (original_sn, custom_sn, model, department_id, notes, status, current_staff_id, last_action_at)
      VALUES (?, ?, ?, ?, ?, 'IN_CABINET', NULL, datetime('now', 'localtime'))
    `);
    for (const [orig, cust, model, dept, notes] of obList) {
      if (!checkDev.get(orig, cust)) {
        addDev.run(orig, cust, model, dept, notes);
      }
    }
  } catch (err) {
    console.warn('Error loading seed_ob_devices.json:', err);
  }
}

// -------------------------------------------------------------
// Helper function to find next custom code (e.g. ad001, ad002 ...)
// -------------------------------------------------------------
function generateNextCustomCode() {
  const devices = db.prepare("SELECT custom_sn FROM devices WHERE custom_sn LIKE 'ad%'").all();
  let maxNum = 0;
  for (const d of devices) {
    const match = d.custom_sn.match(/^ad(\d+)$/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const nextNum = maxNum + 1;
  return `ad${String(nextNum).padStart(3, '0')}`;
}

// -------------------------------------------------------------
// Admin Authentication & Password Management
// -------------------------------------------------------------
const configPath = path.join(dataDir, 'config.json');

function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD.trim();
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (data.admin_password) return String(data.admin_password).trim();
    } catch (e) {}
  }
  try {
    db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);");
    const row = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
    if (row && row.value) return String(row.value).trim();
  } catch (e) {}
  return "admin";
}

function setAdminPassword(newPwd) {
  const pwd = String(newPwd).trim();
  try {
    let cfg = {};
    if (fs.existsSync(configPath)) {
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch (e) {}
    }
    cfg.admin_password = pwd;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving config.json:', e);
  }

  try {
    db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);");
    db.prepare("INSERT INTO settings (key, value) VALUES ('admin_password', ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(pwd, pwd);
  } catch (e) {
    console.error('Error saving settings table:', e);
  }
}

function getAdminToken() {
  const pwd = getAdminPassword();
  return crypto.createHash('sha256').update(`pda_admin_secret_${pwd}`).digest('hex');
}

// Admin Auth Endpoints
app.post('/api/admin/login', (req, res) => {
  const pwd = (req.body?.password || '').trim();
  if (pwd === getAdminPassword()) {
    return res.json({
      success: true,
      message: 'เข้าสู่ระบบสำเร็จ',
      token: getAdminToken()
    });
  }
  return res.status(401).json({ success: false, message: 'รหัสผ่าน Admin ไม่ถูกต้อง' });
});

app.all('/api/admin/check-auth', (req, res) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token && token === getAdminToken()) {
    return res.json({ authenticated: true });
  }
  return res.status(401).json({ authenticated: false });
});

app.post('/api/admin/change-password', (req, res) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== getAdminToken()) {
    return res.status(401).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการ (กรุณาเข้าสู่ระบบก่อน)' });
  }
  const newPwd = (req.body?.new_password || '').trim();
  if (!newPwd) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสผ่านใหม่' });
  }
  setAdminPassword(newPwd);
  return res.json({
    success: true,
    message: 'เปลี่ยนรหัสผ่าน Admin สำเร็จ',
    token: getAdminToken()
  });
});

// -------------------------------------------------------------
// Helper: Department Code Normalizer & Matcher
// -------------------------------------------------------------
function normalizeDeptCode(s) {
  return (s || '').replace(/[\s\-_]+/g, '').toUpperCase();
}

function isDepartmentCompatible(d1, d2, devDeptName = '') {
  if (!d1 || !d2) return true;
  const n1 = normalizeDeptCode(d1);
  const n2 = normalizeDeptCode(d2);
  if (n1 === n2) return true;
  if (n1.startsWith(n2) || n2.startsWith(n1)) return true;
  if (devDeptName) {
    const nName = normalizeDeptCode(devDeptName);
    if (nName === n2 || nName.startsWith(n2) || n2.startsWith(nName)) return true;
  }
  return false;
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. Get statistics overview
app.get('/api/stats', (req, res) => {
  try {
    const totalDevices = db.prepare('SELECT COUNT(*) as count FROM devices').get().count;
    const inCabinet = db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'IN_CABINET'").get().count;
    const checkedOut = db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'CHECKED_OUT'").get().count;
    const abnormalCount = db.prepare("SELECT COUNT(*) as count FROM logs WHERE LOWER(action) = 'abnormal'").get().count;

    const recentAbnormals = db.prepare(`
      SELECT l.*, d.name as department_name
      FROM logs l
      LEFT JOIN departments d ON l.department_id = d.id
      WHERE LOWER(l.action) = 'abnormal'
      ORDER BY l.id DESC LIMIT 5
    `).all();

    const deptStats = db.prepare(`
      SELECT 
        d.id, 
        d.name, 
        d.description,
        COUNT(dev.id) as total_devices,
        SUM(CASE WHEN dev.status = 'IN_CABINET' THEN 1 ELSE 0 END) as in_cabinet,
        SUM(CASE WHEN dev.status = 'CHECKED_OUT' THEN 1 ELSE 0 END) as checked_out
      FROM departments d
      LEFT JOIN devices dev ON d.id = dev.department_id
      GROUP BY d.id
      ORDER BY d.display_order ASC
    `).all();

    res.json({
      success: true,
      stats: {
        total: totalDevices,
        inCabinet,
        checkedOut,
        abnormalCount,
        recentAbnormals,
        departments: deptStats
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Get all departments
app.get('/api/departments', (req, res) => {
  try {
    const departments = db.prepare(`
      SELECT 
        d.*,
        COUNT(dev.id) as total_devices,
        SUM(CASE WHEN dev.status = 'IN_CABINET' THEN 1 ELSE 0 END) as in_cabinet,
        SUM(CASE WHEN dev.status = 'CHECKED_OUT' THEN 1 ELSE 0 END) as checked_out
      FROM departments d
      LEFT JOIN devices dev ON d.id = dev.department_id
      GROUP BY d.id
      ORDER BY d.display_order ASC
    `).all();
    res.json({ success: true, departments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new department
app.post('/api/departments', (req, res) => {
  try {
    const token = req.headers['x-admin-token'] || req.query.token;
    if (!token || token !== getAdminToken()) {
      return res.status(401).json({ success: false, message: 'ต้องเป็น Admin เท่านั้น' });
    }
    const deptId = (req.body.id || '').trim().toUpperCase();
    const name = (req.body.name || '').trim();
    const desc = (req.body.description || '').trim();

    if (!deptId || !name) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสย่อและชื่อแผนก' });
    }

    const existing = db.prepare('SELECT id FROM departments WHERE id = ? COLLATE NOCASE').get(deptId);
    if (existing) {
      return res.status(400).json({ success: false, message: `รหัสแผนก [${deptId}] มีอยู่ในระบบแล้ว` });
    }

    const row = db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM departments').get();
    db.prepare('INSERT INTO departments (id, name, description, display_order) VALUES (?, ?, ?, ?)').run(deptId, name, desc, row.next_order);

    res.json({ success: true, message: `เพิ่มตู้จัดเก็บแผนก [${deptId} - ${name}] สำเร็จแล้ว` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete department
app.delete('/api/departments/:id', (req, res) => {
  try {
    const token = req.headers['x-admin-token'] || req.query.token;
    if (!token || token !== getAdminToken()) {
      return res.status(401).json({ success: false, message: 'ต้องเป็น Admin เท่านั้น' });
    }
    const deptId = (req.params.id || '').trim().toUpperCase();

    const devCount = db.prepare('SELECT COUNT(*) as count FROM devices WHERE department_id = ?').get(deptId);
    if (devCount && devCount.count > 0) {
      return res.status(400).json({ success: false, message: `ไม่สามารถลบแผนก [${deptId}] ได้เนื่องจากมี PDA อยู่ ${devCount.count} เครื่อง` });
    }

    db.prepare('DELETE FROM departments WHERE id = ?').run(deptId);
    res.json({ success: true, message: `ลบแผนก [${deptId}] เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Get all devices with filters
app.get('/api/devices', (req, res) => {
  try {
    const { department, status, search } = req.query;
    let query = `
      SELECT dev.*, d.name as department_name 
      FROM devices dev
      JOIN departments d ON dev.department_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (department && department !== 'ALL') {
      const deptClean = decodeURIComponent(department).trim();
      query += ` AND (
        dev.department_id = ? COLLATE NOCASE 
        OR dev.department_id = ? COLLATE NOCASE
        OR dev.department_id LIKE ? COLLATE NOCASE
        OR d.name = ? COLLATE NOCASE
      )`;
      params.push(department, deptClean, `${deptClean}%`, deptClean);
    }
    if (status && status !== 'ALL') {
      query += ' AND dev.status = ?';
      params.push(status);
    }
    if (search && search.trim() !== '') {
      query += ' AND (dev.original_sn LIKE ? OR dev.custom_sn LIKE ? OR dev.model LIKE ? OR dev.current_staff_id LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }

    query += ' ORDER BY dev.department_id ASC, dev.custom_sn ASC';
    const devices = db.prepare(query).all(...params);
    res.json({ success: true, devices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Suggest next custom code
app.get('/api/devices/suggest-custom-sn', (req, res) => {
  try {
    const code = generateNextCustomCode();
    res.json({ success: true, custom_sn: code });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Resolve device by code (either original_sn or custom_sn, or compound string like ad003ad004)
app.get('/api/devices/resolve/:code', (req, res) => {
  try {
    const rawCode = (req.params.code || '').trim();
    if (!rawCode) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสอุปกรณ์' });
    }

    // Direct match check
    const singleDevice = db.prepare(`
      SELECT dev.*, d.name as department_name, d.description as department_desc
      FROM devices dev
      LEFT JOIN departments d ON dev.department_id = d.id
      WHERE dev.original_sn = ? COLLATE NOCASE OR dev.custom_sn = ? COLLATE NOCASE
    `).get(rawCode, rawCode);

    if (singleDevice) {
      return res.json({ success: true, device: singleDevice });
    }

    // Check if input is a compound/concatenated code (e.g. 'ad003ad004' or space-separated)
    const tokens = rawCode.split(/[\s,;\t\r\n]+/).filter(Boolean);
    const subCodes = [];
    for (const t of tokens) {
      const compoundMatches = t.match(/([a-zA-Z]+[-_]?[0-9]+)/gi);
      if (compoundMatches && compoundMatches.length > 1 && compoundMatches.join('').toLowerCase() === t.toLowerCase()) {
        subCodes.push(...compoundMatches);
      } else {
        subCodes.push(t);
      }
    }

    if (subCodes.length > 1) {
      const foundDevices = [];
      const findStmt = db.prepare(`
        SELECT dev.*, d.name as department_name, d.description as department_desc
        FROM devices dev
        LEFT JOIN departments d ON dev.department_id = d.id
        WHERE dev.original_sn = ? COLLATE NOCASE OR dev.custom_sn = ? COLLATE NOCASE
      `);

      for (const sc of subCodes) {
        const d = findStmt.get(sc, sc);
        if (d) foundDevices.push(d);
      }

      if (foundDevices.length > 0) {
        return res.json({
          success: true,
          isCompound: true,
          device: foundDevices[0],
          devices: foundDevices,
          parsedCount: foundDevices.length
        });
      }
    }

    return res.status(404).json({
      success: false,
      message: `ไม่พบอุปกรณ์รหัส "${rawCode}" ในระบบ กรุณาตรวจสอบ Serial Number หรือติดต่อ Admin`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Create new device
app.post('/api/devices', (req, res) => {
  try {
    let { original_sn, custom_sn, model, department_id, notes } = req.body;
    original_sn = (original_sn || '').trim();
    custom_sn = (custom_sn || '').trim();
    model = (model || '').trim();
    department_id = (department_id || '').trim().toUpperCase();

    if (!original_sn) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุ Original Serial Number' });
    }
    if (!department_id) {
      return res.status(400).json({ success: false, message: 'กรุณาเลือกแผนก/ตู้จัดเก็บ' });
    }

    // Auto-generate custom_sn if empty
    if (!custom_sn) {
      custom_sn = generateNextCustomCode();
    }

    // Check duplicate original_sn
    const existOrig = db.prepare('SELECT id FROM devices WHERE original_sn = ? COLLATE NOCASE').get(original_sn);
    if (existOrig) {
      return res.status(400).json({ success: false, message: `Original SN "${original_sn}" มีอยู่ในระบบแล้ว` });
    }

    // Check duplicate custom_sn
    const existCustom = db.prepare('SELECT id FROM devices WHERE custom_sn = ? COLLATE NOCASE').get(custom_sn);
    if (existCustom) {
      return res.status(400).json({ success: false, message: `รหัสย่อใหม่ "${custom_sn}" มีอยู่ในระบบแล้ว` });
    }

    // Verify department exists
    const dept = db.prepare('SELECT id FROM departments WHERE id = ?').get(department_id);
    if (!dept) {
      return res.status(400).json({ success: false, message: `ไม่พบแผนก "${department_id}"` });
    }

    const insert = db.prepare(`
      INSERT INTO devices (original_sn, custom_sn, model, department_id, status, notes, last_action_at)
      VALUES (?, ?, ?, ?, 'IN_CABINET', ?, datetime('now', 'localtime'))
    `);
    const result = insert.run(original_sn, custom_sn, model || 'Standard PDA', department_id, notes || '');

    const newDevice = db.prepare('SELECT * FROM devices WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, device: newDevice, message: 'เพิ่มอุปกรณ์เข้าสู่ระบบสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.1 Batch Import Devices (from Excel/CSV file upload)
app.post('/api/devices/batch-import', (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่มีข้อมูลอุปกรณ์ที่ส่งมา' });
    }

    const checkOrig = db.prepare('SELECT id FROM devices WHERE original_sn = ? COLLATE NOCASE');
    const checkCustom = db.prepare('SELECT id FROM devices WHERE custom_sn = ? COLLATE NOCASE');
    const checkDept = db.prepare('SELECT id FROM departments WHERE id = ?');
    const insertDev = db.prepare(`
      INSERT INTO devices (original_sn, custom_sn, model, department_id, status, notes, last_action_at)
      VALUES (?, ?, ?, ?, 'IN_CABINET', ?, datetime('now', 'localtime'))
    `);

    let importedCount = 0;
    const errors = [];

    db.exec('BEGIN TRANSACTION');
    try {
      for (let i = 0; i < devices.length; i++) {
        const row = devices[i];
        let original_sn = (row.original_sn || '').toString().trim();
        let custom_sn = (row.custom_sn || '').toString().trim();
        let department_id = (row.department_id || '').toString().trim().toUpperCase();
        let model = (row.model || 'Standard PDA').toString().trim();
        let notes = (row.notes || '').toString().trim();

        if (!original_sn) {
          errors.push({ row: i + 1, sn: '(ว่าง)', error: 'ไม่มี Serial Number' });
          continue;
        }

        // 1. Department resolution: Exact -> Prefix -> Auto Create department on the fly
        let matchedDept = checkDept.get(department_id);
        if (!matchedDept) {
          const prefixDept = db.prepare('SELECT id FROM departments WHERE id LIKE ? OR name LIKE ? COLLATE NOCASE ORDER BY display_order ASC LIMIT 1').get(`${department_id}%`, `${department_id}%`);
          if (prefixDept) {
            department_id = prefixDept.id;
          } else {
            const nextOrderRow = db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM departments').get();
            const nextOrder = nextOrderRow ? nextOrderRow.next_order : 1;
            db.prepare('INSERT INTO departments (id, name, description, display_order) VALUES (?, ?, ?, ?)').run(department_id, department_id, 'สร้างอัตโนมัติจากการนำเข้าไฟล์', nextOrder);
          }
        }

        // 2. Check if device already exists (UPSERT: Update existing device instead of rejecting)
        const existingDev = db.prepare('SELECT id, custom_sn FROM devices WHERE original_sn = ? COLLATE NOCASE').get(original_sn);
        if (existingDev) {
          let finalCust = existingDev.custom_sn;
          if (custom_sn && custom_sn.toLowerCase() !== (finalCust || '').toLowerCase()) {
            const custConflict = db.prepare('SELECT id FROM devices WHERE custom_sn = ? COLLATE NOCASE AND id != ?').get(custom_sn, existingDev.id);
            if (!custConflict) {
              finalCust = custom_sn;
            }
          }
          db.prepare(`
            UPDATE devices 
            SET department_id = ?, custom_sn = ?, model = COALESCE(NULLIF(?, ''), model), notes = COALESCE(NULLIF(?, ''), notes)
            WHERE id = ?
          `).run(department_id, finalCust, model, notes, existingDev.id);
          importedCount++;
          continue;
        }

        // 3. New device: Auto-resolve custom_sn
        if (!custom_sn) {
          custom_sn = generateNextCustomCode();
        } else {
          // If custom_sn is already taken by another device, auto-generate unique custom_sn
          if (checkCustom.get(custom_sn)) {
            custom_sn = generateNextCustomCode();
          }
        }

        insertDev.run(original_sn, custom_sn, model, department_id, notes);
        importedCount++;
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.json({
      success: true,
      total: devices.length,
      imported: importedCount,
      failed: errors.length,
      errors
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Update device
app.put('/api/devices/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    let { original_sn, custom_sn, model, department_id, notes, status } = req.body;
    original_sn = (original_sn || '').trim();
    custom_sn = (custom_sn || '').trim();
    model = (model || '').trim();
    department_id = (department_id || '').trim().toUpperCase();

    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    if (!device) {
      return res.status(404).json({ success: false, message: 'ไม่พบอุปกรณ์' });
    }

    // Check duplicate original_sn
    if (original_sn) {
      const dup = db.prepare('SELECT id FROM devices WHERE original_sn = ? COLLATE NOCASE AND id != ?').get(original_sn, id);
      if (dup) {
        return res.status(400).json({ success: false, message: `Original SN "${original_sn}" ซ้ำกับเครื่องอื่น` });
      }
    }

    // Check duplicate custom_sn
    if (custom_sn) {
      const dup = db.prepare('SELECT id FROM devices WHERE custom_sn = ? COLLATE NOCASE AND id != ?').get(custom_sn, id);
      if (dup) {
        return res.status(400).json({ success: false, message: `รหัสย่อ "${custom_sn}" ซ้ำกับเครื่องอื่น` });
      }
    }

    db.prepare(`
      UPDATE devices
      SET original_sn = COALESCE(?, original_sn),
          custom_sn = COALESCE(?, custom_sn),
          model = COALESCE(?, model),
          department_id = COALESCE(?, department_id),
          notes = COALESCE(?, notes),
          status = COALESCE(?, status)
      WHERE id = ?
    `).run(original_sn || null, custom_sn || null, model || null, department_id || null, notes || null, status || null, id);

    const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    res.json({ success: true, device: updated, message: 'แก้ไขข้อมูลสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Delete device
app.delete('/api/devices/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    if (!device) {
      return res.status(404).json({ success: false, message: 'ไม่พบอุปกรณ์' });
    }

    db.prepare('DELETE FROM devices WHERE id = ?').run(id);
    res.json({ success: true, message: `ลบอุปกรณ์ ${device.custom_sn} (${device.original_sn}) สำเร็จ` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const isDeptComp = (d1, d2) => {
  if (!d1 || !d2) return true;
  const c1 = decodeURIComponent(d1).replace(/[\s\-_]+/g, '').toUpperCase();
  const c2 = decodeURIComponent(d2).replace(/[\s\-_]+/g, '').toUpperCase();
  return c1 === c2 || c1.startsWith(c2) || c2.startsWith(c1);
};

// -------------------------------------------------------------
// Core Business Flow: Check-in / Check-out Scanner Endpoint
// -------------------------------------------------------------
app.post('/api/scan', (req, res) => {
  try {
    let { code, staff_id, department_id, action } = req.body;
    code = (code || '').trim();
    staff_id = (staff_id || '').trim();
    department_id = (department_id || '').trim().toUpperCase();
    action = (action || 'AUTO').toUpperCase(); // 'CHECK_OUT' | 'CHECK_IN' | 'AUTO'

    if (!code) {
      return res.status(400).json({
        success: false,
        errorType: 'MISSING_CODE',
        message: 'กรุณากรอกหรือยิงสแกนรหัส PDA (Original SN หรือ รหัสย่อ เช่น ad001)'
      });
    }

    if (!department_id) {
      department_id = 'OBD A';
    }

    // 1. Resolve PDA by either original_sn or custom_sn
    const device = db.prepare(`
      SELECT dev.*, d.name as department_name 
      FROM devices dev
      LEFT JOIN departments d ON dev.department_id = d.id
      WHERE dev.original_sn = ? COLLATE NOCASE OR dev.custom_sn = ? COLLATE NOCASE
    `).get(code, code);

    if (!device) {
      return res.status(404).json({
        success: false,
        errorType: 'DEVICE_NOT_FOUND',
        message: `❌ ไม่พบ PDA รหัส "${code}" ในระบบฐานข้อมูล (กรุณาตรวจสอบว่าลงทะเบียนเครื่องแล้วหรือยัง)`
      });
    }
 
    // Department validation: device MUST belong to this cabinet's department!
    const devDept = device.department_id || '';
    const devDeptName = device.department_name || devDept;
    if (department_id && devDept && !isDepartmentCompatible(devDept, department_id, devDeptName)) {
      const noteMsg = `ยิงผิดตู้: เครื่องสังกัดแผนก ${devDept} (${devDeptName}) ถูกนำมายิงที่ตู้ ${department_id}`;
      db.prepare(`
        INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp, notes)
        VALUES (?, ?, ?, ?, 'Abnormal', ?, datetime('now', 'localtime'), ?)
      `).run(
        device.id || null,
        device.original_sn || code,
        device.custom_sn || code,
        department_id,
        staff_id || 'UNKNOWN',
        noteMsg
      );

      return res.status(400).json({
        success: false,
        errorType: 'DEPARTMENT_MISMATCH',
        message: `❌ อุปกรณ์ [${device.custom_sn}] สังกัดตู้แผนก "${devDeptName}" ไม่สามารถทำรายการที่ตู้ "${department_id}" ได้ (เครื่องไม่ได้อยู่ในตู้นี้)`
      });
    }

    const txnDept = department_id || devDept || 'OBD A';

    // 3. Determine actual operation if AUTO
    let targetAction = action;
    if (action === 'AUTO') {
      targetAction = (device.status === 'IN_CABINET') ? 'CHECK_OUT' : 'CHECK_IN';
    }

    // Validate Action and Staff ID
    if (targetAction === 'CHECK_OUT') {
      if (!staff_id) {
        return res.status(400).json({
          success: false,
          errorType: 'MISSING_STAFF_ID',
          message: 'กรุณากรอกหรือสแกน "รหัสพนักงาน" ผู้เบิกก่อนทำรายการ'
        });
      }

      if (device.status === 'CHECKED_OUT') {
        // Auto-log return of previous holder so device can be smoothly checked out to the new staff
        const prevStaff = device.current_staff_id || 'AUTO_TRANSFER';
        db.prepare(`
          INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
          VALUES (?, ?, ?, ?, 'CHECK_IN', ?, datetime('now', 'localtime'))
        `).run(device.id, device.original_sn, device.custom_sn, txnDept, prevStaff);
      }

      // Perform Check-Out
      db.prepare(`
        UPDATE devices
        SET status = 'CHECKED_OUT',
            current_staff_id = ?,
            last_action_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(staff_id, device.id);

      db.prepare(`
        INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
        VALUES (?, ?, ?, ?, 'CHECK_OUT', ?, datetime('now', 'localtime'))
      `).run(device.id, device.original_sn, device.custom_sn, txnDept, staff_id);

      const updatedDevice = db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id);

      return res.json({
        success: true,
        action: 'CHECK_OUT',
        message: `📤 เบิกสำเร็จ! PDA [${device.custom_sn}] ถูกส่งมอบให้พนักงาน ${staff_id}`,
        device: updatedDevice,
        staff_id,
        timestamp: updatedDevice.last_action_at
      });
    } 
    
    if (targetAction === 'CHECK_IN') {
      if (device.status === 'IN_CABINET' && action === 'CHECK_IN') {
        return res.status(400).json({
          success: false,
          errorType: 'ALREADY_IN_CABINET',
          message: `ℹ️ อุปกรณ์ [${device.custom_sn}] อยู่ในตู้ชาร์จเรียบร้อยแล้ว (สถานะเขียว)`
        });
      }

      // If staff_id not provided upon return, fallback to the staff who checked it out
      const returningStaff = staff_id || device.current_staff_id || 'AUTO_RETURN';

      // Perform Check-In
      db.prepare(`
        UPDATE devices
        SET status = 'IN_CABINET',
            current_staff_id = NULL,
            last_action_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(device.id);

      db.prepare(`
        INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
        VALUES (?, ?, ?, ?, 'CHECK_IN', ?, datetime('now', 'localtime'))
      `).run(device.id, device.original_sn, device.custom_sn, txnDept, returningStaff);

      const updatedDevice = db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id);

      return res.json({
        success: true,
        action: 'CHECK_IN',
        message: `📥 คืนเข้าตู้สำเร็จ! PDA [${device.custom_sn}] เสียบชาร์จในตู้ ${txnDept} เรียบร้อย`,
        device: updatedDevice,
        staff_id: returningStaff,
        timestamp: updatedDevice.last_action_at
      });
    }

    return res.status(400).json({ success: false, message: 'การดำเนินการไม่ถูกต้อง' });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ success: false, message: `เกิดข้อผิดพลาดในการทำรายการ: ${err.message}`, error: err.message });
  }
});

// 7.1 Batch Check-in / Check-out Endpoint (ยิงเข้า/ออกเป็นชุดหลายเครื่องพร้อมกัน)
app.post('/api/scan/batch', (req, res) => {
  try {
    let { codes, staff_id, department_id, action } = req.body;
    staff_id = (staff_id || '').trim();
    department_id = (department_id || '').trim().toUpperCase();
    action = (action || 'CHECK_OUT').toUpperCase();

    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่มีรหัส PDA ที่ส่งมาทำรายการ' });
    }

    if (!department_id) {
      department_id = 'OBD A';
    }

    if (action === 'CHECK_OUT' && !staff_id) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกหรือสแกนรหัสพนักงานผู้เบิก' });
    }

    const processed = [];
    const errors = [];

    db.exec('BEGIN TRANSACTION');
    try {
      const findStmt = db.prepare(`
        SELECT dev.*, d.name as department_name 
        FROM devices dev
        LEFT JOIN departments d ON dev.department_id = d.id
        WHERE dev.original_sn = ? COLLATE NOCASE OR dev.custom_sn = ? COLLATE NOCASE
      `);

      const updateCheckoutStmt = db.prepare(`
        UPDATE devices
        SET status = 'CHECKED_OUT',
            current_staff_id = ?,
            last_action_at = datetime('now', 'localtime')
        WHERE id = ?
      `);

      const updateCheckinStmt = db.prepare(`
        UPDATE devices
        SET status = 'IN_CABINET',
            current_staff_id = NULL,
            last_action_at = datetime('now', 'localtime')
        WHERE id = ?
      `);

      const insertLogStmt = db.prepare(`
        INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      `);

      // Expand compound concatenated codes like 'ad003ad004', 'ad003 ad004'
      const expandedCodes = [];
      for (const raw of codes) {
        const str = (raw || '').toString().trim();
        if (!str) continue;
        const tokens = str.split(/[\s,;\t\r\n]+/).filter(Boolean);
        for (const t of tokens) {
          const directDev = findStmt.get(t, t);
          if (directDev) {
            expandedCodes.push(t);
            continue;
          }
          const compoundMatches = t.match(/([a-zA-Z]{1,4}[-_]?[0-9]{1,5})/gi);
          if (compoundMatches && compoundMatches.length > 1 && compoundMatches.join('').toLowerCase() === t.toLowerCase()) {
            expandedCodes.push(...compoundMatches);
          } else {
            expandedCodes.push(t);
          }
        }
      }

      for (const codeItem of expandedCodes) {
        const code = (codeItem || '').trim();
        if (!code) continue;

        const device = findStmt.get(code, code);
        if (!device) {
          errors.push({ code, message: `ไม่พบอุปกรณ์รหัส "${code}" ในระบบ` });
          continue;
        }

        // Department validation: device MUST belong to this cabinet's department!
        const devDept = device.department_id || '';
        const devDeptName = device.department_name || devDept;
        if (department_id && devDept && !isDepartmentCompatible(devDept, department_id, devDeptName)) {
          const noteMsg = `ยิงผิดตู้: เครื่องสังกัดแผนก ${devDept} (${devDeptName}) ถูกนำมายิงที่ตู้ ${department_id}`;
          insertLogStmt.run(
            device.id || null,
            device.original_sn || code,
            device.custom_sn || code,
            department_id,
            'Abnormal',
            staff_id || 'UNKNOWN'
          );
          // Update the notes for this last inserted log
          db.prepare('UPDATE logs SET notes = ? WHERE id = last_insert_rowid()').run(noteMsg);

          errors.push({
            code,
            message: `❌ อุปกรณ์ [${device.custom_sn}] สังกัดตู้แผนก "${devDeptName}" ไม่สามารถทำรายการที่ตู้ "${department_id}" ได้ (เครื่องไม่ได้อยู่ในตู้นี้)`
          });
          continue;
        }

        const itemDept = department_id || devDept || 'OBD A';

        if (action === 'CHECK_OUT') {
          if (device.status === 'CHECKED_OUT') {
            // Auto-log return of previous holder so device can be smoothly transferred to new staff
            const prevStaff = device.current_staff_id || 'AUTO_TRANSFER';
            insertLogStmt.run(device.id, device.original_sn, device.custom_sn, itemDept, 'CHECK_IN', prevStaff);
          }

          updateCheckoutStmt.run(staff_id, device.id);
          insertLogStmt.run(device.id, device.original_sn, device.custom_sn, itemDept, 'CHECK_OUT', staff_id);
          processed.push({ id: device.id, custom_sn: device.custom_sn, original_sn: device.original_sn });
        } else if (action === 'CHECK_IN') {
          if (device.status === 'IN_CABINET') {
            errors.push({
              code,
              custom_sn: device.custom_sn,
              message: `[${device.custom_sn}] อยู่ในตู้ชาร์จเรียบร้อยแล้ว`
            });
            continue;
          }

          const returningStaff = staff_id || device.current_staff_id || 'RETURN';
          updateCheckinStmt.run(device.id);
          insertLogStmt.run(device.id, device.original_sn, device.custom_sn, itemDept, 'CHECK_IN', returningStaff);
          processed.push({ id: device.id, custom_sn: device.custom_sn, original_sn: device.original_sn });
        }
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const msg = processed.length > 0
      ? (action === 'CHECK_OUT' ? `เบิกสำเร็จ ${processed.length} เครื่อง (พนักงาน: ${staff_id})` : `คืนเข้าตู้สำเร็จ ${processed.length} เครื่อง`)
      : (errors.length > 0 ? errors.map(e => e.message).join(' | ') : 'เกิดข้อผิดพลาดในการทำรายการ');

    res.status(processed.length > 0 ? 200 : 400).json({
      success: processed.length > 0,
      total: codes.length,
      processedCount: processed.length,
      failedCount: errors.length,
      processed,
      errors,
      action,
      staff_id,
      message: msg
    });
  } catch (err) {
    console.error('Batch scan error:', err);
    res.status(500).json({ success: false, message: `เกิดข้อผิดพลาดในการทำรายการ: ${err.message}`, error: err.message });
  }
});

// 7.2 Record Abnormal Log Endpoint
app.post('/api/logs/abnormal', (req, res) => {
  try {
    let { device_id, original_sn, custom_sn, department_id, staff_id, notes, code } = req.body || {};
    original_sn = (original_sn || '').toString().trim();
    custom_sn = (custom_sn || '').toString().trim();
    department_id = (department_id || 'UNKNOWN').toString().trim().toUpperCase();
    staff_id = (staff_id || 'UNKNOWN').toString().trim();
    notes = (notes || 'บันทึกรายการผิดปกติ (Abnormal)').toString().trim();

    if (!original_sn && !custom_sn) {
      original_sn = (code || 'UNKNOWN').toString().trim();
      custom_sn = (code || 'UNKNOWN').toString().trim();
    }

    const insert = db.prepare(`
      INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp, notes)
      VALUES (?, ?, ?, ?, 'Abnormal', ?, datetime('now', 'localtime'), ?)
    `);
    const result = insert.run(device_id || null, original_sn, custom_sn, department_id, staff_id, notes);

    res.json({
      success: true,
      log_id: result.lastInsertRowid,
      action: 'Abnormal',
      message: 'บันทึกประวัติ Abnormal สำเร็จ'
    });
  } catch (err) {
    console.error('Record abnormal log error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Transaction Logs with Filters & Pagination
app.get('/api/logs', (req, res) => {
  try {
    const { department, action, search, limit = 50, offset = 0 } = req.query;
    let query = `
      SELECT l.*, d.name as department_name
      FROM logs l
      LEFT JOIN departments d ON l.department_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (department && department !== 'ALL') {
      query += ' AND l.department_id = ?';
      params.push(department);
    }
    if (action && action !== 'ALL') {
      query += ' AND l.action = ?';
      params.push(action);
    }
    if (search && search.trim() !== '') {
      query += ' AND (l.original_sn LIKE ? OR l.custom_sn LIKE ? OR l.staff_id LIKE ? OR l.notes LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }

    query += ' ORDER BY l.id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const logs = db.prepare(query).all(...params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM logs l WHERE 1=1';
    const countParams = [];
    if (department && department !== 'ALL') {
      countQuery += ' AND l.department_id = ?';
      countParams.push(department);
    }
    if (action && action !== 'ALL') {
      countQuery += ' AND l.action = ?';
      countParams.push(action);
    }
    if (search && search.trim() !== '') {
      countQuery += ' AND (l.original_sn LIKE ? OR l.custom_sn LIKE ? OR l.staff_id LIKE ? OR l.notes LIKE ?)';
      const s = `%${search.trim()}%`;
      countParams.push(s, s, s, s);
    }
    const totalCount = db.prepare(countQuery).get(...countParams).total;

    res.json({ success: true, logs, total: totalCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Export Logs as CSV (with UTF-8 BOM for Thai support in Microsoft Excel)
app.get('/api/logs/export', (req, res) => {
  try {
    const { department, action, search } = req.query;
    let query = `
      SELECT l.id, l.timestamp, l.department_id, d.name as department_name, 
             l.action, l.custom_sn, l.original_sn, l.staff_id, l.notes
      FROM logs l
      LEFT JOIN departments d ON l.department_id = d.id
      WHERE 1=1
    `;
    const params = [];
    if (department && department !== 'ALL') {
      query += ' AND l.department_id = ?';
      params.push(department);
    }
    if (action && action !== 'ALL') {
      query += ' AND l.action = ?';
      params.push(action);
    }
    if (search && search.trim() !== '') {
      query += ' AND (l.original_sn LIKE ? OR l.custom_sn LIKE ? OR l.staff_id LIKE ? OR l.notes LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }
    query += ' ORDER BY l.id DESC';

    const rows = db.prepare(query).all(...params);

    // Format CSV
    const headers = ['Log ID', 'วันที่-เวลา', 'รหัสแผนก', 'ชื่อแผนก', 'การกระทำ', 'รหัสย่อ (Custom QR)', 'Original Serial Number', 'รหัสพนักงาน', 'หมายเหตุ'];
    const csvLines = [headers.join(',')];

    for (const r of rows) {
      let actionThai = r.action;
      if (r.action === 'CHECK_OUT') actionThai = 'เบิกออก';
      else if (r.action === 'CHECK_IN') actionThai = 'คืนเข้าตู้';
      else if ((r.action || '').toLowerCase() === 'abnormal') actionThai = 'Abnormal (ผิดปกติ/ยิงผิดตู้)';

      const line = [
        r.id,
        `"${r.timestamp || ''}"`,
        `"${r.department_id || ''}"`,
        `"${r.department_name || ''}"`,
        `"${actionThai}"`,
        `"${r.custom_sn || ''}"`,
        `"${r.original_sn || ''}"`,
        `"${r.staff_id || ''}"`,
        `"${r.notes || ''}"`
      ];
      csvLines.push(line.join(','));
    }

    const csvContent = '\uFEFF' + csvLines.join('\r\n'); // UTF-8 BOM
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pda_storage_logs_${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dynamic route for departments: e.g. /dept/IB -> serves dept.html
app.get('/dept/:deptId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dept.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🚀 PDA Storage System Server is running!`);
  console.log(`📍 Local URL:     http://localhost:${PORT}`);
  console.log(`🌐 Network URL:   http://<YOUR_LOCAL_IP>:${PORT}`);
  console.log(`📱 Admin Page:    http://localhost:${PORT}`);
  console.log(`📦 Dept Kiosks:   http://localhost:${PORT}/dept/IB (or MS, CBS, etc.)`);
  console.log(`=================================================`);
});
