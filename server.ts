import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  createSessionToken,
  hashPassword,
  verifyPassword,
  verifySessionToken,
} from './server/auth.ts';
import {
  db,
  ensureRouteForRoom,
  getAdminStats,
  getRoomWithDirections,
  getVoiceInstructionById,
  getVoiceSettings,
  initDatabase,
  listDepartments,
  listFloors,
  listRooms,
  listVoiceInstructions,
  resequenceRouteSteps,
  updateVoiceSettings,
} from './server/db.ts';
import type { AdminUser, LanguageCode, RoomCategory, RouteStep } from './src/types.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '1mb' }));

interface AuthenticatedRequest extends Request {
  admin?: AdminUser;
}

const VALID_CATEGORIES: RoomCategory[] = [
  'Department',
  'Classroom',
  'Laboratory',
  'Library',
  'HOD Room',
  'Staff Room',
  'Facility',
];

const VALID_STEP_TYPES = new Set([
  'start',
  'straight',
  'left',
  'right',
  'stairs',
  'floor_change',
  'destination',
  'custom',
]);

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const token = authHeader.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }

  const adminRow = db
    .prepare('SELECT id, email, name FROM admins WHERE id = ? AND email = ?')
    .get(payload.sub, payload.email) as AdminUser | undefined;

  if (!adminRow) {
    res.status(401).json({ error: 'Administrator account not found.' });
    return;
  }

  req.admin = adminRow;
  next();
}

// ---------- PUBLIC STUDENT NAVIGATION API ----------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/rooms', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const rooms = listRooms({ includeInactive: false, query: q });
  res.json({ rooms });
});

app.get('/api/rooms/:id', (req, res) => {
  const roomId = Number(req.params.id);
  if (!Number.isInteger(roomId) || roomId <= 0) {
    res.status(400).json({ error: 'Invalid room ID.' });
    return;
  }
  const room = getRoomWithDirections(roomId, false);
  if (!room) {
    res.status(404).json({ error: 'Location not found.' });
    return;
  }
  res.json({ room });
});

app.get('/api/floors', (_req, res) => {
  res.json({ floors: listFloors() });
});

app.get('/api/departments', (_req, res) => {
  res.json({ departments: listDepartments() });
});

app.get('/api/voice-settings', (_req, res) => {
  res.json({ settings: getVoiceSettings() });
});

// ---------- ADMIN AUTHENTICATION API ----------

app.get('/api/admin/status', (_req, res) => {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  res.json({ initialized: countRow.count > 0 });
});

