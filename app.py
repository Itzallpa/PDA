# app.py - PDA Storage Management System Server (Python / Flask)
import sys
import os
import re
import csv
import io
import json
import hashlib
import sqlite3
import urllib.parse
from datetime import datetime

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from flask import Flask, request, jsonify, send_from_directory, Response

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
DB_PATH = os.path.join(DATA_DIR, 'pda_storage.db')
CONFIG_PATH = os.path.join(DATA_DIR, 'config.json')
PORT = int(os.environ.get('PORT', 5001))

os.makedirs(DATA_DIR, exist_ok=True)

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path='')

# -----------------------------------------------------------------------------
# Database Helper
# -----------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.executescript('''
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
            action TEXT NOT NULL,
            staff_id TEXT NOT NULL,
            timestamp TEXT DEFAULT (datetime('now', 'localtime')),
            notes TEXT
        );
    ''')

    # Seed departments if empty
    cur.execute('SELECT COUNT(*) as count FROM departments')
    if cur.fetchone()['count'] == 0:
        default_depts = [
            ('IB', 'Inbound', 'รับเข้าสินค้า', 1),
            ('MS', 'Manual Sort', 'คัดแยกด้วยมือ', 2),
            ('CBS', 'Cross Belt Sort', 'คัดแยกสายพาน Cross Belt', 3),
            ('MCBS', 'Mini Cross Belt Sort', 'คัดแยกสายพาน Mini Cross Belt', 4),
            ('OBI', 'Outbound Induction', 'อินดักชั่นขาออก', 5),
            ('OBS', 'Outbound Sort', 'คัดแยกขาออก', 6),
            ('OBD', 'Outbound Dispatch', 'จ่ายสินค้าออก', 7)
        ]
        cur.executemany(
            'INSERT INTO departments (id, name, description, display_order) VALUES (?, ?, ?, ?)',
            default_depts
        )

    # Seed sample devices if empty
    cur.execute('SELECT COUNT(*) as count FROM devices')
    if cur.fetchone()['count'] == 0:
        samples = [
            ('SN001', 'ad001', 'Zebra TC26', 'IB', 'IN_CABINET', None),
            ('SN002', 'ad002', 'Zebra TC26', 'IB', 'CHECKED_OUT', 'EMP-1021'),
            ('SN003', 'ad003', 'Honeywell EDA51', 'MS', 'IN_CABINET', None),
            ('SN004', 'ad004', 'Honeywell EDA51', 'MS', 'IN_CABINET', None),
            ('SN005', 'ad005', 'Zebra TC52', 'CBS', 'IN_CABINET', None),
            ('SN006', 'ad006', 'Zebra TC52', 'CBS', 'CHECKED_OUT', 'EMP-3044'),
            ('SN007', 'ad007', 'Zebra TC26', 'MCBS', 'IN_CABINET', None),
            ('SN008', 'ad008', 'Zebra TC26', 'MCBS', 'IN_CABINET', None),
            ('SN009', 'ad009', 'Honeywell EDA51', 'OBI', 'IN_CABINET', None),
            ('SN010', 'ad010', 'Honeywell EDA51', 'OBI', 'IN_CABINET', None),
            ('SN011', 'ad011', 'Zebra TC52', 'OBS', 'IN_CABINET', None),
            ('SN012', 'ad012', 'Zebra TC52', 'OBS', 'CHECKED_OUT', 'EMP-5012'),
            ('SN013', 'ad013', 'Zebra TC26', 'OBD', 'IN_CABINET', None),
            ('SN014', 'ad014', 'Zebra TC26', 'OBD', 'IN_CABINET', None)
        ]
        for orig, cust, model, dept, status, staff in samples:
            cur.execute('''
                INSERT INTO devices (original_sn, custom_sn, model, department_id, status, current_staff_id, last_action_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            ''', (orig, cust, model, dept, status, staff))
            dev_id = cur.lastrowid
            if status == 'CHECKED_OUT' and staff:
                cur.execute('''
                    INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
                    VALUES (?, ?, ?, ?, 'CHECK_OUT', ?, datetime('now', 'localtime'))
                ''', (dev_id, orig, cust, dept, staff))

    # Ensure OBD A department exists
    cur.execute('''
        INSERT OR IGNORE INTO departments (id, name, description, display_order)
        VALUES ('OBD A', 'Outbound Dispatch Zone A', 'จ่ายสินค้าออก Zone A', 8)
    ''')

    # Seed OB devices from seed_ob_devices.json if not present
    seed_file = os.path.join(BASE_DIR, 'seed_ob_devices.json')
    if os.path.exists(seed_file):
        try:
            with open(seed_file, 'r', encoding='utf-8') as f:
                ob_data = json.load(f)
            for item in ob_data:
                orig, cust, model, dept, notes = item[0], item[1], item[2], item[3], item[4]
                cur.execute('SELECT id FROM devices WHERE original_sn = ? OR custom_sn = ?', (orig, cust))
                if not cur.fetchone():
                    cur.execute('''
                        INSERT INTO devices (original_sn, custom_sn, model, department_id, notes, status, current_staff_id, last_action_at)
                        VALUES (?, ?, ?, ?, ?, 'IN_CABINET', NULL, datetime('now', 'localtime'))
                    ''', (orig, cust, model, dept, notes))
        except Exception as e:
            print(f"Error loading seed_ob_devices.json: {e}")

    conn.commit()
    conn.close()

init_db()

# -----------------------------------------------------------------------------
# Helper Utilities
# -----------------------------------------------------------------------------
def generate_next_custom_code():
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT custom_sn FROM devices WHERE custom_sn LIKE 'ad%'")
    rows = cur.fetchall()
    db.close()

    max_num = 0
    for r in rows:
        m = re.match(r'^ad(\d+)$', r['custom_sn'], re.IGNORECASE)
        if m:
            val = int(m.group(1))
            if val > max_num:
                max_num = val
    next_num = max_num + 1
    return f"ad{str(next_num).zfill(3)}"

def extract_compound_codes(code_str):
    if not code_str:
        return []
    raw = str(code_str).strip()
    if not raw:
        return []

    # 1. First check if the raw string matches any device directly (as original_sn or custom_sn)
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute('SELECT id FROM devices WHERE original_sn = ? COLLATE NOCASE OR custom_sn = ? COLLATE NOCASE', (raw, raw))
        if cur.fetchone():
            db.close()
            return [raw]
        db.close()
    except Exception:
        pass

    # 2. Split by standard whitespace / comma / delimiter
    tokens = re.split(r'[\s,;\t\r\n]+', raw)
    result = []
    for t in tokens:
        t = t.strip()
        if not t:
            continue

        # Check if this token is directly a known device in DB
        is_known = False
        try:
            db = get_db()
            cur = db.cursor()
            cur.execute('SELECT id FROM devices WHERE original_sn = ? COLLATE NOCASE OR custom_sn = ? COLLATE NOCASE', (t, t))
            if cur.fetchone():
                is_known = True
            db.close()
        except Exception:
            pass

        if is_known:
            result.append(t)
            continue

        # 3. Only if not known, check if it is a compound of known custom codes (e.g. ad003ad004 or ob01ob02)
        matches = re.findall(r'([a-zA-Z]{1,4}[-_]?[0-9]{1,5})', t)
        if matches and len(matches) > 1 and ''.join(matches).lower() == t.lower():
            # Verify if ANY sub-match exists in DB
            has_db_match = False
            try:
                db = get_db()
                cur = db.cursor()
                for m in matches:
                    cur.execute('SELECT id FROM devices WHERE original_sn = ? COLLATE NOCASE OR custom_sn = ? COLLATE NOCASE', (m, m))
                    if cur.fetchone():
                        has_db_match = True
                        break
                db.close()
            except Exception:
                pass

            if has_db_match:
                result.extend(matches)
                continue

        result.append(t)

    return result

def normalize_dept(code):
    return re.sub(r'[\s\-_]+', '', (code or '')).upper()

def is_dept_compatible(d1, d2, dev_dept_name=""):
    if not d1 or not d2:
        return True
    n1 = normalize_dept(d1)
    n2 = normalize_dept(d2)
    if n1 == n2:
        return True
    if n1.startswith(n2) or n2.startswith(n1):
        return True
    if dev_dept_name:
        n_name = normalize_dept(dev_dept_name)
        if n_name == n2 or n_name.startswith(n2) or n2.startswith(n_name):
            return True
    return False

# -----------------------------------------------------------------------------
# Admin Authentication & Password Management
# -----------------------------------------------------------------------------
def get_admin_password():
    if os.environ.get('ADMIN_PASSWORD'):
        return os.environ.get('ADMIN_PASSWORD').strip()
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if data.get('admin_password'):
                    return str(data.get('admin_password')).strip()
        except Exception:
            pass
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
        cur.execute("SELECT value FROM settings WHERE key = 'admin_password'")
        row = cur.fetchone()
        db.close()
        if row and row['value']:
            return str(row['value']).strip()
    except Exception:
        pass
    return "admin"

def set_admin_password(new_pwd):
    pwd = str(new_pwd).strip()
    # 1. Save to config.json for easy user editing
    try:
        cfg = {}
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
        cfg['admin_password'] = pwd
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print("Error saving config.json:", e)

    # 2. Save to DB settings
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
        cur.execute("INSERT INTO settings (key, value) VALUES ('admin_password', ?) ON CONFLICT(key) DO UPDATE SET value = ?", (pwd, pwd))
        db.commit()
        db.close()
    except Exception as e:
        print("Error saving to settings table:", e)

def get_admin_token():
    pwd = get_admin_password()
    return hashlib.sha256(f"pda_admin_secret_{pwd}".encode()).hexdigest()

# -----------------------------------------------------------------------------
# Static & Page Serving
# -----------------------------------------------------------------------------
@app.route('/')
def serve_index():
    return send_from_directory(PUBLIC_DIR, 'index.html')

@app.route('/dept/<dept_id>')
def serve_dept_page(dept_id):
    return send_from_directory(PUBLIC_DIR, 'dept.html')

@app.route('/api/health')
@app.route('/api/ping')
def health_check():
    return jsonify({'status': 'ok', 'port': PORT, 'time': datetime.now().isoformat()})

# -----------------------------------------------------------------------------
# Admin Auth Endpoints
# -----------------------------------------------------------------------------
@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json(silent=True) or {}
    pwd = (data.get('password') or '').strip()
    if pwd == get_admin_password():
        return jsonify({
            'success': True,
            'message': 'เข้าสู่ระบบสำเร็จ',
            'token': get_admin_token()
        })
    return jsonify({'success': False, 'message': 'รหัสผ่าน Admin ไม่ถูกต้อง'}), 401

@app.route('/api/admin/check-auth', methods=['GET', 'POST'])
def check_admin_auth():
    token = request.headers.get('X-Admin-Token') or request.args.get('token')
    if token and token == get_admin_token():
        return jsonify({'authenticated': True})
    return jsonify({'authenticated': False}), 401

@app.route('/api/admin/change-password', methods=['POST'])
def admin_change_password():
    token = request.headers.get('X-Admin-Token') or request.args.get('token')
    if not token or token != get_admin_token():
        return jsonify({'success': False, 'message': 'ไม่มีสิทธิ์ทำรายการ (กรุณาเข้าสู่ระบบก่อน)'}), 401
    data = request.get_json(silent=True) or {}
    new_pwd = (data.get('new_password') or '').strip()
    if not new_pwd:
        return jsonify({'success': False, 'message': 'กรุณาระบุรหัสผ่านใหม่'}), 400
    set_admin_password(new_pwd)
    return jsonify({
        'success': True, 
        'message': 'เปลี่ยนรหัสผ่าน Admin สำเร็จ', 
        'token': get_admin_token()
    })

# -----------------------------------------------------------------------------
# API Endpoints
# -----------------------------------------------------------------------------
@app.route('/api/stats', methods=['GET'])
def get_stats():
    db = get_db()
    cur = db.cursor()

    cur.execute('SELECT COUNT(*) as count FROM devices')
    total_devices = cur.fetchone()['count']

    cur.execute("SELECT COUNT(*) as count FROM devices WHERE status = 'IN_CABINET'")
    in_cabinet = cur.fetchone()['count']

    cur.execute("SELECT COUNT(*) as count FROM devices WHERE status = 'CHECKED_OUT'")
    checked_out = cur.fetchone()['count']

    cur.execute('''
        SELECT 
            d.id, d.name, d.description,
            COUNT(dev.id) as total_devices,
            SUM(CASE WHEN dev.status = 'IN_CABINET' THEN 1 ELSE 0 END) as in_cabinet,
            SUM(CASE WHEN dev.status = 'CHECKED_OUT' THEN 1 ELSE 0 END) as checked_out
        FROM departments d
        LEFT JOIN devices dev ON d.id = dev.department_id
        GROUP BY d.id
        ORDER BY d.display_order ASC
    ''')
    dept_stats = [dict(r) for r in cur.fetchall()]
    db.close()

    return jsonify({
        'success': True,
        'stats': {
            'total': total_devices,
            'inCabinet': in_cabinet,
            'checkedOut': checked_out,
            'departments': dept_stats
        }
    })

@app.route('/api/departments', methods=['GET'])
def get_departments():
    db = get_db()
    cur = db.cursor()
    cur.execute('''
        SELECT 
            d.*,
            COUNT(dev.id) as total_devices,
            SUM(CASE WHEN dev.status = 'IN_CABINET' THEN 1 ELSE 0 END) as in_cabinet,
            SUM(CASE WHEN dev.status = 'CHECKED_OUT' THEN 1 ELSE 0 END) as checked_out
        FROM departments d
        LEFT JOIN devices dev ON d.id = dev.department_id
        GROUP BY d.id
        ORDER BY d.display_order ASC
    ''')
    departments = [dict(r) for r in cur.fetchall()]
    db.close()
    return jsonify({'success': True, 'departments': departments})

@app.route('/api/departments', methods=['POST'])
def create_department():
    token = request.headers.get('X-Admin-Token') or request.args.get('token')
    if not token or token != get_admin_token():
        return jsonify({'success': False, 'message': 'ต้องเป็น Admin เท่านั้นจึงจะเพิ่มแผนก/ตู้ได้'}), 401
    data = request.get_json(silent=True) or {}
    dept_id = (data.get('id') or '').strip().upper()
    name = (data.get('name') or '').strip()
    desc = (data.get('description') or '').strip()

    if not dept_id:
        return jsonify({'success': False, 'message': 'กรุณาระบุรหัสย่อตู้/แผนก (เช่น OBD, QC)'}), 400
    if not name:
        return jsonify({'success': False, 'message': 'กรุณาระบุชื่อแผนก'}), 400

    db = get_db()
    cur = db.cursor()
    cur.execute('SELECT id FROM departments WHERE id = ? COLLATE NOCASE', (dept_id,))
    if cur.fetchone():
        db.close()
        return jsonify({'success': False, 'message': f'รหัสแผนก [{dept_id}] มีอยู่ในระบบแล้ว'}), 400

    cur.execute('SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM departments')
    next_order = cur.fetchone()['next_order']

    cur.execute(
        'INSERT INTO departments (id, name, description, display_order) VALUES (?, ?, ?, ?)',
        (dept_id, name, desc, next_order)
    )
    db.commit()
    db.close()
    return jsonify({'success': True, 'message': f'เพิ่มตู้จัดเก็บแผนก [{dept_id} - {name}] สำเร็จแล้ว'})

@app.route('/api/departments/<dept_id>', methods=['DELETE'])
def delete_department(dept_id):
    token = request.headers.get('X-Admin-Token') or request.args.get('token')
    if not token or token != get_admin_token():
        return jsonify({'success': False, 'message': 'ต้องเป็น Admin เท่านั้น'}), 401
    dept_id = (dept_id or '').strip().upper()

    db = get_db()
    cur = db.cursor()
    cur.execute('SELECT COUNT(*) as count FROM devices WHERE department_id = ?', (dept_id,))
    count = cur.fetchone()['count']
    if count > 0:
        db.close()
        return jsonify({'success': False, 'message': f'ไม่สามารถลบแผนก [{dept_id}] ได้เนื่องจากมี PDA อยู่ในตู้นี้ {count} เครื่อง กรุณาย้ายหรือลบเครื่องออกก่อน'}), 400

    cur.execute('DELETE FROM departments WHERE id = ?', (dept_id,))
    db.commit()
    db.close()
    return jsonify({'success': True, 'message': f'ลบแผนก [{dept_id}] เรียบร้อยแล้ว'})

@app.route('/api/devices', methods=['GET'])
def get_devices():
    department = request.args.get('department')
    status = request.args.get('status')
    search = request.args.get('search')

    query = '''
        SELECT dev.*, d.name as department_name 
        FROM devices dev
        JOIN departments d ON dev.department_id = d.id
        WHERE 1=1
    '''
    params = []

    if department and department != 'ALL':
        import urllib.parse
        dept_clean = urllib.parse.unquote(department).strip()
        query += ''' AND (
            dev.department_id = ? COLLATE NOCASE 
            OR dev.department_id = ? COLLATE NOCASE
            OR dev.department_id LIKE ? COLLATE NOCASE
            OR d.name = ? COLLATE NOCASE
        )'''
        params.extend([department, dept_clean, f'{dept_clean}%', dept_clean])

    if status and status != 'ALL':
        query += ' AND dev.status = ?'
        params.append(status)

    if search and search.strip():
        s = f"%{search.strip()}%"
        query += ' AND (dev.original_sn LIKE ? OR dev.custom_sn LIKE ? OR dev.model LIKE ? OR dev.current_staff_id LIKE ?)'
        params.extend([s, s, s, s])

    query += ' ORDER BY dev.department_id ASC, dev.custom_sn ASC'

    db = get_db()
    cur = db.cursor()
    cur.execute(query, params)
    devices = [dict(r) for r in cur.fetchall()]
    db.close()

    return jsonify({'success': True, 'devices': devices})

@app.route('/api/devices/suggest-custom-sn', methods=['GET'])
def suggest_custom_sn():
    code = generate_next_custom_code()
    return jsonify({'success': True, 'custom_sn': code})

@app.route('/api/devices/resolve/<path:code>', methods=['GET'])
def resolve_device(code):
    raw_code = (code or '').strip()
    if not raw_code:
        return jsonify({'success': False, 'message': 'กรุณาระบุรหัสอุปกรณ์'}), 400

    db = get_db()
    cur = db.cursor()

    cur.execute('''
        SELECT dev.*, d.name as department_name, d.description as department_desc
        FROM devices dev
        LEFT JOIN departments d ON dev.department_id = d.id
        WHERE dev.original_sn = ? COLLATE NOCASE OR dev.custom_sn = ? COLLATE NOCASE
    ''', (raw_code, raw_code))
    single = cur.fetchone()

    if single:
        res_data = dict(single)
        db.close()
        return jsonify({'success': True, 'device': res_data})

    sub_codes = extract_compound_codes(raw_code)
    if len(sub_codes) > 1:
        found_devices = []
        for sc in sub_codes:
            cur.execute('''
                SELECT dev.*, d.name as department_name, d.description as department_desc
                FROM devices dev
                LEFT JOIN departments d ON dev.department_id = d.id
                WHERE dev.original_sn = ? COLLATE NOCASE OR dev.custom_sn = ? COLLATE NOCASE
            ''', (sc, sc))
            d = cur.fetchone()
            if d:
                found_devices.append(dict(d))

        if found_devices:
            db.close()
            return jsonify({
                'success': True,
                'isCompound': True,
                'device': found_devices[0],
                'devices': found_devices,
                'parsedCount': len(found_devices)
            })

    db.close()
    return jsonify({
        'success': False,
        'message': f'ไม่พบอุปกรณ์รหัส "{raw_code}" ในระบบ กรุณาตรวจสอบ Serial Number หรือติดต่อ Admin'
    }), 404

@app.route('/api/devices', methods=['POST'])
def create_device():
    data = request.get_json(silent=True) or {}
    original_sn = (data.get('original_sn') or '').strip()
    custom_sn = (data.get('custom_sn') or '').strip()
    model = (data.get('model') or '').strip()
    department_id = (data.get('department_id') or '').strip().upper()
    notes = (data.get('notes') or '').strip()

    if not original_sn:
        return jsonify({'success': False, 'message': 'กรุณาระบุ Original Serial Number'}), 400
    if not department_id:
        return jsonify({'success': False, 'message': 'กรุณาเลือกแผนก/ตู้จัดเก็บ'}), 400

    if not custom_sn:
        custom_sn = generate_next_custom_code()

    db = get_db()
    cur = db.cursor()

    cur.execute('SELECT id FROM devices WHERE original_sn = ? COLLATE NOCASE', (original_sn,))
    if cur.fetchone():
        db.close()
        return jsonify({'success': False, 'message': f'Original SN "{original_sn}" มีอยู่ในระบบแล้ว'}), 400

    cur.execute('SELECT id FROM devices WHERE custom_sn = ? COLLATE NOCASE', (custom_sn,))
    if cur.fetchone():
        db.close()
        return jsonify({'success': False, 'message': f'รหัสย่อใหม่ "{custom_sn}" มีอยู่ในระบบแล้ว'}), 400

    cur.execute('SELECT id FROM departments WHERE id = ?', (department_id,))
    if not cur.fetchone():
        db.close()
        return jsonify({'success': False, 'message': f'ไม่พบแผนก "{department_id}"'}), 400

    cur.execute('''
        INSERT INTO devices (original_sn, custom_sn, model, department_id, status, notes, last_action_at)
        VALUES (?, ?, ?, ?, 'IN_CABINET', ?, datetime('now', 'localtime'))
    ''', (original_sn, custom_sn, model or 'Standard PDA', department_id, notes))
    dev_id = cur.lastrowid
    db.commit()

    cur.execute('SELECT * FROM devices WHERE id = ?', (dev_id,))
    new_device = dict(cur.fetchone())
    db.close()

    return jsonify({'success': True, 'device': new_device, 'message': 'เพิ่มอุปกรณ์เข้าสู่ระบบสำเร็จ'})

@app.route('/api/devices/batch-import', methods=['POST'])
def batch_import():
    data = request.get_json(silent=True) or {}
    devices = data.get('devices', [])
    if not isinstance(devices, list) or len(devices) == 0:
        return jsonify({'success': False, 'message': 'ไม่มีข้อมูลอุปกรณ์ที่ส่งมา'}), 400

    db = get_db()
    cur = db.cursor()

    imported_count = 0
    errors = []

    try:
        cur.execute('BEGIN TRANSACTION')
        for idx, row in enumerate(devices):
            orig_sn = str(row.get('original_sn') or '').strip()
            cust_sn = str(row.get('custom_sn') or '').strip()
            dept_id = str(row.get('department_id') or '').strip().upper() or 'IB'
            model = str(row.get('model') or 'Standard PDA').strip()
            notes = str(row.get('notes') or '').strip()

            if not orig_sn:
                errors.append({'row': idx + 1, 'sn': '(ว่าง)', 'error': 'ไม่มี Serial Number'})
                continue

            # 1. Department resolution: Exact -> Prefix -> Auto-create department on the fly
            cur.execute('SELECT id FROM departments WHERE id = ? COLLATE NOCASE', (dept_id,))
            dept_row = cur.fetchone()
            if dept_row:
                resolved_dept_id = dept_row['id']
            else:
                # Try prefix match if existing
                cur.execute('SELECT id FROM departments WHERE id LIKE ? OR name LIKE ? COLLATE NOCASE ORDER BY display_order ASC LIMIT 1', (f'{dept_id}%', f'{dept_id}%'))
                prefix_row = cur.fetchone()
                if prefix_row:
                    resolved_dept_id = prefix_row['id']
                else:
                    # Auto-create new department immediately so the cabinet appears right away!
                    cur.execute('SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM departments')
                    next_order = cur.fetchone()['next_order']
                    cur.execute(
                        'INSERT INTO departments (id, name, description, display_order) VALUES (?, ?, ?, ?)',
                        (dept_id, dept_id, 'สร้างอัตโนมัติจากการนำเข้าไฟล์', next_order)
                    )
                    resolved_dept_id = dept_id
            dept_id = resolved_dept_id

            # 2. Check if device already exists (UPSERT: Update existing device instead of rejecting)
            cur.execute('SELECT id, custom_sn FROM devices WHERE original_sn = ? COLLATE NOCASE', (orig_sn,))
            existing_dev = cur.fetchone()
            if existing_dev:
                dev_id = existing_dev['id']
                final_cust = existing_dev['custom_sn']
                if cust_sn and cust_sn.lower() != (final_cust or '').lower():
                    cur.execute('SELECT id FROM devices WHERE custom_sn = ? COLLATE NOCASE AND id != ?', (cust_sn, dev_id))
                    if not cur.fetchone():
                        final_cust = cust_sn
                cur.execute('''
                    UPDATE devices 
                    SET department_id = ?, custom_sn = ?, model = COALESCE(NULLIF(?, ''), model), notes = COALESCE(NULLIF(?, ''), notes)
                    WHERE id = ?
                ''', (dept_id, final_cust, model, notes, dev_id))
                imported_count += 1
                continue

            # 3. New Device: Auto-resolve custom_sn
            if not cust_sn:
                cust_sn = generate_next_custom_code()
            else:
                cur.execute('SELECT id FROM devices WHERE custom_sn = ? COLLATE NOCASE', (cust_sn,))
                if cur.fetchone():
                    # If custom_sn is taken, auto-generate a fresh one so device is never rejected
                    cust_sn = generate_next_custom_code()

            cur.execute('''
                INSERT INTO devices (original_sn, custom_sn, model, department_id, status, notes, last_action_at)
                VALUES (?, ?, ?, ?, 'IN_CABINET', ?, datetime('now', 'localtime'))
            ''', (orig_sn, cust_sn, model, dept_id, notes))
            imported_count += 1

        db.commit()
    except Exception as e:
        db.rollback()
        db.close()
        return jsonify({'success': False, 'error': str(e)}), 500

    db.close()
    return jsonify({
        'success': True,
        'total': len(devices),
        'imported': imported_count,
        'failed': len(errors),
        'errors': errors
    })

@app.route('/api/devices/<int:device_id>', methods=['PUT'])
def update_device(device_id):
    data = request.get_json(silent=True) or {}
    orig_sn = (data.get('original_sn') or '').strip()
    cust_sn = (data.get('custom_sn') or '').strip()
    model = (data.get('model') or '').strip()
    dept_id = (data.get('department_id') or '').strip().upper()
    notes = (data.get('notes') or '').strip()
    status = (data.get('status') or '').strip()

    db = get_db()
    cur = db.cursor()

    cur.execute('SELECT * FROM devices WHERE id = ?', (device_id,))
    device = cur.fetchone()
    if not device:
        db.close()
        return jsonify({'success': False, 'message': 'ไม่พบอุปกรณ์'}), 404

    if orig_sn:
        cur.execute('SELECT id FROM devices WHERE original_sn = ? COLLATE NOCASE AND id != ?', (orig_sn, device_id))
        if cur.fetchone():
            db.close()
            return jsonify({'success': False, 'message': f'Original SN "{orig_sn}" ซ้ำกับเครื่องอื่น'}), 400

    if cust_sn:
        cur.execute('SELECT id FROM devices WHERE custom_sn = ? COLLATE NOCASE AND id != ?', (cust_sn, device_id))
        if cur.fetchone():
            db.close()
            return jsonify({'success': False, 'message': f'รหัสย่อ "{cust_sn}" ซ้ำกับเครื่องอื่น'}), 400

    cur.execute('''
        UPDATE devices
        SET original_sn = COALESCE(NULLIF(?, ''), original_sn),
            custom_sn = COALESCE(NULLIF(?, ''), custom_sn),
            model = COALESCE(NULLIF(?, ''), model),
            department_id = COALESCE(NULLIF(?, ''), department_id),
            notes = COALESCE(?, notes),
            status = COALESCE(NULLIF(?, ''), status)
        WHERE id = ?
    ''', (orig_sn, cust_sn, model, dept_id, notes, status, device_id))
    db.commit()

    cur.execute('SELECT * FROM devices WHERE id = ?', (device_id,))
    updated = dict(cur.fetchone())
    db.close()

    return jsonify({'success': True, 'device': updated, 'message': 'แก้ไขข้อมูลสำเร็จ'})

@app.route('/api/devices/<int:device_id>', methods=['DELETE'])
def delete_device(device_id):
    db = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM devices WHERE id = ?', (device_id,))
    device = cur.fetchone()
    if not device:
        db.close()
        return jsonify({'success': False, 'message': 'ไม่พบอุปกรณ์'}), 404

    cur.execute('DELETE FROM devices WHERE id = ?', (device_id,))
    db.commit()
    db.close()

    return jsonify({'success': True, 'message': f"ลบอุปกรณ์ {device['custom_sn']} ({device['original_sn']}) สำเร็จ"})

@app.route('/api/scan', methods=['POST'])
def scan_device():
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or '').strip()
    staff_id = (data.get('staff_id') or '').strip()
    department_id = (data.get('department_id') or '').strip().upper()
    action = (data.get('action') or 'AUTO').upper()

    if not code:
        return jsonify({'success': False, 'errorType': 'MISSING_CODE', 'message': 'กรุณากรอกหรือยิงสแกนรหัส PDA'}), 400
    if not department_id:
        department_id = 'OBD A'

    db = get_db()
    cur = db.cursor()

    cur.execute('''
        SELECT dev.*, d.name as department_name 
        FROM devices dev
        LEFT JOIN departments d ON dev.department_id = d.id
        WHERE dev.original_sn = ? COLLATE NOCASE OR dev.custom_sn = ? COLLATE NOCASE
    ''', (code, code))
    device = cur.fetchone()

    if not device:
        db.close()
        return jsonify({'success': False, 'errorType': 'DEVICE_NOT_FOUND', 'message': f'❌ ไม่พบ PDA รหัส "{code}" ในระบบฐานข้อมูล'}), 404

    device = dict(device)
    
    # Department validation: device MUST belong to this cabinet's department!
    dev_dept = device.get('department_id') or ''
    dev_dept_name = device.get('department_name') or dev_dept
    if department_id and dev_dept and not is_dept_compatible(dev_dept, department_id, dev_dept_name):
        db.close()
        return jsonify({
            'success': False,
            'errorType': 'DEPARTMENT_MISMATCH',
            'message': f'❌ อุปกรณ์ [{device["custom_sn"]}] สังกัดตู้แผนก "{dev_dept_name}" ไม่สามารถทำรายการที่ตู้ "{department_id}" ได้ (เครื่องไม่ได้อยู่ในตู้นี้)'
        }), 400

    txn_dept = department_id or dev_dept or 'OBD A'

    target_action = action
    if action == 'AUTO':
        target_action = 'CHECK_OUT' if device['status'] == 'IN_CABINET' else 'CHECK_IN'

    if target_action == 'CHECK_OUT':
        if not staff_id:
            db.close()
            return jsonify({'success': False, 'errorType': 'MISSING_STAFF_ID', 'message': 'กรุณากรอกหรือสแกนรหัสพนักงานผู้เบิกก่อนทำรายการ'}), 400

        if device['status'] == 'CHECKED_OUT':
            # Auto-log return of previous holder so device can be smoothly checked out to the new staff
            prev_staff = device.get('current_staff_id') or 'AUTO_TRANSFER'
            cur.execute('''
                INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
                VALUES (?, ?, ?, ?, 'CHECK_IN', ?, datetime('now', 'localtime'))
            ''', (device['id'], device['original_sn'], device['custom_sn'], txn_dept, prev_staff))

        cur.execute('''
            UPDATE devices
            SET status = 'CHECKED_OUT',
                current_staff_id = ?,
                last_action_at = datetime('now', 'localtime')
            WHERE id = ?
        ''', (staff_id, device['id']))
        cur.execute('''
            INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
            VALUES (?, ?, ?, ?, 'CHECK_OUT', ?, datetime('now', 'localtime'))
        ''', (device['id'], device['original_sn'], device['custom_sn'], txn_dept, staff_id))
        db.commit()

        cur.execute('SELECT * FROM devices WHERE id = ?', (device['id'],))
        updated = dict(cur.fetchone())
        db.close()

        return jsonify({
            'success': True,
            'action': 'CHECK_OUT',
            'message': f"📤 เบิกสำเร็จ! PDA [{device['custom_sn']}] ถูกส่งมอบให้พนักงาน {staff_id}",
            'device': updated,
            'staff_id': staff_id,
            'timestamp': updated.get('last_action_at')
        })

    if target_action == 'CHECK_IN':
        if device['status'] == 'IN_CABINET' and action == 'CHECK_IN':
            db.close()
            return jsonify({'success': False, 'errorType': 'ALREADY_IN_CABINET', 'message': f"ℹ️ อุปกรณ์ [{device['custom_sn']}] อยู่ในตู้ชาร์จเรียบร้อยแล้ว"}), 400

        returning_staff = staff_id or device.get('current_staff_id') or 'AUTO_RETURN'
        cur.execute('''
            UPDATE devices
            SET status = 'IN_CABINET',
                current_staff_id = NULL,
                last_action_at = datetime('now', 'localtime')
            WHERE id = ?
        ''', (device['id'],))
        cur.execute('''
            INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
            VALUES (?, ?, ?, ?, 'CHECK_IN', ?, datetime('now', 'localtime'))
        ''', (device['id'], device['original_sn'], device['custom_sn'], txn_dept, returning_staff))
        db.commit()

        cur.execute('SELECT * FROM devices WHERE id = ?', (device['id'],))
        updated = dict(cur.fetchone())
        db.close()

        return jsonify({
            'success': True,
            'action': 'CHECK_IN',
            'message': f"📥 คืนเข้าตู้สำเร็จ! PDA [{device['custom_sn']}] เสียบชาร์จในตู้ {txn_dept} เรียบร้อย",
            'device': updated,
            'staff_id': returning_staff,
            'timestamp': updated.get('last_action_at')
        })

    db.close()
    return jsonify({'success': False, 'message': 'การดำเนินการไม่ถูกต้อง'}), 400

@app.route('/api/scan/batch', methods=['POST'])
def scan_batch():
    data = request.get_json(silent=True) or {}
    codes = data.get('codes', [])
    staff_id = (data.get('staff_id') or '').strip()
    department_id = (data.get('department_id') or '').strip().upper()
    action = (data.get('action') or 'CHECK_OUT').upper()

    if not isinstance(codes, list) or len(codes) == 0:
        return jsonify({'success': False, 'message': 'ไม่มีรหัส PDA ที่ส่งมาทำรายการ'}), 400
    if not department_id:
        department_id = 'OBD A'
    if action == 'CHECK_OUT' and not staff_id:
        return jsonify({'success': False, 'message': 'กรุณากรอกหรือสแกนรหัสพนักงานผู้เบิก'}), 400

    expanded_codes = []
    for raw in codes:
        expanded_codes.extend(extract_compound_codes(str(raw)))

    db = get_db()
    cur = db.cursor()
    processed = []
    errors = []

    try:
        cur.execute('BEGIN TRANSACTION')
        for code in expanded_codes:
            code = code.strip()
            if not code:
                continue
            cur.execute('''
                SELECT dev.*, d.name as department_name
                FROM devices dev
                LEFT JOIN departments d ON dev.department_id = d.id
                WHERE dev.original_sn = ? COLLATE NOCASE OR dev.custom_sn = ? COLLATE NOCASE
            ''', (code, code))
            device = cur.fetchone()
            if not device:
                errors.append({'code': code, 'message': f'ไม่พบอุปกรณ์รหัส "{code}" ในระบบ'})
                continue

            device = dict(device)
            dev_dept = device.get('department_id') or ''
            dev_dept_name = device.get('department_name') or dev_dept

            # Department validation: device MUST belong to this cabinet's department!
            if department_id and dev_dept and not is_dept_compatible(dev_dept, department_id, dev_dept_name):
                errors.append({
                    'code': code,
                    'message': f'❌ อุปกรณ์ [{device["custom_sn"]}] สังกัดตู้แผนก "{dev_dept_name}" ไม่สามารถทำรายการที่ตู้ "{department_id}" ได้ (เครื่องไม่ได้อยู่ในตู้นี้)'
                })
                continue

            item_dept = department_id or dev_dept or 'OBD A'

            if action == 'CHECK_OUT':
                if device['status'] == 'CHECKED_OUT':
                    # Auto log return from previous holder
                    prev_staff = device.get('current_staff_id') or 'AUTO_TRANSFER'
                    cur.execute('''
                        INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
                        VALUES (?, ?, ?, ?, 'CHECK_IN', ?, datetime('now', 'localtime'))
                    ''', (device['id'], device['original_sn'], device['custom_sn'], item_dept, prev_staff))
                cur.execute('''
                    UPDATE devices
                    SET status = 'CHECKED_OUT',
                        current_staff_id = ?,
                        last_action_at = datetime('now', 'localtime')
                    WHERE id = ?
                ''', (staff_id, device['id']))
                cur.execute('''
                    INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
                    VALUES (?, ?, ?, ?, 'CHECK_OUT', ?, datetime('now', 'localtime'))
                ''', (device['id'], device['original_sn'], device['custom_sn'], item_dept, staff_id))
                processed.append({'id': device['id'], 'custom_sn': device['custom_sn'], 'original_sn': device['original_sn']})

            elif action == 'CHECK_IN':
                if device['status'] == 'IN_CABINET':
                    errors.append({
                        'code': code,
                        'custom_sn': device['custom_sn'],
                        'message': f"[{device['custom_sn']}] อยู่ในตู้ชาร์จเรียบร้อยแล้ว"
                    })
                    continue
                returning_staff = staff_id or device.get('current_staff_id') or 'RETURN'
                cur.execute('''
                    UPDATE devices
                    SET status = 'IN_CABINET',
                        current_staff_id = NULL,
                        last_action_at = datetime('now', 'localtime')
                    WHERE id = ?
                ''', (device['id'],))
                cur.execute('''
                    INSERT INTO logs (device_id, original_sn, custom_sn, department_id, action, staff_id, timestamp)
                    VALUES (?, ?, ?, ?, 'CHECK_IN', ?, datetime('now', 'localtime'))
                ''', (device['id'], device['original_sn'], device['custom_sn'], item_dept, returning_staff))
                processed.append({'id': device['id'], 'custom_sn': device['custom_sn'], 'original_sn': device['original_sn']})

        db.commit()
    except Exception as e:
        import traceback
        traceback.print_exc()
        db.rollback()
        db.close()
        return jsonify({'success': False, 'message': f'เกิดข้อผิดพลาดในการทำรายการ: {str(e)}', 'error': str(e)}), 500

    db.close()
    if len(processed) > 0:
        msg = f"เบิกสำเร็จ {len(processed)} เครื่อง (พนักงาน: {staff_id})" if action == 'CHECK_OUT' else f"คืนเข้าตู้สำเร็จ {len(processed)} เครื่อง"
    else:
        msg = " | ".join([e.get('message', '') for e in errors]) if errors else "เกิดข้อผิดพลาดในการทำรายการ"
    return jsonify({
        'success': len(processed) > 0,
        'total': len(codes),
        'processedCount': len(processed),
        'failedCount': len(errors),
        'processed': processed,
        'errors': errors,
        'action': action,
        'staff_id': staff_id,
        'message': msg
    }), 200 if len(processed) > 0 else 400

@app.route('/api/logs', methods=['GET'])
def get_logs():
    department = request.args.get('department')
    action = request.args.get('action')
    search = request.args.get('search')
    limit = int(request.args.get('limit', 50))
    offset = int(request.args.get('offset', 0))

    query = '''
        SELECT l.*, d.name as department_name
        FROM logs l
        LEFT JOIN departments d ON l.department_id = d.id
        WHERE 1=1
    '''
    params = []

    if department and department != 'ALL':
        query += ' AND l.department_id = ?'
        params.append(department)

    if action and action != 'ALL':
        query += ' AND l.action = ?'
        params.append(action)

    if search and search.strip():
        s = f"%{search.strip()}%"
        query += ' AND (l.original_sn LIKE ? OR l.custom_sn LIKE ? OR l.staff_id LIKE ?)'
        params.extend([s, s, s])

    count_query = query.replace('SELECT l.*, d.name as department_name', 'SELECT COUNT(*) as count')
    query += ' ORDER BY l.id DESC LIMIT ? OFFSET ?'

    db = get_db()
    cur = db.cursor()

    cur.execute(count_query, params)
    total = cur.fetchone()['count']

    cur.execute(query, params + [limit, offset])
    logs = [dict(r) for r in cur.fetchall()]
    db.close()

    return jsonify({
        'success': True,
        'logs': logs,
        'total': total,
        'limit': limit,
        'offset': offset
    })

@app.route('/api/logs/export', methods=['GET'])
def export_logs():
    department = request.args.get('department')
    action = request.args.get('action')
    search = request.args.get('search')

    query = '''
        SELECT l.*, d.name as department_name
        FROM logs l
        LEFT JOIN departments d ON l.department_id = d.id
        WHERE 1=1
    '''
    params = []

    if department and department != 'ALL':
        query += ' AND l.department_id = ?'
        params.append(department)

    if action and action != 'ALL':
        query += ' AND l.action = ?'
        params.append(action)

    if search and search.strip():
        s = f"%{search.strip()}%"
        query += ' AND (l.original_sn LIKE ? OR l.custom_sn LIKE ? OR l.staff_id LIKE ?)'
        params.extend([s, s, s])

    query += ' ORDER BY l.id DESC'

    db = get_db()
    cur = db.cursor()
    cur.execute(query, params)
    rows = cur.fetchall()
    db.close()

    output = io.StringIO()
    output.write('\ufeff')  # UTF-8 BOM for Excel
    writer = csv.writer(output)
    writer.writerow(['ID', 'Timestamp', 'Action', 'Custom SN', 'Original SN', 'Department ID', 'Department Name', 'Staff ID', 'Notes'])

    for r in rows:
        action_th = 'เบิกออก' if r['action'] == 'CHECK_OUT' else 'คืนเข้าตู้'
        writer.writerow([
            r['id'],
            r['timestamp'],
            action_th,
            r['custom_sn'],
            r['original_sn'],
            r['department_id'],
            r['department_name'] or r['department_id'],
            r['staff_id'],
            r['notes'] or ''
        ])

    csv_data = output.getvalue()
    filename = f"pda_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    return Response(
        csv_data,
        mimetype='text/csv; charset=utf-8',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'}
    )

# -----------------------------------------------------------------------------
# Main Runner
# -----------------------------------------------------------------------------
if __name__ == '__main__':
    print('=================================================')
    print('🚀 PDA Storage System (Python / Flask) is running!')
    print(f'📍 Local URL:     http://localhost:{PORT}')
    print(f'📱 Admin Page:    http://localhost:{PORT}')
    print(f'📦 Dept Kiosks:   http://localhost:{PORT}/dept/IB')
    print('=================================================')
    app.run(host='0.0.0.0', port=PORT, debug=False)
