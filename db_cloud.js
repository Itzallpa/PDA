import { createClient } from '@libsql/client';

const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://pda-storage-itzallpa.aws-ap-southeast-1.turso.io';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJleHAiOjE4NjE5Njg3OTAsImlhdCI6MTc5MzEwNzk5MCwiaWQiOiIwMWExN2Q4Zi0zMjAxLTdjODgtOWY1ZC02YmJmOTlkODM1M2YiLCJraWQiOiJJcVhfb1V6WTVadmJSOWJCQnpNZGNjREF2bTFTSWQyRTV2OWRYVGNyRFVVIiwicmlkIjoiOTI0NjNmNWQtYWRmYi00ZmJiLWJhZTktNTMxMDU5Nzg4ZWNjIn0.ww-_-dpkWssBk7DBJbsckSue_DZSkAzs4Er4Dl_XDrUuRgFPwr3g5sQYWIsQUZoVicYqANwNgVhue4v-l-EkCg';

export const isTursoConfigured = Boolean(TURSO_URL && TURSO_TOKEN);

export const turso = isTursoConfigured ? createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN
}) : null;

// Pull all latest data from Turso Cloud into local SQLite on startup
export async function syncFromTurso(localDb) {
  if (!turso) return false;
  try {
    console.log('🔄 Checking Turso Cloud database...');
    const remoteCountRes = await turso.execute('SELECT COUNT(*) as c FROM devices');
    const remoteCount = Number(remoteCountRes.rows[0]?.c || 0);

    if (remoteCount === 0) {
      console.log('ℹ️ Turso Cloud is currently empty. Keeping local data.');
      return false;
    }

    console.log(`☁️ Syncing ${remoteCount} devices from Turso Cloud to local database...`);

    // 1. Sync Departments
    const deptsRes = await turso.execute('SELECT * FROM departments');
    if (deptsRes.rows.length > 0) {
      const insertDept = localDb.prepare(`
        INSERT INTO departments (id, name, description, display_order)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          display_order = excluded.display_order
      `);
      for (const d of deptsRes.rows) {
        insertDept.run(d.id, d.name, d.description, d.display_order);
      }
    }

    // 2. Sync Devices
    const devRes = await turso.execute('SELECT * FROM devices');
    if (devRes.rows.length > 0) {
      const insertDev = localDb.prepare(`
        INSERT INTO devices (id, original_sn, custom_sn, model, department_id, status, current_staff_id, last_action_at, created_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(original_sn) DO UPDATE SET
          custom_sn = excluded.custom_sn,
          model = excluded.model,
          department_id = excluded.department_id,
          status = excluded.status,
          current_staff_id = excluded.current_staff_id,
          last_action_at = excluded.last_action_at,
          notes = excluded.notes
      `);
      for (const dev of devRes.rows) {
        insertDev.run(
          dev.id,
          dev.original_sn,
          dev.custom_sn,
          dev.model || null,
          dev.department_id,
          dev.status || 'IN_CABINET',
          dev.current_staff_id || null,
          dev.last_action_at || null,
          dev.created_at || null,
          dev.notes || null
        );
      }
    }

    // 3. Sync Settings
    try {
      const setRes = await turso.execute('SELECT * FROM settings');
      if (setRes.rows.length > 0) {
        const insertSetting = localDb.prepare(`
          INSERT INTO settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        for (const s of setRes.rows) {
          insertSetting.run(s.key, s.value);
        }
      }
    } catch (e) {}

    // 4. Sync Logs
    try {
      const logsRes = await turso.execute('SELECT * FROM logs ORDER BY id ASC');
      if (logsRes.rows.length > 0) {
        const insertLog = localDb.prepare(`
          INSERT INTO logs (id, device_id, original_sn, custom_sn, department_id, owner_department_id, action, staff_id, timestamp, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `);
        for (const l of logsRes.rows) {
          insertLog.run(
            l.id,
            l.device_id,
            l.original_sn,
            l.custom_sn,
            l.department_id,
            l.owner_department_id || null,
            l.action,
            l.staff_id,
            l.timestamp,
            l.notes || null
          );
        }
      }
    } catch (e) {}

    console.log('✅ Turso Cloud sync completed successfully!');
    return true;
  } catch (err) {
    console.warn('⚠️ Could not sync from Turso Cloud:', err.message);
    return false;
  }
}

// Background push to Turso Cloud (fire-and-forget so UI never waits)
export function pushToTurso(sql, args = []) {
  if (!turso) return;
  turso.execute({ sql, args }).catch(err => {
    console.warn('⚠️ Turso Cloud sync warning:', err.message);
  });
}

// Automatically intercept all INSERT/UPDATE/DELETE queries and mirror to Turso Cloud
export function attachTursoSync(db) {
  if (!turso) return;

  const originalPrepare = db.prepare.bind(db);
  db.prepare = function(sql) {
    const stmt = originalPrepare(sql);
    const originalRun = stmt.run.bind(stmt);
    stmt.run = function(...args) {
      const res = originalRun(...args);
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('INSERT') || trimmed.startsWith('UPDATE') || trimmed.startsWith('DELETE') || trimmed.startsWith('REPLACE')) {
        pushToTurso(sql, args);
      }
      return res;
    };
    return stmt;
  };
  console.log('⚡ Turso Cloud real-time mirror is active!');
}