app.post('/api/admin/setup', (req, res) => {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  if (countRow.count > 0) {
    res.status(403).json({ error: 'Administrator account is already initialized. Please sign in.' });
    return;
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : 'Campus Administrator';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Please provide a valid administrator email address.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  const result = db
    .prepare('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)')
    .run(email, hashPassword(password), name || 'Campus Administrator');

  const adminId = Number(result.lastInsertRowid);
  const token = createSessionToken(adminId, email);

  res.status(201).json({
    token,
    admin: { id: adminId, email, name: name || 'Campus Administrator' },
  });
});

app.post('/api/admin/login', (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const adminRow = db
    .prepare('SELECT id, email, password_hash, name FROM admins WHERE email = ?')
    .get(email) as { id: number; email: string; password_hash: string; name: string } | undefined;

  if (!adminRow || !verifyPassword(password, adminRow.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const token = createSessionToken(adminRow.id, adminRow.email);
  res.json({
    token,
    admin: {
      id: adminRow.id,
      email: adminRow.email,
      name: adminRow.name,
    },
  });
});

app.get('/api/admin/me', requireAdmin, (req: AuthenticatedRequest, res) => {
  res.json({ admin: req.admin });
});

// ---------- PROTECTED ADMIN MANAGEMENT API ----------

app.get('/api/admin/dashboard', requireAdmin, (_req, res) => {
  res.json({ stats: getAdminStats() });
});

// Rooms CRUD
app.get('/api/admin/rooms', requireAdmin, (_req, res) => {
  res.json({ rooms: listRooms({ includeInactive: true }) });
});

app.get('/api/admin/rooms/:id', requireAdmin, (req, res) => {
  const roomId = Number(req.params.id);
  if (!Number.isInteger(roomId) || roomId <= 0) {
    res.status(400).json({ error: 'Invalid room ID.' });
    return;
  }
  const room = getRoomWithDirections(roomId, true);
  if (!room) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }
  res.json({ room });
});

app.post('/api/admin/rooms', requireAdmin, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const roomNumber = typeof req.body?.room_number === 'string' ? req.body.room_number.trim() : '';
  const departmentIdRaw = req.body?.department_id;
  const departmentId =
    departmentIdRaw === null || departmentIdRaw === '' || departmentIdRaw === undefined
      ? null
      : Number(departmentIdRaw);
  const floorId = Number(req.body?.floor_id);
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : 'Facility';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const isActive = req.body?.is_active === false ? 0 : 1;

  if (!name || !roomNumber) {
    res.status(400).json({ error: 'Room name and room number are required.' });
    return;
  }
  if (!Number.isInteger(floorId) || floorId <= 0) {
    res.status(400).json({ error: 'Please select a valid floor.' });
    return;
  }
  if (!VALID_CATEGORIES.includes(category as RoomCategory)) {
    res.status(400).json({ error: 'Invalid room category.' });
    return;
  }

  const floorExists = db.prepare('SELECT id FROM floors WHERE id = ?').get(floorId);
  if (!floorExists) {
    res.status(400).json({ error: 'Selected floor does not exist.' });
    return;
  }

  if (departmentId !== null) {
    const deptExists = db.prepare('SELECT id FROM departments WHERE id = ?').get(departmentId);
    if (!deptExists) {
      res.status(400).json({ error: 'Selected department does not exist.' });
      return;
    }
  }

  const result = db
    .prepare(
      `INSERT INTO rooms (name, room_number, department_id, floor_id, category, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name, roomNumber, departmentId, floorId, category, description, isActive);

  const created = getRoomWithDirections(Number(result.lastInsertRowid), true);
  res.status(201).json({ room: created });
});

app.put('/api/admin/rooms/:id', requireAdmin, (req, res) => {
  const roomId = Number(req.params.id);
  if (!Number.isInteger(roomId) || roomId <= 0) {
    res.status(400).json({ error: 'Invalid room ID.' });
    return;
  }

  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }

  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : String(existing.name);
  const roomNumber =
    typeof req.body?.room_number === 'string'
      ? req.body.room_number.trim()
      : String(existing.room_number);
  const departmentId =
    req.body?.department_id === undefined
      ? (existing.department_id as number | null)
      : req.body.department_id === null || req.body.department_id === ''
        ? null
        : Number(req.body.department_id);
  const floorId =
    req.body?.floor_id === undefined ? Number(existing.floor_id) : Number(req.body.floor_id);
  const category =
    typeof req.body?.category === 'string'
      ? req.body.category.trim()
      : String(existing.category);
  const description =
    typeof req.body?.description === 'string'
      ? req.body.description.trim()
      : String(existing.description ?? '');
  const isActive =
    req.body?.is_active === undefined
      ? Number(existing.is_active)
      : req.body.is_active
        ? 1
        : 0;

  if (!name || !roomNumber) {
    res.status(400).json({ error: 'Room name and room number are required.' });
    return;
  }
  if (!VALID_CATEGORIES.includes(category as RoomCategory)) {
    res.status(400).json({ error: 'Invalid room category.' });
    return;
  }

  const floorExists = db.prepare('SELECT id FROM floors WHERE id = ?').get(floorId);
  if (!floorExists) {
    res.status(400).json({ error: 'Selected floor does not exist.' });
    return;
  }

  if (departmentId !== null) {
    const deptExists = db.prepare('SELECT id FROM departments WHERE id = ?').get(departmentId);
    if (!deptExists) {
      res.status(400).json({ error: 'Selected department does not exist.' });
      return;
    }
  }

  db.prepare(
    `UPDATE rooms
     SET name = ?, room_number = ?, department_id = ?, floor_id = ?, category = ?, description = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, roomNumber, departmentId, floorId, category, description, isActive, roomId);

  const updated = getRoomWithDirections(roomId, true);
  res.json({ room: updated });
});

app.delete('/api/admin/rooms/:id', requireAdmin, (req, res) => {
  const roomId = Number(req.params.id);
  if (!Number.isInteger(roomId) || roomId <= 0) {
    res.status(400).json({ error: 'Invalid room ID.' });
    return;
  }

  const info = db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }

  res.json({ deleted: true });
});

