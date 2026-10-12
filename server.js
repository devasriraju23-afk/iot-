// server.js - Express REST API backend
// Smart Door Security and Remote Monitoring System

require('dotenv').config();

const express        = require('express');
const session        = require('express-session');
const helmet         = require('helmet');
const cors           = require('cors');
const rateLimit      = require('express-rate-limit');
const bcrypt         = require('bcryptjs');
const path           = require('path');

const {
  initDatabase,
  getDoorState,
  updateDoorState,
  logActivity,
  getActivityLog,
  getActivityStats,
  getUserByUsername,
} = require('./database');

// ── App setup ─────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc:     ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session middleware ────────────────────────────────────────────────────────
// Using default MemoryStore — fine for development / college demo.
// For production scale, swap in a persistent store (e.g. connect-pg-simple).
app.use(session({
  secret: process.env.SESSION_SECRET || 'smart-door-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiters ─────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Too many requests. Please slow down.' },
});

app.use('/api/', apiLimiter);

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required. Please log in.' });
}

// ── Auto-relock timer (in-memory) ─────────────────────────────────────────────
let relockTimer = null;

function scheduleAutoRelock(seconds, actor) {
  if (relockTimer) {
    clearTimeout(relockTimer);
    relockTimer = null;
  }
  relockTimer = setTimeout(() => {
    const state = getDoorState();
    if (state.lock_status === 'unlocked') {
      updateDoorState({ lock_status: 'locked', door_position: 'closed' });
      logActivity({
        event_type:  'lock',
        description: `Door automatically relocked after ${seconds}s timeout`,
        actor:       'system',
        success:     1,
      });
      console.log(`[AUTO-RELOCK] Door relocked after ${seconds}s.`);
    }
    relockTimer = null;
  }, seconds * 1000);
}

// ── Helper: get client IP ─────────────────────────────────────────────────────
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

// ════════════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const ip = getClientIp(req);

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (typeof username !== 'string' || username.length > 50) {
    return res.status(400).json({ error: 'Invalid username format.' });
  }

  const user = getUserByUsername(username.trim().toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password)) {
    logActivity({
      event_type:  'login',
      description: `Failed login attempt for username: ${username}`,
      actor:       username,
      success:     0,
      ip_address:  ip,
    });
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  // Regenerate session to prevent fixation
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });

    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.role     = user.role;

    logActivity({
      event_type:  'login',
      description: `User "${user.username}" logged in successfully`,
      actor:       user.username,
      success:     1,
      ip_address:  ip,
    });

    res.json({
      message:  'Login successful.',
      username: user.username,
      role:     user.role,
    });
  });
});

// POST /api/auth/logout
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const username = req.session.username;
  const ip       = getClientIp(req);

  logActivity({
    event_type:  'logout',
    description: `User "${username}" logged out`,
    actor:       username,
    success:     1,
    ip_address:  ip,
  });

  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully.' });
  });
});

// GET /api/auth/me  – check current session
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({
      loggedIn: true,
      username: req.session.username,
      role:     req.session.role,
    });
  }
  res.json({ loggedIn: false });
});

// ════════════════════════════════════════════════════════════════════════════════
//  DOOR ROUTES
// ════════════════════════════════════════════════════════════════════════════════

// GET /api/door/status  – current door state
app.get('/api/door/status', requireAuth, (req, res) => {
  const state = getDoorState();
  res.json({
    lock_status:    state.lock_status,
    door_position:  state.door_position,
    alarm_active:   Boolean(state.alarm_active),
    auto_relock_sec: state.auto_relock_sec,
    updated_at:     state.updated_at,
    simulation_mode: true,
  });
});

