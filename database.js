// database.js — SQLite via sql.js (pure JavaScript, no native build needed)
// Smart Door Security and Remote Monitoring System

const initSqlJs = require('sql.js');
const bcrypt    = require('bcryptjs');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'security.db');

// sql.js works with an in-memory Database object; we persist by writing the
// binary to disk after every write operation.

let SQL = null;   // sql.js engine
let db  = null;   // Database instance

// ── Bootstrap: load or create the DB file ────────────────────────────────────
async function initDatabase() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL-equivalent pragmas
  db.run('PRAGMA journal_mode = MEMORY;');
  db.run('PRAGMA foreign_keys = ON;');

  // ── Create tables ─────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT    NOT NULL UNIQUE,
      password   TEXT    NOT NULL,
      role       TEXT    NOT NULL DEFAULT 'user',
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS door_state (
      id              INTEGER PRIMARY KEY DEFAULT 1,
      lock_status     TEXT    NOT NULL DEFAULT 'locked',
      door_position   TEXT    NOT NULL DEFAULT 'closed',
      alarm_active    INTEGER NOT NULL DEFAULT 0,
      auto_relock_sec INTEGER NOT NULL DEFAULT 30,
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type  TEXT    NOT NULL,
      description TEXT    NOT NULL,
      actor       TEXT,
      success     INTEGER NOT NULL DEFAULT 1,
      ip_address  TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Seed users ────────────────────────────────────────────────────────────
  const adminRow = queryOne('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!adminRow) {
    const hash = bcrypt.hashSync('admin123', 12);
    run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', hash, 'admin']);
    console.log('[DB] Admin user created  →  admin / admin123');
  }

  const demoRow = queryOne('SELECT id FROM users WHERE username = ?', ['demo']);
  if (!demoRow) {
    const hash = bcrypt.hashSync('demo123', 12);
    run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['demo', hash, 'user']);
    console.log('[DB] Demo user created   →  demo / demo123');
  }

  // ── Seed door state ───────────────────────────────────────────────────────
  const stateRow = queryOne('SELECT id FROM door_state WHERE id = 1', []);
  if (!stateRow) {
    run('INSERT INTO door_state (id) VALUES (1)', []);
    console.log('[DB] Initial door state seeded.');
  }

  // ── Seed sample activity log ──────────────────────────────────────────────
  const countRow = queryOne('SELECT COUNT(*) as cnt FROM activity_log', []);
  if (!countRow || countRow.cnt === 0) {
    const entries = [
      ['login',        'User admin logged in',                         'admin',   1],
      ['unlock',       'Door unlocked by admin (authorized)',          'admin',   1],
      ['open',         'Door opened (simulated)',                      'admin',   1],
      ['close',        'Door closed (simulated)',                      'admin',   1],
      ['lock',         'Door locked automatically after timeout',      'system',  1],
      ['unauthorized', 'Unauthorized access attempt detected',         'unknown', 0],
      ['alarm',        'Security alarm triggered',                     'system',  1],
      ['unlock',       'Door unlocked by demo (authorized)',           'demo',    1],
      ['lock',         'Door locked by demo',                         'demo',    1],
      ['login',        'User demo logged in',                         'demo',    1],
    ];
    for (const [type, desc, actor, success] of entries) {
      run(
        'INSERT INTO activity_log (event_type, description, actor, success) VALUES (?, ?, ?, ?)',
        [type, desc, actor, success]
      );
    }
    console.log('[DB] Sample activity log seeded.');
  }

  persist();
  console.log('[DB] Database initialized successfully.');
}

// ── sql.js helper: run a write statement ─────────────────────────────────────
function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

// ── sql.js helper: return all rows as plain objects ───────────────────────────
function queryAll(sql, params = []) {
  const stmt    = db.prepare(sql);
  const rows    = [];
  stmt.bind(params);
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// ── sql.js helper: return first row or null ───────────────────────────────────
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// ── Persist in-memory DB to disk ─────────────────────────────────────────────
function persist() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[DB] Persist error:', err.message);
  }
}

// ── Door state helpers ────────────────────────────────────────────────────────
function getDoorState() {
  return queryOne('SELECT * FROM door_state WHERE id = 1', []);
}

function updateDoorState(fields) {
  const allowed = ['lock_status', 'door_position', 'alarm_active', 'auto_relock_sec'];
  const setClauses = [];
  const values     = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (setClauses.length === 0) return;
  setClauses.push(`updated_at = datetime('now')`);
  values.push(1);
  run(`UPDATE door_state SET ${setClauses.join(', ')} WHERE id = ?`, values);
}

// ── Activity log helpers ──────────────────────────────────────────────────────
function logActivity({ event_type, description, actor = 'system', success = 1, ip_address = null }) {
  run(
    'INSERT INTO activity_log (event_type, description, actor, success, ip_address) VALUES (?, ?, ?, ?, ?)',
    [event_type, description, actor, success ? 1 : 0, ip_address]
  );
}

function getActivityLog({ limit = 50, offset = 0, event_type = null, success = null } = {}) {
  let sql    = 'SELECT * FROM activity_log';
  const cond = [];
  const params = [];

  if (event_type) { cond.push('event_type = ?'); params.push(event_type); }
  if (success !== null && success !== undefined && success !== '') {
    cond.push('success = ?');
    params.push(Number(success));
  }
  if (cond.length > 0) sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  return queryAll(sql, params);
}

function getActivityStats() {
  const total   = (queryOne('SELECT COUNT(*) as count FROM activity_log', []) || {}).count || 0;
  const success = (queryOne('SELECT COUNT(*) as count FROM activity_log WHERE success = 1', []) || {}).count || 0;
  const failed  = (queryOne('SELECT COUNT(*) as count FROM activity_log WHERE success = 0', []) || {}).count || 0;
  const alarms  = (queryOne("SELECT COUNT(*) as count FROM activity_log WHERE event_type = 'alarm'", []) || {}).count || 0;

  const daily = queryAll(`
    SELECT date(created_at) as day,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
    FROM activity_log
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY day
    ORDER BY day ASC
  `, []);

  return { total, success, failed, alarms, daily };
}

// ── User helpers ──────────────────────────────────────────────────────────────
function getUserByUsername(username) {
  return queryOne('SELECT * FROM users WHERE username = ?', [username]);
}

module.exports = {
  initDatabase,
  getDoorState,
  updateDoorState,
  logActivity,
  getActivityLog,
  getActivityStats,
  getUserByUsername,
};