// Floors CRUD
app.post('/api/admin/floors', requireAdmin, (req, res) => {
  const floorNumber = Number(req.body?.floor_number);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';

  if (!Number.isInteger(floorNumber)) {
    res.status(400).json({ error: 'Floor number must be a whole number.' });
    return;
  }
  if (!name) {
    res.status(400).json({ error: 'Floor name is required.' });
    return;
  }

  try {
    const result = db
      .prepare('INSERT INTO floors (floor_number, name, description) VALUES (?, ?, ?)')
      .run(floorNumber, name, description);
    const created = db
      .prepare('SELECT * FROM floors WHERE id = ?')
      .get(Number(result.lastInsertRowid));
    res.status(201).json({ floor: created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: `Floor number ${floorNumber} already exists.` });
      return;
    }
    throw err;
  }
});

app.put('/api/admin/floors/:id', requireAdmin, (req, res) => {
  const floorId = Number(req.params.id);
  if (!Number.isInteger(floorId) || floorId <= 0) {
    res.status(400).json({ error: 'Invalid floor ID.' });
    return;
  }

  const existing = db.prepare('SELECT * FROM floors WHERE id = ?').get(floorId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Floor not found.' });
    return;
  }

  const floorNumber =
    req.body?.floor_number === undefined
      ? Number(existing.floor_number)
      : Number(req.body.floor_number);
  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : String(existing.name);
  const description =
    typeof req.body?.description === 'string'
      ? req.body.description.trim()
      : String(existing.description ?? '');

  if (!Number.isInteger(floorNumber) || !name) {
    res.status(400).json({ error: 'Valid floor number and name are required.' });
    return;
  }

  try {
    db.prepare('UPDATE floors SET floor_number = ?, name = ?, description = ? WHERE id = ?').run(
      floorNumber,
      name,
      description,
      floorId
    );
    const updated = db.prepare('SELECT * FROM floors WHERE id = ?').get(floorId);
    res.json({ floor: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: `Floor number ${floorNumber} already exists.` });
      return;
    }
    throw err;
  }
});

app.delete('/api/admin/floors/:id', requireAdmin, (req, res) => {
  const floorId = Number(req.params.id);
  if (!Number.isInteger(floorId) || floorId <= 0) {
    res.status(400).json({ error: 'Invalid floor ID.' });
    return;
  }

  const roomCount = (
    db.prepare('SELECT COUNT(*) as c FROM rooms WHERE floor_id = ?').get(floorId) as { c: number }
  ).c;
  if (roomCount > 0) {
    res.status(409).json({
      error: `Cannot delete floor because ${roomCount} room(s) are assigned to it. Reassign or remove those rooms first.`,
    });
    return;
  }

  const info = db.prepare('DELETE FROM floors WHERE id = ?').run(floorId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Floor not found.' });
    return;
  }
  res.json({ deleted: true });
});

// Departments CRUD
app.post('/api/admin/departments', requireAdmin, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';

  if (!name || !code) {
    res.status(400).json({ error: 'Department name and code are required.' });
    return;
  }

  try {
    const result = db
      .prepare('INSERT INTO departments (name, code, description) VALUES (?, ?, ?)')
      .run(name, code, description);
    const created = db
      .prepare('SELECT * FROM departments WHERE id = ?')
      .get(Number(result.lastInsertRowid));
    res.status(201).json({ department: created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: `Department "${name}" already exists.` });
      return;
    }
    throw err;
  }
});