// POST /api/door/unlock  – authorized unlock
app.post('/api/door/unlock', requireAuth, (req, res) => {
  const username = req.session.username;
  const ip       = getClientIp(req);
  const state    = getDoorState();

  if (state.lock_status === 'unlocked') {
    return res.json({ message: 'Door is already unlocked.', state: getDoorState() });
  }

  updateDoorState({ lock_status: 'unlocked', alarm_active: 0 });

  logActivity({
    event_type:  'unlock',
    description: `Door unlocked by "${username}" (authorized access)`,
    actor:       username,
    success:     1,
    ip_address:  ip,
  });

  // Schedule auto-relock
  const updatedState = getDoorState();
  scheduleAutoRelock(updatedState.auto_relock_sec, username);

  res.json({
    message: `Door unlocked. Will auto-relock in ${updatedState.auto_relock_sec} seconds.`,
    state:   updatedState,
  });
});

// POST /api/door/lock  – manual lock
app.post('/api/door/lock', requireAuth, (req, res) => {
  const username = req.session.username;
  const ip       = getClientIp(req);
  const state    = getDoorState();

  if (state.lock_status === 'locked') {
    return res.json({ message: 'Door is already locked.', state });
  }

  if (relockTimer) { clearTimeout(relockTimer); relockTimer = null; }

  updateDoorState({ lock_status: 'locked' });

  logActivity({
    event_type:  'lock',
    description: `Door locked manually by "${username}"`,
    actor:       username,
    success:     1,
    ip_address:  ip,
  });

  res.json({ message: 'Door locked successfully.', state: getDoorState() });
});

// POST /api/door/open  – simulate opening the door
app.post('/api/door/open', requireAuth, (req, res) => {
  const username = req.session.username;
  const ip       = getClientIp(req);
  const state    = getDoorState();

  if (state.lock_status === 'locked') {
    return res.status(400).json({ error: 'Cannot open a locked door. Unlock it first.' });
  }
  if (state.door_position === 'open') {
    return res.json({ message: 'Door is already open.', state });
  }

  updateDoorState({ door_position: 'open' });

  logActivity({
    event_type:  'open',
    description: `Door physically opened by "${username}" (simulated)`,
    actor:       username,
    success:     1,
    ip_address:  ip,
  });

  res.json({ message: 'Door opened (simulated).', state: getDoorState() });
});

// POST /api/door/close  – simulate closing the door
app.post('/api/door/close', requireAuth, (req, res) => {
  const username = req.session.username;
  const ip       = getClientIp(req);
  const state    = getDoorState();

  if (state.door_position === 'closed') {
    return res.json({ message: 'Door is already closed.', state });
  }

  updateDoorState({ door_position: 'closed' });

  logActivity({
    event_type:  'close',
    description: `Door physically closed by "${username}" (simulated)`,
    actor:       username,
    success:     1,
    ip_address:  ip,
  });

  res.json({ message: 'Door closed (simulated).', state: getDoorState() });
});

// POST /api/door/unauthorized  – simulate an unauthorized access attempt
app.post('/api/door/unauthorized', requireAuth, (req, res) => {
  const username = req.session.username;
  const ip       = getClientIp(req);

  // Trigger alarm
  updateDoorState({ alarm_active: 1 });

  logActivity({
    event_type:  'unauthorized',
    description: 'Unauthorized access attempt detected (simulated intrusion)',
    actor:       'unknown',
    success:     0,
    ip_address:  ip,
  });

  logActivity({
    event_type:  'alarm',
    description: 'Security alarm triggered due to unauthorized access attempt',
    actor:       'system',
    success:     1,
    ip_address:  ip,
  });

  // Auto-dismiss alarm after 30 seconds
  setTimeout(() => {
    const current = getDoorState();
    if (current.alarm_active) {
      updateDoorState({ alarm_active: 0 });
      logActivity({
        event_type:  'alarm',
        description: 'Security alarm auto-dismissed after 30 seconds',
        actor:       'system',
        success:     1,
      });
    }
  }, 30 * 1000);

  res.json({
    message: 'Unauthorized access simulated. Alarm triggered!',
    alarm:   true,
    state:   getDoorState(),
  });
});

