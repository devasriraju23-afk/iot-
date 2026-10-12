# 🔐 Smart Door Security and Remote Monitoring System

> **College Project — 100% Software Simulation**
> No physical hardware required. All door operations, sensor readings, and alarms are simulated in software.

---

## 📌 Project Overview

This is a full-stack web application that simulates a smart door security system. It demonstrates IoT concepts — remote access control, real-time monitoring, security alerting, and activity logging — entirely through software, without any microcontroller, sensors, or actuators.

| Item | Detail |
|---|---|
| **Type** | College Project — Software Simulation |
| **Stack** | Node.js · Express · SQLite · Vanilla JS · Chart.js |
| **Auth** | Session-based with bcrypt password hashing |
| **Mode** | 100% simulated — no ESP32, Arduino, or sensors needed |

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 Login / Logout | Secure login with bcrypt + session management |
| 🚪 Door Simulation | Lock, Unlock, Open, Close — all simulated in software |
| ⏱ Auto-Relock | Door automatically re-locks after a configurable timeout |
| 🚨 Intrusion Simulation | Simulate unauthorized access; triggers alarm |
| 🔔 Security Alerts | Live alarm indicator and alert panel |
| 📋 Activity Log | Full filterable, paginated history of all events |
| 📊 Analytics | Doughnut, bar, and line charts via Chart.js |
| 📡 Device Status | Simulated device health metrics (signal, battery, temp) |
| ⚙️ Settings | Configure auto-relock timer from the dashboard |
| 📱 Responsive | Works on phone, tablet, and desktop |
| 🛡 Security | Helmet, rate limiting, input validation, XSS protection |

---

## 🗂 Project Structure

```
smart-door-security/
├── public/
│   ├── index.html      ← Main dashboard (SPA)
│   ├── login.html      ← Login page
│   ├── style.css       ← Dark navy theme + responsive CSS
│   └── script.js       ← Frontend logic + Chart.js
├── server.js           ← Express REST API + session auth
├── database.js         ← SQLite setup, helpers, seed data
├── package.json
├── .env.example        ← Template for environment variables
├── .gitignore
└── README.md
```

---

## 🚀 Quick Start

### 1. Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm (comes with Node.js)

### 2. Clone / Download

```bash
git clone https://github.com/your-username/smart-door-security.git
cd smart-door-security
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set a strong `SESSION_SECRET`. The defaults work for local development.

### 5. Start the Server

```bash
npm start
```

Or with auto-restart during development:

```bash
npm run dev
```

### 6. Open in Browser

```
http://localhost:3000
```

---

## 🔑 Default Credentials

| Username | Password | Role  |
|----------|----------|-------|
| `admin`  | `admin123` | Admin |
| `demo`   | `demo123`  | User  |

> Change these immediately for any deployment beyond local development.

---

## 📡 API Reference

All endpoints require authentication (cookie session) except `/api/auth/login`.

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Login with username + password |
| `POST` | `/api/auth/logout` | Logout and destroy session |
| `GET`  | `/api/auth/me` | Check current session |

### Door Control (Simulated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/door/status` | Get current door state |
| `POST` | `/api/door/unlock` | Unlock the simulated door |
| `POST` | `/api/door/lock` | Lock the simulated door |
| `POST` | `/api/door/open` | Open the simulated door |
| `POST` | `/api/door/close` | Close the simulated door |
| `POST` | `/api/door/unauthorized` | Simulate unauthorized attempt + trigger alarm |
| `POST` | `/api/door/dismiss-alarm` | Dismiss the active alarm |
| `POST` | `/api/door/settings` | Update `auto_relock_sec` (5–300) |

### Activity & Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/activity` | Paginated log. Query: `limit`, `offset`, `event_type`, `success` |
| `GET`  | `/api/stats` | Summary counts + last-7-day daily breakdown |
| `GET`  | `/api/device/status` | Simulated device health metrics |

---

## 🗄 Database Schema

### `users`
```sql
id, username, password (bcrypt), role ('admin'|'user'), created_at
```