app.put('/api/admin/departments/:id', requireAdmin, (req, res) => {
  const deptId = Number(req.params.id);
  if (!Number.isInteger(deptId) || deptId <= 0) {
    res.status(400).json({ error: 'Invalid department ID.' });
    return;
  }

  const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(deptId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Department not found.' });
    return;
  }

  const name =
    typeof req.body?.name === 'string' ? req.body.name.trim() : String(existing.name);
  const code =
    typeof req.body?.code === 'string'
      ? req.body.code.trim().toUpperCase()
      : String(existing.code);
  const description =
    typeof req.body?.description === 'string'
      ? req.body.description.trim()
      : String(existing.description ?? '');

  if (!name || !code) {
    res.status(400).json({ error: 'Department name and code are required.' });
    return;
  }

  try {
    db.prepare('UPDATE departments SET name = ?, code = ?, description = ? WHERE id = ?').run(
      name,
      code,
      description,
      deptId
    );
    const updated = db.prepare('SELECT * FROM departments WHERE id = ?').get(deptId);
    res.json({ department: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: `Department "${name}" already exists.` });
      return;
    }
    throw err;
  }
});

app.delete('/api/admin/departments/:id', requireAdmin, (req, res) => {
  const deptId = Number(req.params.id);
  if (!Number.isInteger(deptId) || deptId <= 0) {
    res.status(400).json({ error: 'Invalid department ID.' });
    return;
  }

  const info = db.prepare('DELETE FROM departments WHERE id = ?').run(deptId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Department not found.' });
    return;
  }
  res.json({ deleted: true });
});

// Routes & Multilingual Steps CRUD
app.put('/api/admin/routes/:roomId', requireAdmin, (req, res) => {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId) || roomId <= 0) {
    res.status(400).json({ error: 'Invalid room ID.' });
    return;
  }

  const roomExists = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
  if (!roomExists) {
    res.status(404).json({ error: 'Destination room not found.' });
    return;
  }

  const startingLocation =
    typeof req.body?.starting_location === 'string' ? req.body.starting_location.trim() : '';
  const isActive = req.body?.is_active === false ? 0 : 1;
  const rawSteps = Array.isArray(req.body?.steps) ? req.body.steps : [];

  if (!startingLocation) {
    res.status(400).json({ error: 'Starting location is required.' });
    return;
  }
  if (rawSteps.length === 0) {
    res.status(400).json({ error: 'At least one direction step is required.' });
    return;
  }

  const sanitizedSteps: Array<Omit<RouteStep, 'id' | 'route_id'>> = [];
  for (let i = 0; i < rawSteps.length; i++) {
    const s = rawSteps[i];
    const actionType =
      typeof s?.action_type === 'string' && VALID_STEP_TYPES.has(s.action_type)
        ? (s.action_type as RouteStep['action_type'])
        : 'custom';
    const en = typeof s?.instruction_en === 'string' ? s.instruction_en.trim() : '';
    const kn = typeof s?.instruction_kn === 'string' ? s.instruction_kn.trim() : '';
    const hi = typeof s?.instruction_hi === 'string' ? s.instruction_hi.trim() : '';
    const stepIsActive = s?.is_active === false ? false : true;

    if (!en && !kn && !hi) {
      res.status(400).json({
        error: `Step ${i + 1} must include instruction text in at least one language (Kannada, English, or Hindi).`,
      });
      return;
    }

    sanitizedSteps.push({
      step_order: i + 1,
      action_type: actionType,
      instruction_en: en,
      instruction_kn: kn,
      instruction_hi: hi,
      is_active: stepIsActive,
    });
  }

  const saveRouteTx = db.transaction(() => {
    const existingRoute = db
      .prepare('SELECT id FROM navigation_routes WHERE room_id = ?')
      .get(roomId) as { id: number } | undefined;

    let routeId: number;
    if (existingRoute) {
      routeId = existingRoute.id;
      db.prepare(
        `UPDATE navigation_routes
         SET starting_location = ?, is_active = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(startingLocation, isActive, routeId);
      db.prepare('DELETE FROM route_steps WHERE route_id = ?').run(routeId);
    } else {
      const insertResult = db
        .prepare(
          'INSERT INTO navigation_routes (room_id, starting_location, is_active) VALUES (?, ?, ?)'
        )
        .run(roomId, startingLocation, isActive);
      routeId = Number(insertResult.lastInsertRowid);
    }

    const insertStep = db.prepare(
      `INSERT INTO route_steps (route_id, step_order, action_type, instruction_en, instruction_kn, instruction_hi, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const step of sanitizedSteps) {
      insertStep.run(
        routeId,
        step.step_order,
        step.action_type,
        step.instruction_en,
        step.instruction_kn,
        step.instruction_hi,
        step.is_active === false ? 0 : 1
      );
    }
  });

  saveRouteTx();
  const updatedRoom = getRoomWithDirections(roomId, true);
  res.json({ room: updatedRoom });
});