// POST /api/door/dismiss-alarm  – manually dismiss the alarm
app.post('/api/door/dismiss-alarm', requireAuth, (req, res) => {
  const username = req.session.username;
  const ip       = getClientIp(req);

  updateDoorState({ alarm_active: 0 });

  logActivity({
    event_type:  'alarm',
    description: `Security alarm dismissed by "${username}"`,
    actor:       username,
    success:     1,
    ip_address:  ip,
  });

  res.json({ message: 'Alarm dismissed.', state: getDoorState() });
});

// POST /api/door/settings  – update auto-relock timer
app.post('/api/door/settings', requireAuth, (req, res) => {
  const { auto_relock_sec } = req.body;
  const seconds = parseInt(auto_relock_sec, 10);

  if (isNaN(seconds) || seconds < 5 || seconds > 300) {
    return res.status(400).json({ error: 'auto_relock_sec must be between 5 and 300 seconds.' });
  }

  updateDoorState({ auto_relock_sec: seconds });

  logActivity({
    event_type:  'settings',
    description: `Auto-relock timer changed to ${seconds}s by "${req.session.username}"`,
    actor:       req.session.username,
    success:     1,
  });

  res.json({ message: `Auto-relock timer set to ${seconds} seconds.`, auto_relock_sec: seconds });
});

// ════════════════════════════════════════════════════════════════════════════════
//  ACTIVITY & STATS ROUTES
// ════════════════════════════════════════════════════════════════════════════════

// GET /api/activity  – paginated + filtered log
app.get('/api/activity', requireAuth, (req, res) => {
  const { limit = 20, offset = 0, event_type, success } = req.query;
  const logs = getActivityLog({ limit, offset, event_type, success });
  res.json({ logs });
});

// GET /api/stats  – summary counts and chart data
app.get('/api/stats', requireAuth, (req, res) => {
  const stats = getActivityStats();
  res.json(stats);
});

// ════════════════════════════════════════════════════════════════════════════════
//  DEVICE STATUS ROUTE (simulated)
// ════════════════════════════════════════════════════════════════════════════════

// GET /api/device/status  – simulated device health
app.get('/api/device/status', requireAuth, (req, res) => {
  res.json({
    simulation_mode:  true,
    device_name:      'Smart Door Controller v1.0 (Simulated)',
    firmware_version: '2.4.1-sim',
    connectivity:     'online',
    signal_strength:  Math.floor(Math.random() * 20) + 75, // 75-95 %
    battery_level:    Math.floor(Math.random() * 10) + 88, // 88-98 %
    temperature_c:    (Math.random() * 4 + 23).toFixed(1), // 23-27 °C
    uptime_hours:     Math.floor(Math.random() * 100) + 48,
    last_ping:        new Date().toISOString(),
  });
});

// ════════════════════════════════════════════════════════════════════════════════
//  FALLBACK ROUTES
// ════════════════════════════════════════════════════════════════════════════════

// Serve dashboard for all non-API routes (SPA-style)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server (after async DB init) ───────────────────────────────────────
async function startServer() {
  try {
    await initDatabase();   // sql.js requires async initialization
    app.listen(PORT, () => {
      console.log(`\n╔══════════════════════════════════════════════════════════╗`);
      console.log(`║  Smart Door Security System                              ║`);
      console.log(`║  Running at  →  http://localhost:${PORT}                   ║`);
      console.log(`║  Mode        →  SOFTWARE SIMULATION (No hardware needed) ║`);
      console.log(`║  Default credentials:                                    ║`);
      console.log(`║    admin / admin123   (admin role)                       ║`);
      console.log(`║    demo  / demo123    (user role)                        ║`);
      console.log(`╚══════════════════════════════════════════════════════════╝\n`);
    });
  } catch (err) {
    console.error('[FATAL] Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
module.exports = app;