### `door_state`  (single row, id = 1)
```sql
id, lock_status ('locked'|'unlocked'), door_position ('open'|'closed'),
alarm_active (0|1), auto_relock_sec, updated_at
```

### `activity_log`
```sql
id, event_type, description, actor, success (0|1), ip_address, created_at
```

---

## 🏗 Architecture (for Presentation)

```
Browser (HTML + CSS + JS)
        │  fetch() with session cookie
        ▼
Express Server (server.js)
  ├── Helmet  (security headers)
  ├── express-rate-limit  (brute-force protection)
  ├── express-session + SQLiteStore  (session management)
  └── REST API Routes
        │  helper functions
        ▼
  database.js  (better-sqlite3)
        │
        ▼
  security.db  (SQLite file)
  ├── users
  ├── door_state
  └── activity_log
```

**Request flow example — Unlock door:**
1. User clicks "Unlock" on dashboard
2. `script.js` sends `POST /api/door/unlock` with session cookie
3. `server.js` middleware verifies session → allows request
4. `database.js` updates `door_state.lock_status = 'unlocked'`
5. `database.js` inserts row into `activity_log`
6. Server schedules auto-relock timer (in-memory setTimeout)
7. API returns updated state JSON
8. `script.js` updates the door visualization, pills, and stats

---

## 🧪 Testing the Application

### Functional Test Checklist

1. **Login** — Visit `http://localhost:3000`, enter `admin` / `admin123`
2. **Dashboard** — Confirm stat cards and door visualization load
3. **Unlock** — Click "Unlock Door" → door should show green Unlocked state
4. **Auto-Relock** — Watch the countdown timer; door locks after timeout
5. **Open/Close** — Click "Open Door" (only works when unlocked)
6. **Breach Simulation** — Click "Simulate Breach" → alarm overlay appears
7. **Dismiss Alarm** — Click "Dismiss Alarm" → alert clears
8. **Activity Log** — Click "Activity Log" in sidebar → full history visible
9. **Filters** — Filter by event type or success/failed
10. **Analytics** — Click "Analytics" → three charts render
11. **Device Status** — Click "Device Status" → simulated metrics show
12. **Settings** — Change auto-relock timer, click Save
13. **Mobile** — Resize browser to 375px → sidebar collapses, layout stacks
14. **Logout** — Click logout → redirected to login page

---

## ☁️ Deployment

### Render (Backend + Frontend)

1. Push code to a GitHub repository
2. Create a new **Web Service** on [Render](https://render.com)
3. Set **Build Command**: `npm install`
4. Set **Start Command**: `npm start`
5. Add environment variables:
   - `NODE_ENV=production`
   - `SESSION_SECRET=<strong-random-string>`
   - `PORT=3000`
6. SQLite DB persists on Render's disk at the path set in `DB_PATH`

### Vercel (Static Frontend Only)

If deploying frontend separately, set `CORS_ORIGIN` on the backend to the Vercel URL and update `fetch()` base URL in `script.js`.

### Environment Variables (Production Checklist)

- [ ] `SESSION_SECRET` — long random string (48+ bytes)
- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN` — your frontend domain
- [ ] `DB_PATH` — persistent disk path

---

## 🔒 Security Features

| Feature | Implementation |
|---|---|
| Password hashing | bcrypt with cost factor 12 |
| Session security | httpOnly cookies, sameSite lax, 8h expiry |
| Brute-force protection | 10 login attempts per 15 minutes per IP |
| API rate limiting | 60 requests per minute per IP |
| Security headers | Helmet.js (CSP, HSTS, X-Frame-Options, etc.) |
| Input validation | Server-side validation on all endpoints |
| XSS prevention | HTML escaping in frontend + Content Security Policy |
| Session fixation | Session regenerated on login |

---

## ⚠️ Simulation Disclaimer

This project is a **software simulation** created for educational purposes.

- All door states (locked/unlocked/open/closed) are database values only
- All sensor readings (signal strength, battery, temperature) are random numbers
- All alarms are visual/UI indicators — no physical buzzer exists
- No network packets are sent to any real IoT device
- This system does **not** control or detect any real physical door

---

## 📄 License

MIT License — Free to use for educational purposes.