// ---------- VOICE CONTROL SETTINGS & VOICE INSTRUCTION MANAGEMENT ----------

app.get('/api/admin/voice-settings', requireAdmin, (_req, res) => {
  res.json({ settings: getVoiceSettings() });
});

app.put('/api/admin/voice-settings', requireAdmin, (req, res) => {
  const current = getVoiceSettings();
  const voiceEnabled =
    typeof req.body?.voice_enabled === 'boolean' ? req.body.voice_enabled : current.voice_enabled;
  const defaultLangRaw =
    typeof req.body?.default_language === 'string'
      ? req.body.default_language
      : current.default_language;
  const voiceSpeed =
    req.body?.voice_speed !== undefined ? Number(req.body.voice_speed) : current.voice_speed;
  const voicePitch =
    req.body?.voice_pitch !== undefined ? Number(req.body.voice_pitch) : current.voice_pitch;

  if (!['kn', 'en', 'hi'].includes(defaultLangRaw)) {
    res.status(400).json({ error: 'Default language must be Kannada (kn), English (en), or Hindi (hi).' });
    return;
  }
  if (!Number.isFinite(voiceSpeed) || voiceSpeed < 0.5 || voiceSpeed > 1.5) {
    res.status(400).json({ error: 'Voice speed must be between 0.5 and 1.5.' });
    return;
  }
  if (!Number.isFinite(voicePitch) || voicePitch < 0.5 || voicePitch > 1.5) {
    res.status(400).json({ error: 'Voice pitch must be between 0.5 and 1.5.' });
    return;
  }

  const settings = updateVoiceSettings({
    voice_enabled: voiceEnabled,
    default_language: defaultLangRaw as LanguageCode,
    voice_speed: Math.round(voiceSpeed * 100) / 100,
    voice_pitch: Math.round(voicePitch * 100) / 100,
  });

  res.json({ settings });
});

app.get('/api/admin/voice-instructions', requireAdmin, (req, res) => {
  const roomId = req.query.roomId ? Number(req.query.roomId) : undefined;
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const instructions = listVoiceInstructions({
    roomId: roomId && Number.isInteger(roomId) ? roomId : undefined,
    query,
  });
  res.json({ instructions });
});

