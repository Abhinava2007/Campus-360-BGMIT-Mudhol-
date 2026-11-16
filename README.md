# Campus 360 — BGMIT Mudhol

A smart, lightweight campus room search and three-language voice navigation web application built for **BGMIT Mudhol**. Students can search for departments, classrooms, laboratories, offices, and campus facilities to get exact floor details, step-by-step walking directions, and natural voice guidance in **Kannada**, **English**, and **Hindi**, all managed dynamically through a secure Admin Panel.

---

## Features

### Student Navigation
- **Minimal Search Interface**: Fast, instant live search across room names, room numbers, department names/codes, floor names, categories, and descriptions.
- **Database-Driven Suggestions**: Quick-access location suggestions loaded directly from active database records.
- **Exact Direction Details**: Displays destination name, room number, department, exact floor, starting location, and numbered walking steps.
- **Missing Route Safeguard**: Locations without active route steps clearly display `"Directions are not available for this location yet."` without fabricating routes or distances.
- **Three-Language Voice Navigation (`SpeechSynthesis` API)**:
  - **Kannada (`kn-IN`)** — ಕನ್ನಡ
  - **English (`en-IN`)**
  - **Hindi (`hi-IN`)** — हिन्दी
  - Strict voice matching per language without silently substituting another language; warns the user if a browser/device voice is unavailable while preserving written instructions.
  - Playback controls: **Start Navigation**, **Pause Voice**, **Resume Voice**, **Stop Navigation**, and **Repeat Instruction**, plus mid-navigation language switching.

### Secure Admin Panel (`/admin`)
- **Authentication**: Email and password authentication backed by `scrypt` password hashing and HMAC-SHA256 Bearer session tokens. On first boot (if `ADMIN_EMAIL`/`ADMIN_PASSWORD` are not configured), `/admin` provides a one-time setup flow for the initial administrator account.
- **Dashboard Summary**: Live counts for Total Rooms (and active count), Total Departments, Total Floors, and Total Configured Routes.
- **Room Management**: Add, edit, delete (with confirmation), search, and activate/deactivate rooms; assign department, floor, and category.
- **Floor & Department Management**: Add, edit, and delete floors (Ground, First, Second, etc.) and departments with referential protection.
- **Directions & Languages Editor**: Configure route starting locations, step types, sequence ordering, and multilingual step text.
- **Voice Direction Management**:
  - **Voice Control Settings**: Enable/disable voice navigation globally, set default language, and tune voice speed (`0.50x`–`1.50x`) and pitch (`0.50`–`1.50`).
  - **Independent Language Editing**: Edit Kannada, English, and Hindi instruction text independently without overwriting other languages.
  - **Inline Voice Preview**: **Test Voice** and **Stop Voice** controls beside each language input and instruction row.
  - **Route-Wise & Itemized Control**: Filter by destination, language availability, or active status; enable/disable individual steps; reorder steps; and delete instructions with confirmation.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite, Lucide React
- **Backend**: Node.js, Express, `tsx`
- **Database**: SQLite (`better-sqlite3`) stored in `data/campus360.db`
- **Voice**: Browser Web Speech API (`window.speechSynthesis`)

---

## Project Structure

```text
├── index.html                  # HTML entry point & Google Fonts
├── metadata.json               # Application metadata
├── package.json                # Dependencies & npm scripts
├── server.ts                   # Express API server & Vite middleware
├── server/
│   ├── auth.ts                 # Password hashing (scrypt) & HMAC session tokens
│   └── db.ts                   # SQLite schema, migrations, seeding & queries
└── src/
    ├── App.tsx                 # Root app state, routing & voice settings sync
    ├── index.css               # Tailwind CSS v4 theme configuration
    ├── types.ts                # Shared TypeScript interfaces
    ├── lib/
    │   └── voice.ts            # SpeechSynthesis voice matching & preview helpers
    └── components/
        ├── AdminLogin.tsx      # Admin sign-in & one-time initial setup form
        ├── AdminPanel.tsx      # Admin dashboard, rooms, floors, departments & routes
        ├── ConfirmModal.tsx    # Accessible confirmation dialog for deletions
        ├── DirectionPanel.tsx  # Student route view & 3-language voice controls
        ├── Header.tsx          # Minimal campus header, language switcher & Admin link
        ├── StudentHome.tsx     # Instant search, suggestions & results list
        └── VoiceDirectionManager.tsx # Voice instruction & control settings manager
```

---

## Database Schema

SQLite tables initialized automatically in `server/db.ts`:
- `admins` — Administrator accounts (`email`, `password_hash`, `name`)
- `departments` — Academic departments & central units (`name`, `code`, `description`)
- `floors` — Campus floors (`floor_number`, `name`, `description`)
- `rooms` — Classrooms, labs, offices, libraries, and facilities linked to `departments` and `floors`
- `navigation_routes` — Route header per room (`room_id`, `starting_location`, `is_active`)
- `route_steps` — Ordered multilingual instructions (`step_order`, `action_type`, `instruction_kn`, `instruction_en`, `instruction_hi`, `is_active`, `created_at`, `updated_at`)
- `voice_settings` — Global student voice settings (`voice_enabled`, `default_language`, `voice_speed`, `voice_pitch`)

---

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` if you want to pre-configure the initial admin credentials or session secret:

```env
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
SESSION_SECRET=""
```

- If `ADMIN_EMAIL` and `ADMIN_PASSWORD` are omitted on first boot, navigate to `/admin` in the browser to create the initial administrator account once.
- If `SESSION_SECRET` is omitted, a random cryptographic secret is generated and stored locally in `data/.session_secret`.

### 3. Run in Development

```bash
npm run dev
```

The Express + Vite server runs on `http://localhost:3000`.

### 4. Build & Run in Production

```bash
npm run build
npm start
```

### 5. Typecheck / Lint

```bash
npm run lint
```

---

## API Endpoints

### Public Student Endpoints
- `GET /api/health` — Server health check
- `GET /api/rooms?q=...` — Search active rooms, departments, floors, and facilities
- `GET /api/rooms/:id` — Get room details and active multilingual route steps
- `GET /api/floors` — List campus floors
- `GET /api/departments` — List campus departments
- `GET /api/voice-settings` — Get global voice playback settings

### Protected Admin Endpoints (`Authorization: Bearer <token>`)
- `GET /api/admin/status` — Check whether an administrator account exists
- `POST /api/admin/setup` — One-time creation of the initial administrator account
- `POST /api/admin/login` — Authenticate with email and password
- `GET /api/admin/me` — Verify current admin session
- `GET /api/admin/dashboard` — Dashboard statistics
- `GET / POST /api/admin/rooms`, `PUT / DELETE /api/admin/rooms/:id` — Room CRUD
- `POST /api/admin/floors`, `PUT / DELETE /api/admin/floors/:id` — Floor CRUD
- `POST /api/admin/departments`, `PUT / DELETE /api/admin/departments/:id` — Department CRUD
- `PUT / DELETE /api/admin/routes/:roomId` — Route & batch steps management
- `GET / PUT /api/admin/voice-settings` — Voice control settings
- `GET / POST /api/admin/voice-instructions`, `PUT /api/admin/voice-instructions/reorder`, `PUT / DELETE /api/admin/voice-instructions/:id` — Individual voice instruction management