app.post('/api/admin/voice-instructions', requireAdmin, (req, res) => {
  const roomId = Number(req.body?.room_id);
  const floorIdRaw = req.body?.floor_id !== undefined ? Number(req.body.floor_id) : undefined;
  const startingLocation =
    typeof req.body?.starting_location === 'string' && req.body.starting_location.trim()
      ? req.body.starting_location.trim()
      : 'Main Entrance';
  const actionType =
    typeof req.body?.action_type === 'string' && VALID_STEP_TYPES.has(req.body.action_type)
      ? req.body.action_type
      : 'custom';
  const instructionKn =
    typeof req.body?.instruction_kn === 'string' ? req.body.instruction_kn.trim() : '';
  const instructionEn =
    typeof req.body?.instruction_en === 'string' ? req.body.instruction_en.trim() : '';
  const instructionHi =
    typeof req.body?.instruction_hi === 'string' ? req.body.instruction_hi.trim() : '';
  const isActive = req.body?.is_active === false ? 0 : 1;
  const requestedOrder =
    req.body?.step_order !== undefined && Number.isInteger(Number(req.body.step_order))
      ? Number(req.body.step_order)
      : null;

  if (!Number.isInteger(roomId) || roomId <= 0) {
    res.status(400).json({ error: 'Please select a valid destination room.' });
    return;
  }

  const roomRow = db.prepare('SELECT id, floor_id FROM rooms WHERE id = ?').get(roomId) as
    | { id: number; floor_id: number }
    | undefined;
  if (!roomRow) {
    res.status(404).json({ error: 'Destination room not found.' });
    return;
  }

  if (floorIdRaw !== undefined) {
    if (!Number.isInteger(floorIdRaw) || floorIdRaw <= 0) {
      res.status(400).json({ error: 'Invalid floor selection.' });
      return;
    }
    const floorExists = db.prepare('SELECT id FROM floors WHERE id = ?').get(floorIdRaw);
    if (!floorExists) {
      res.status(400).json({ error: 'Selected floor does not exist.' });
      return;
    }
  }

  if (!instructionKn && !instructionEn && !instructionHi) {
    res.status(400).json({
      error: 'Please enter instruction text in at least one language (Kannada, English, or Hindi).',
    });
    return;
  }

  let createdId = 0;
  const createTx = db.transaction(() => {
    if (floorIdRaw !== undefined && floorIdRaw !== roomRow.floor_id) {
      db.prepare("UPDATE rooms SET floor_id = ?, updated_at = datetime('now') WHERE id = ?").run(
        floorIdRaw,
        roomId
      );
    }

    const routeId = ensureRouteForRoom(roomId, startingLocation);
    const existingSteps = db
      .prepare('SELECT id, step_order FROM route_steps WHERE route_id = ? ORDER BY step_order ASC, id ASC')
      .all(routeId) as Array<{ id: number; step_order: number }>;

    const targetOrder =
      requestedOrder !== null && requestedOrder >= 1 && requestedOrder <= existingSteps.length + 1
        ? requestedOrder
        : existingSteps.length + 1;

    // Shift subsequent steps if inserting into the middle
    if (targetOrder <= existingSteps.length) {
      db.prepare(
        'UPDATE route_steps SET step_order = step_order + 1 WHERE route_id = ? AND step_order >= ?'
      ).run(routeId, targetOrder);
    }

    const insertResult = db
      .prepare(
        `INSERT INTO route_steps (route_id, step_order, action_type, instruction_en, instruction_kn, instruction_hi, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        routeId,
        targetOrder,
        actionType,
        instructionEn,
        instructionKn,
        instructionHi,
        isActive
      );

    createdId = Number(insertResult.lastInsertRowid);
    resequenceRouteSteps(routeId);
    db.prepare("UPDATE navigation_routes SET updated_at = datetime('now') WHERE id = ?").run(routeId);
  });

  createTx();
  const created = getVoiceInstructionById(createdId);
  res.status(201).json({ instruction: created });
});

app.put('/api/admin/voice-instructions/reorder', requireAdmin, (req, res) => {
  const roomId = Number(req.body?.room_id);
  const orderedIds = Array.isArray(req.body?.ordered_ids)
    ? req.body.ordered_ids.map((v: unknown) => Number(v))
    : [];

  if (!Number.isInteger(roomId) || roomId <= 0) {
    res.status(400).json({ error: 'Valid room_id is required.' });
    return;
  }

  const routeRow = db
    .prepare('SELECT id FROM navigation_routes WHERE room_id = ?')
    .get(roomId) as { id: number } | undefined;
  if (!routeRow) {
    res.status(404).json({ error: 'Route not found for this room.' });
    return;
  }

  if (orderedIds.length === 0 || orderedIds.some((id: number) => !Number.isInteger(id) || id <= 0)) {
    res.status(400).json({ error: 'Valid ordered_ids array is required.' });
    return;
  }

  const reorderTx = db.transaction(() => {
    const updateStmt = db.prepare(
      "UPDATE route_steps SET step_order = ?, updated_at = datetime('now') WHERE id = ? AND route_id = ?"
    );
    orderedIds.forEach((stepId: number, idx: number) => {
      updateStmt.run(idx + 1, stepId, routeRow.id);
    });
    resequenceRouteSteps(routeRow.id);
    db.prepare("UPDATE navigation_routes SET updated_at = datetime('now') WHERE id = ?").run(
      routeRow.id
    );
  });

  reorderTx();
  const instructions = listVoiceInstructions({ roomId });
  res.json({ instructions });
});

app.put('/api/admin/voice-instructions/:id', requireAdmin, (req, res) => {
  const stepId = Number(req.params.id);
  if (!Number.isInteger(stepId) || stepId <= 0) {
    res.status(400).json({ error: 'Invalid instruction ID.' });
    return;
  }

  const existing = getVoiceInstructionById(stepId);
  if (!existing) {
    res.status(404).json({ error: 'Voice instruction not found.' });
    return;
  }

  const targetRoomId =
    req.body?.room_id !== undefined ? Number(req.body.room_id) : existing.room_id;
  if (!Number.isInteger(targetRoomId) || targetRoomId <= 0) {
    res.status(400).json({ error: 'Invalid destination room ID.' });
    return;
  }

  const targetRoomRow = db.prepare('SELECT id, floor_id FROM rooms WHERE id = ?').get(targetRoomId) as
    | { id: number; floor_id: number }
    | undefined;
  if (!targetRoomRow) {
    res.status(404).json({ error: 'Selected destination room not found.' });
    return;
  }

  const floorIdRaw =
    req.body?.floor_id !== undefined ? Number(req.body.floor_id) : undefined;
  if (floorIdRaw !== undefined) {
    if (!Number.isInteger(floorIdRaw) || floorIdRaw <= 0) {
      res.status(400).json({ error: 'Invalid floor ID.' });
      return;
    }
    const floorExists = db.prepare('SELECT id FROM floors WHERE id = ?').get(floorIdRaw);
    if (!floorExists) {
      res.status(400).json({ error: 'Selected floor does not exist.' });
      return;
    }
  }

  // Independent language updates: never overwrite an unspecified language field
  const nextKn =
    typeof req.body?.instruction_kn === 'string'
      ? req.body.instruction_kn.trim()
      : existing.instruction_kn;
  const nextEn =
    typeof req.body?.instruction_en === 'string'
      ? req.body.instruction_en.trim()
      : existing.instruction_en;
  const nextHi =
    typeof req.body?.instruction_hi === 'string'
      ? req.body.instruction_hi.trim()
      : existing.instruction_hi;

  if (!nextKn && !nextEn && !nextHi) {
    res.status(400).json({
      error: 'At least one language version (Kannada, English, or Hindi) must contain text.',
    });
    return;
  }

  const nextActionType =
    typeof req.body?.action_type === 'string' && VALID_STEP_TYPES.has(req.body.action_type)
      ? req.body.action_type
      : existing.action_type;
  const nextActive =
    typeof req.body?.is_active === 'boolean'
      ? req.body.is_active
        ? 1
        : 0
      : existing.is_active
        ? 1
        : 0;
  const requestedOrder =
    req.body?.step_order !== undefined && Number.isInteger(Number(req.body.step_order))
      ? Number(req.body.step_order)
      : null;

  const updateTx = db.transaction(() => {
    if (floorIdRaw !== undefined && floorIdRaw !== targetRoomRow.floor_id) {
      db.prepare("UPDATE rooms SET floor_id = ?, updated_at = datetime('now') WHERE id = ?").run(
        floorIdRaw,
        targetRoomId
      );
    }

    const oldRouteId = existing.route_id;
    const newRouteId =
      targetRoomId === existing.room_id ? oldRouteId : ensureRouteForRoom(targetRoomId);

    if (newRouteId !== oldRouteId) {
      const targetStepsCount = (
        db.prepare('SELECT COUNT(*) as c FROM route_steps WHERE route_id = ?').get(newRouteId) as {
          c: number;
        }
      ).c;
      const newOrder =
        requestedOrder !== null && requestedOrder >= 1 && requestedOrder <= targetStepsCount + 1
          ? requestedOrder
          : targetStepsCount + 1;

      db.prepare(
        `UPDATE route_steps
         SET route_id = ?, step_order = ?, action_type = ?, instruction_kn = ?, instruction_en = ?, instruction_hi = ?, is_active = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        newRouteId,
        newOrder,
        nextActionType,
        nextKn,
        nextEn,
        nextHi,
        nextActive,
        stepId
      );

      resequenceRouteSteps(oldRouteId);
      resequenceRouteSteps(newRouteId);
      db.prepare("UPDATE navigation_routes SET updated_at = datetime('now') WHERE id IN (?, ?)").run(
        oldRouteId,
        newRouteId
      );
    } else {
      if (requestedOrder !== null && requestedOrder !== existing.step_order) {
        const siblings = db
          .prepare('SELECT id FROM route_steps WHERE route_id = ? AND id != ? ORDER BY step_order ASC, id ASC')
          .all(oldRouteId, stepId) as Array<{ id: number }>;
        const clampedIndex = Math.max(0, Math.min(siblings.length, requestedOrder - 1));
        siblings.splice(clampedIndex, 0, { id: stepId });

        const orderStmt = db.prepare('UPDATE route_steps SET step_order = ? WHERE id = ?');
        siblings.forEach((s, idx) => orderStmt.run(idx + 1, s.id));
      }

      db.prepare(
        `UPDATE route_steps
         SET action_type = ?, instruction_kn = ?, instruction_en = ?, instruction_hi = ?, is_active = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(nextActionType, nextKn, nextEn, nextHi, nextActive, stepId);

      db.prepare("UPDATE navigation_routes SET updated_at = datetime('now') WHERE id = ?").run(
        oldRouteId
      );
    }
  });

  updateTx();
  const updated = getVoiceInstructionById(stepId);
  res.json({ instruction: updated });
});

app.delete('/api/admin/voice-instructions/:id', requireAdmin, (req, res) => {
  const stepId = Number(req.params.id);
  if (!Number.isInteger(stepId) || stepId <= 0) {
    res.status(400).json({ error: 'Invalid instruction ID.' });
    return;
  }

  const existing = getVoiceInstructionById(stepId);
  if (!existing) {
    res.status(404).json({ error: 'Voice instruction not found.' });
    return;
  }

  const deleteTx = db.transaction(() => {
    db.prepare('DELETE FROM route_steps WHERE id = ?').run(stepId);
    resequenceRouteSteps(existing.route_id);
    db.prepare("UPDATE navigation_routes SET updated_at = datetime('now') WHERE id = ?").run(
      existing.route_id
    );
  });

  deleteTx();
  res.json({ deleted: true });
});

app.delete('/api/admin/routes/:roomId', requireAdmin, (req, res) => {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId) || roomId <= 0) {
    res.status(400).json({ error: 'Invalid room ID.' });
    return;
  }

  const info = db.prepare('DELETE FROM navigation_routes WHERE room_id = ?').run(roomId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'No configured route found for this room.' });
    return;
  }

  const updatedRoom = getRoomWithDirections(roomId, true);
  res.json({ deleted: true, room: updatedRoom });
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Campus 360 server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
