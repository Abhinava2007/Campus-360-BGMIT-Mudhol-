import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.ts';
import type {
  AdminDashboardStats,
  Department,
  Floor,
  LanguageCode,
  NavigationRoute,
  Room,
  RoomCategory,
  RoomWithDirections,
  RouteStep,
  VoiceInstructionRecord,
  VoiceSettings,
} from '../src/types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'campus360.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      code TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS floors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      floor_number INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      room_number TEXT NOT NULL,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE RESTRICT,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS navigation_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER UNIQUE NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      starting_location TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS route_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL REFERENCES navigation_routes(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      instruction_en TEXT NOT NULL,
      instruction_kn TEXT NOT NULL,
      instruction_hi TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS voice_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      voice_enabled INTEGER NOT NULL DEFAULT 1,
      default_language TEXT NOT NULL DEFAULT 'en',
      voice_speed REAL NOT NULL DEFAULT 0.95,
      voice_pitch REAL NOT NULL DEFAULT 1.0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active);
    CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor_id);
    CREATE INDEX IF NOT EXISTS idx_rooms_dept ON rooms(department_id);
    CREATE INDEX IF NOT EXISTS idx_route_steps_order ON route_steps(route_id, step_order);
  `);

  // Non-destructive column migrations for existing databases
  const stepCols = db.prepare('PRAGMA table_info(route_steps)').all() as Array<{ name: string }>;
  const colNames = new Set(stepCols.map((c) => c.name));
  if (!colNames.has('is_active')) {
    db.exec('ALTER TABLE route_steps ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  }
  if (!colNames.has('created_at')) {
    db.exec("ALTER TABLE route_steps ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE route_steps SET created_at = datetime('now') WHERE created_at = ''");
  }
  if (!colNames.has('updated_at')) {
    db.exec("ALTER TABLE route_steps ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE route_steps SET updated_at = datetime('now') WHERE updated_at = ''");
  }

  // Ensure default voice settings row exists
  const settingsCount = (
    db.prepare('SELECT COUNT(*) as c FROM voice_settings WHERE id = 1').get() as { c: number }
  ).c;
  const isFirstVoiceUpgrade = settingsCount === 0;
  if (isFirstVoiceUpgrade) {
    db.prepare(
      `INSERT INTO voice_settings (id, voice_enabled, default_language, voice_speed, voice_pitch)
       VALUES (1, 1, 'en', 0.95, 1.0)`
    ).run();
  }

  // Optional initial admin seeding from environment variables (never hardcoded in UI)
  const adminCountRow = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  if (adminCountRow.count === 0) {
    const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const envPassword = process.env.ADMIN_PASSWORD?.trim();
    if (envEmail && envPassword && envPassword.length >= 6) {
      db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)').run(
        envEmail,
        hashPassword(envPassword),
        'Campus Administrator'
      );
    }
  }

  // Seed initial BGMIT Mudhol campus structure only on a fresh empty database
  const floorCount = (db.prepare('SELECT COUNT(*) as count FROM floors').get() as { count: number }).count;
  const deptCount = (db.prepare('SELECT COUNT(*) as count FROM departments').get() as { count: number }).count;
  const roomCount = (db.prepare('SELECT COUNT(*) as count FROM rooms').get() as { count: number }).count;

  if (floorCount === 0 && deptCount === 0 && roomCount === 0) {
    seedInitialCampusData();
  } else if (isFirstVoiceUpgrade) {
    seedMissingDefaultFacilityRoutes();
  }
}

function seedInitialCampusData(): void {
  const insertFloor = db.prepare(
    'INSERT INTO floors (floor_number, name, description) VALUES (?, ?, ?)'
  );
  const insertDept = db.prepare(
    'INSERT INTO departments (name, code, description) VALUES (?, ?, ?)'
  );
  const insertRoom = db.prepare(
    `INSERT INTO rooms (name, room_number, department_id, floor_id, category, description, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  const insertRoute = db.prepare(
    'INSERT INTO navigation_routes (room_id, starting_location, is_active) VALUES (?, ?, 1)'
  );
  const insertStep = db.prepare(
    `INSERT INTO route_steps (route_id, step_order, action_type, instruction_en, instruction_kn, instruction_hi)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const seedTx = db.transaction(() => {
    const groundId = Number(
      insertFloor.run(0, 'Ground Floor', 'Main Entrance, Administrative Wing, and Central Library').lastInsertRowid
    );
    const firstId = Number(
      insertFloor.run(1, 'First Floor', 'Electronics & Communication Wing and Seminar Facilities').lastInsertRowid
    );
    const secondId = Number(
      insertFloor.run(2, 'Second Floor', 'Computer Science & Engineering Wing, Classrooms, and Labs').lastInsertRowid
    );

    const cseDeptId = Number(
      insertDept.run('CSE Department', 'CSE', 'Computer Science and Engineering').lastInsertRowid
    );
    const encDeptId = Number(
      insertDept.run('ENC Department', 'ENC', 'Electronics and Communication Engineering').lastInsertRowid
    );
    const mechDeptId = Number(
      insertDept.run('Mechanical Department', 'ME', 'Mechanical Engineering').lastInsertRowid
    );
    const civilDeptId = Number(
      insertDept.run('Civil Department', 'CV', 'Civil Engineering').lastInsertRowid
    );
    const centralDeptId = Number(
      insertDept.run('Central Facilities', 'CAMPUS', 'Shared Campus Facilities and Administration').lastInsertRowid
    );

    const roomsToSeed: Array<{
      name: string;
      room_number: string;
      department_id: number;
      floor_id: number;
      category: RoomCategory;
      description: string;
      starting_location?: string;
      steps?: Array<Omit<RouteStep, 'id' | 'route_id'>>;
    }> = [
      {
        name: 'Central Library',
        room_number: 'LIB-001',
        department_id: centralDeptId,
        floor_id: groundId,
        category: 'Library',
        description: 'BGMIT Central Library, Reading Hall, and Digital Resource Center',
        starting_location: 'Main Entrance',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find your destination.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನಕ್ಕೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
            instruction_hi: 'नमस्ते! आइए आपके गंतव्य तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'straight',
            instruction_en: 'Please walk straight ahead from the main entrance lobby.',
            instruction_kn: 'ದಯವಿಟ್ಟು ಮುಖ್ಯ ಪ್ರವೇಶದ್ವಾರದಿಂದ ನೇರವಾಗಿ ಮುಂದೆ ಹೋಗಿ.',
            instruction_hi: 'कृपया मुख्य प्रवेश द्वार से सीधे आगे बढ़ें।',
          },
          {
            step_order: 3,
            action_type: 'left',
            instruction_en: 'Now turn left at the central corridor.',
            instruction_kn: 'ಈಗ ಕೇಂದ್ರ ಕಾರಿಡಾರ್ ಬಳಿ ಎಡಕ್ಕೆ ತಿರುಗಿ.',
            instruction_hi: 'अब मुख्य गलियारे पर बाईं ओर मुड़ें।',
          },
          {
            step_order: 4,
            action_type: 'straight',
            instruction_en: 'Walk straight towards the Central Library entrance.',
            instruction_kn: 'ಕೇಂದ್ರ ಗ್ರಂಥಾಲಯದ ಪ್ರವೇಶದ್ವಾರದ ಕಡೆಗೆ ನೇರವಾಗಿ ನಡೆದು ಹೋಗಿ.',
            instruction_hi: 'केंद्रीय पुस्तकालय के प्रवेश द्वार की ओर सीधे चलें।',
          },
          {
            step_order: 5,
            action_type: 'destination',
            instruction_en: 'You have reached the Central Library. Thank you!',
            instruction_kn: 'ನೀವು ಕೇಂದ್ರ ಗ್ರಂಥಾಲಯವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप केंद्रीय पुस्तकालय पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'CSE Department',
        room_number: 'CSE-301',
        department_id: cseDeptId,
        floor_id: secondId,
        category: 'Department',
        description: 'Department of Computer Science & Engineering Main Block',
        starting_location: 'Main Entrance',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find your destination.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನಕ್ಕೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
            instruction_hi: 'नमस्ते! आइए आपके गंतव्य तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'straight',
            instruction_en: 'Please walk straight ahead.',
            instruction_kn: 'ದಯವಿಟ್ಟು ನೇರವಾಗಿ ಮುಂದೆ ಹೋಗಿ.',
            instruction_hi: 'कृपया सीधे आगे बढ़ें।',
          },
          {
            step_order: 3,
            action_type: 'right',
            instruction_en: 'Now turn right.',
            instruction_kn: 'ಈಗ ಬಲಕ್ಕೆ ತಿರುಗಿ.',
            instruction_hi: 'अब दाईं ओर मुड़ें।',
          },
          {
            step_order: 4,
            action_type: 'stairs',
            instruction_en: 'Take the stairs to the second floor.',
            instruction_kn: 'ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಎರಡನೇ ಮಹಡಿಗೆ ಹೋಗಿ.',
            instruction_hi: 'सीढ़ियों से दूसरी मंजिल पर जाएँ।',
          },
          {
            step_order: 5,
            action_type: 'straight',
            instruction_en: 'Walk straight towards CSE Department.',
            instruction_kn: 'ಸಿಎಸ್‌ಇ ವಿಭಾಗದ ಕಡೆಗೆ ನೇರವಾಗಿ ಹೋಗಿ.',
            instruction_hi: 'सीएसई विभाग की ओर सीधे आगे बढ़ें।',
          },
          {
            step_order: 6,
            action_type: 'destination',
            instruction_en: 'You have reached your destination. Thank you!',
            instruction_kn: 'ನೀವು ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप अपने गंतव्य पर पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'CSE Lecture Hall 302',
        room_number: 'CSE-302',
        department_id: cseDeptId,
        floor_id: secondId,
        category: 'Classroom',
        description: 'Computer Science Classroom for Semester Lectures',
        starting_location: 'Main Entrance',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find your destination.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನಕ್ಕೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
            instruction_hi: 'नमस्ते! आइए आपके गंतव्य तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'straight',
            instruction_en: 'Walk straight into the main academic block.',
            instruction_kn: 'ಮುಖ್ಯ ಶೈಕ್ಷಣಿಕ ಕಟ್ಟಡದೊಳಗೆ ನೇರವಾಗಿ ನಡೆದು ಹೋಗಿ.',
            instruction_hi: 'मुख्य शैक्षणिक भवन के अंदर सीधे चलें।',
          },
          {
            step_order: 3,
            action_type: 'stairs',
            instruction_en: 'Take the main staircase to the second floor.',
            instruction_kn: 'ಮುಖ್ಯ ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಎರಡನೇ ಮಹಡಿಗೆ ಹತ್ತಿರಿ.',
            instruction_hi: 'मुख्य सीढ़ियों से दूसरी मंजिल पर जाएँ।',
          },
          {
            step_order: 4,
            action_type: 'left',
            instruction_en: 'Turn left along the CSE wing corridor to room CSE-302.',
            instruction_kn: 'ಸಿಎಸ್‌ಇ ವಿಭಾಗದ ಕಾರಿಡಾರ್‌ನಲ್ಲಿ ಎಡಕ್ಕೆ ತಿರುಗಿ ಕೊಠಡಿ CSE-302 ಕಡೆಗೆ ಹೋಗಿ.',
            instruction_hi: 'सीएसई विंग के गलियारे में बाईं ओर मुड़कर कमरा CSE-302 की ओर जाएँ।',
          },
          {
            step_order: 5,
            action_type: 'destination',
            instruction_en: 'You have reached CSE Lecture Hall 302. Thank you!',
            instruction_kn: 'ನೀವು CSE-302 ತರಗತಿಯನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप कक्षा CSE-302 पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'CSE HOD Room',
        room_number: 'CSE-303',
        department_id: cseDeptId,
        floor_id: secondId,
        category: 'HOD Room',
        description: 'Head of Department Office — Computer Science & Engineering',
        starting_location: 'Main Entrance',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find the CSE HOD Room.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ಸಿಎಸ್‌ಇ ಮುಖ್ಯಸ್ಥರ ಕೊಠಡಿಗೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
            instruction_hi: 'नमस्ते! आइए सीएसई विभागाध्यक्ष कक्ष तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'stairs',
            instruction_en: 'Proceed to the central staircase and go to the second floor.',
            instruction_kn: 'ಮಧ್ಯದ ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಎರಡನೇ ಮಹಡಿಗೆ ಹೋಗಿ.',
            instruction_hi: 'मुख्य सीढ़ियों से दूसरी मंजिल पर जाएँ।',
          },
          {
            step_order: 3,
            action_type: 'right',
            instruction_en: 'Turn right at the top of the stairs towards the CSE office.',
            instruction_kn: 'ಮೆಟ್ಟಿಲುಗಳ ಮೇಲ್ಭಾಗದಲ್ಲಿ ಸಿಎಸ್‌ಇ ಕಚೇರಿಯ ಕಡೆಗೆ ಬಲಕ್ಕೆ ತಿರುಗಿ.',
            instruction_hi: 'सीढ़ियों के ऊपर से सीएसई कार्यालय की ओर दाईं ओर मुड़ें।',
          },
          {
            step_order: 4,
            action_type: 'destination',
            instruction_en: 'You have reached the CSE HOD Room. Thank you!',
            instruction_kn: 'ನೀವು ಸಿಎಸ್‌ಇ ಮುಖ್ಯಸ್ಥರ ಕೊಠಡಿಯನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप सीएसई विभागाध्यक्ष कक्ष पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'CSE Staff Room',
        room_number: 'CSE-304',
        department_id: cseDeptId,
        floor_id: secondId,
        category: 'Staff Room',
        description: 'Faculty Cabin and Staff Room — Computer Science & Engineering',
        starting_location: 'Second Floor Staircase',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find the CSE Staff Room.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ಸಿಎಸ್‌ಇ ಸಿಬ್ಬಂದಿ ಕೊಠಡಿಗೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
            instruction_hi: 'नमस्ते! आइए सीएसई स्टाफ रूम तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'right',
            instruction_en: 'Turn right from the second floor staircase.',
            instruction_kn: 'ಎರಡನೇ ಮಹಡಿಯ ಮೆಟ್ಟಿಲುಗಳಿಂದ ಬಲಕ್ಕೆ ತಿರುಗಿ.',
            instruction_hi: 'दूसरी मंजिल की सीढ़ियों से दाईं ओर मुड़ें।',
          },
          {
            step_order: 3,
            action_type: 'straight',
            instruction_en: 'Walk straight past the HOD office to reach CSE-304.',
            instruction_kn: 'ಮುಖ್ಯಸ್ಥರ ಕೊಠಡಿಯನ್ನು ದಾಟಿ CSE-304 ಕಡೆಗೆ ನೇರವಾಗಿ ಹೋಗಿ.',
            instruction_hi: 'विभागाध्यक्ष कक्ष से आगे बढ़कर सीधे कमरा CSE-304 तक जाएँ।',
          },
          {
            step_order: 4,
            action_type: 'destination',
            instruction_en: 'You have reached the CSE Staff Room. Thank you!',
            instruction_kn: 'ನೀವು ಸಿಎಸ್‌ಇ ಸಿಬ್ಬಂದಿ ಕೊಠಡಿಯನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप सीएसई स्टाफ रूम पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'CSE Computer Lab',
        room_number: 'CSE-LAB-1',
        department_id: cseDeptId,
        floor_id: secondId,
        category: 'Laboratory',
        description: 'Programming and Systems Laboratory',
        starting_location: 'Main Entrance',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find the CSE Computer Lab.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ಸಿಎಸ್‌ಇ ಕಂಪ್ಯೂಟರ್ ಪ್ರಯೋಗಾಲಯಕ್ಕೆ ಹೋಗೋಣ.',
            instruction_hi: 'नमस्ते! आइए सीएसई कंप्यूटर लैब तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'stairs',
            instruction_en: 'Take the stairs up to the second floor.',
            instruction_kn: 'ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಎರಡನೇ ಮಹಡಿಗೆ ಹೋಗಿ.',
            instruction_hi: 'सीढ़ियों से दूसरी मंजिल पर जाएँ।',
          },
          {
            step_order: 3,
            action_type: 'left',
            instruction_en: 'Turn left and walk straight to the end of the wing.',
            instruction_kn: 'ಎಡಕ್ಕೆ ತಿರುಗಿ ಕಾರಿಡಾರ್‌ನ ಕೊನೆಯವರೆಗೆ ನೇರವಾಗಿ ನಡೆಯಿರಿ.',
            instruction_hi: 'बाईं ओर मुड़ें और गलियारे के अंत तक सीधे चलें।',
          },
          {
            step_order: 4,
            action_type: 'destination',
            instruction_en: 'You have reached the CSE Computer Lab. Thank you!',
            instruction_kn: 'ನೀವು ಸಿಎಸ್‌ಇ ಕಂಪ್ಯೂಟರ್ ಪ್ರಯೋಗಾಲಯವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप सीएसई कंप्यूटर लैब पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'ENC Department',
        room_number: 'ENC-201',
        department_id: encDeptId,
        floor_id: firstId,
        category: 'Department',
        description: 'Department of Electronics & Communication Engineering',
        starting_location: 'Main Entrance',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find the ENC Department.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ಇಎನ್‌ಸಿ ವಿಭಾಗಕ್ಕೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
            instruction_hi: 'नमस्ते! आइए ईएनसी विभाग तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'straight',
            instruction_en: 'Please walk straight ahead into the lobby.',
            instruction_kn: 'ದಯವಿಟ್ಟು ಲಾಬಿಯೊಳಗೆ ನೇರವಾಗಿ ಮುಂದೆ ಹೋಗಿ.',
            instruction_hi: 'कृपया लॉबी में सीधे आगे बढ़ें।',
          },
          {
            step_order: 3,
            action_type: 'stairs',
            instruction_en: 'Take the stairs to the first floor.',
            instruction_kn: 'ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಮೊದಲನೇ ಮಹಡಿಗೆ ಹೋಗಿ.',
            instruction_hi: 'सीढ़ियों से पहली मंजिल पर जाएँ।',
          },
          {
            step_order: 4,
            action_type: 'left',
            instruction_en: 'Turn left and walk straight towards the ENC Department.',
            instruction_kn: 'ಎಡಕ್ಕೆ ತಿರುಗಿ ಇಎನ್‌ಸಿ ವಿಭಾಗದ ಕಡೆಗೆ ನೇರವಾಗಿ ಹೋಗಿ.',
            instruction_hi: 'बाईं ओर मुड़ें और ईएनसी विभाग की ओर सीधे चलें।',
          },
          {
            step_order: 5,
            action_type: 'destination',
            instruction_en: 'You have reached the ENC Department. Thank you!',
            instruction_kn: 'ನೀವು ಇಎನ್‌ಸಿ ವಿಭಾಗವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप ईएनसी विभाग पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'ENC Electronics Lab',
        room_number: 'ENC-LAB-1',
        department_id: encDeptId,
        floor_id: firstId,
        category: 'Laboratory',
        description: 'Analog, Digital Electronics, and Communication Laboratory',
        starting_location: 'First Floor Staircase',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find the ENC Electronics Lab.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ಇಎನ್‌ಸಿ ಎಲೆಕ್ಟ್ರಾನಿಕ್ಸ್ ಪ್ರಯೋಗಾಲಯಕ್ಕೆ ಹೋಗೋಣ.',
            instruction_hi: 'नमस्ते! आइए ईएनसी इलेक्ट्रॉनिक्स लैब तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'left',
            instruction_en: 'Turn left from the first floor staircase.',
            instruction_kn: 'ಮೊದಲನೇ ಮಹಡಿಯ ಮೆಟ್ಟಿಲುಗಳಿಂದ ಎಡಕ್ಕೆ ತಿರುಗಿ.',
            instruction_hi: 'पहली मंजिल की सीढ़ियों से बाईं ओर मुड़ें।',
          },
          {
            step_order: 3,
            action_type: 'straight',
            instruction_en: 'Walk straight past the ENC Department office to ENC-LAB-1.',
            instruction_kn: 'ಇಎನ್‌ಸಿ ವಿಭಾಗದ ಕಚೇರಿಯನ್ನು ದಾಟಿ ನೇರವಾಗಿ ENC-LAB-1 ಕಡೆಗೆ ಹೋಗಿ.',
            instruction_hi: 'ईएनसी विभाग कार्यालय से आगे बढ़कर सीधे ENC-LAB-1 तक जाएँ।',
          },
          {
            step_order: 4,
            action_type: 'destination',
            instruction_en: 'You have reached the ENC Electronics Lab. Thank you!',
            instruction_kn: 'ನೀವು ಇಎನ್‌ಸಿ ಪ್ರಯೋಗಾಲಯವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप ईएनसी इलेक्ट्रॉनिक्स लैब पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'Principal Office',
        room_number: 'ADM-101',
        department_id: centralDeptId,
        floor_id: groundId,
        category: 'Facility',
        description: 'Principal Chamber and Administrative Office',
        starting_location: 'Main Entrance',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find the Principal Office.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ಪ್ರಾಂಶುಪಾಲರ ಕಚೇರಿಗೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
            instruction_hi: 'नमस्ते! आइए प्राचार्य कार्यालय तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'right',
            instruction_en: 'Turn right immediately after entering the main reception.',
            instruction_kn: 'ಮುಖ್ಯ ಸ್ವಾಗತ ಕೌಂಟರ್ ಪ್ರವೇಶಿಸಿದ ತಕ್ಷಣ ಬಲಕ್ಕೆ ತಿರುಗಿ.',
            instruction_hi: 'मुख्य रिसेप्शन में प्रवेश करते ही दाईं ओर मुड़ें।',
          },
          {
            step_order: 3,
            action_type: 'destination',
            instruction_en: 'You have reached the Principal Office. Thank you!',
            instruction_kn: 'ನೀವು ಪ್ರಾಂಶುಪಾಲರ ಕಚೇರಿಯನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप प्राचार्य कार्यालय पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'Mechanical Department',
        room_number: 'ME-105',
        department_id: mechDeptId,
        floor_id: groundId,
        category: 'Department',
        description: 'Department of Mechanical Engineering',
        starting_location: 'Main Entrance',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find the Mechanical Department.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ಮೆಕ್ಯಾನಿಕಲ್ ವಿಭಾಗಕ್ಕೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
            instruction_hi: 'नमस्ते! आइए मैकेनिकल विभाग तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'straight',
            instruction_en: 'Walk straight past the central courtyard on the ground floor.',
            instruction_kn: 'ನೆಲ ಮಹಡಿಯ ಕೇಂದ್ರ ಅಂಗಳವನ್ನು ದಾಟಿ ನೇರವಾಗಿ ನಡೆದು ಹೋಗಿ.',
            instruction_hi: 'भूतल पर मुख्य आँगन से आगे सीधे चलें।',
          },
          {
            step_order: 3,
            action_type: 'right',
            instruction_en: 'Turn right into the Mechanical Engineering wing.',
            instruction_kn: 'ಮೆಕ್ಯಾನಿಕಲ್ ಇಂಜಿನಿಯರಿಂಗ್ ವಿಭಾಗದ ಕಡೆಗೆ ಬಲಕ್ಕೆ ತಿರುಗಿ.',
            instruction_hi: 'मैकेनिकल इंजीनियरिंग विंग में दाईं ओर मुड़ें।',
          },
          {
            step_order: 4,
            action_type: 'destination',
            instruction_en: 'You have reached the Mechanical Department. Thank you!',
            instruction_kn: 'ನೀವು ಮೆಕ್ಯಾನಿಕಲ್ ವಿಭಾಗವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप मैकेनिकल विभाग पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'Civil Department',
        room_number: 'CV-108',
        department_id: civilDeptId,
        floor_id: groundId,
        category: 'Department',
        description: 'Department of Civil Engineering',
        starting_location: 'Main Entrance',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find the Civil Department.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ಸಿವಿಲ್ ವಿಭಾಗಕ್ಕೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
            instruction_hi: 'नमस्ते! आइए सिविल विभाग तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'left',
            instruction_en: 'Turn left from the central lobby on the ground floor.',
            instruction_kn: 'ನೆಲ ಮಹಡಿಯ ಕೇಂದ್ರ ಲಾಬಿಯಿಂದ ಎಡಕ್ಕೆ ತಿರುಗಿ.',
            instruction_hi: 'भूतल की मुख्य लॉबी से बाईं ओर मुड़ें।',
          },
          {
            step_order: 3,
            action_type: 'straight',
            instruction_en: 'Walk straight past the Central Library towards Civil Engineering.',
            instruction_kn: 'ಕೇಂದ್ರ ಗ್ರಂಥಾಲಯವನ್ನು ದಾಟಿ ಸಿವಿಲ್ ಇಂಜಿನಿಯರಿಂಗ್ ಕಡೆಗೆ ನೇರವಾಗಿ ಹೋಗಿ.',
            instruction_hi: 'केंद्रीय पुस्तकालय से आगे सिविल इंजीनियरिंग की ओर सीधे चलें।',
          },
          {
            step_order: 4,
            action_type: 'destination',
            instruction_en: 'You have reached the Civil Department. Thank you!',
            instruction_kn: 'ನೀವು ಸಿವಿಲ್ ವಿಭಾಗವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप सिविल विभाग पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
      {
        name: 'Seminar Hall',
        room_number: 'SEM-205',
        department_id: centralDeptId,
        floor_id: firstId,
        category: 'Facility',
        description: 'Central Academic Seminar and Auditorium Hall',
        starting_location: 'Main Entrance',
        steps: [
          {
            step_order: 1,
            action_type: 'start',
            instruction_en: "Hello! Let's find the Seminar Hall.",
            instruction_kn: 'ನಮಸ್ಕಾರ! ಸೆಮಿನಾರ್ ಹಾಲ್‌ಗೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
            instruction_hi: 'नमस्ते! आइए सेमिनार हॉल तक चलते हैं।',
          },
          {
            step_order: 2,
            action_type: 'stairs',
            instruction_en: 'Take the main staircase to the first floor.',
            instruction_kn: 'ಮುಖ್ಯ ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಮೊದಲನೇ ಮಹಡಿಗೆ ಹೋಗಿ.',
            instruction_hi: 'मुख्य सीढ़ियों से पहली मंजिल पर जाएँ।',
          },
          {
            step_order: 3,
            action_type: 'right',
            instruction_en: 'Turn right at the first floor landing to reach Seminar Hall SEM-205.',
            instruction_kn: 'ಮೊದಲನೇ ಮಹಡಿಯಲ್ಲಿ ಬಲಕ್ಕೆ ತಿರುಗಿ ಸೆಮಿನಾರ್ ಹಾಲ್ SEM-205 ತಲುಪಿ.',
            instruction_hi: 'पहली मंजिल पर दाईं ओर मुड़कर सेमिनार हॉल SEM-205 तक पहुँचें।',
          },
          {
            step_order: 4,
            action_type: 'destination',
            instruction_en: 'You have reached the Seminar Hall. Thank you!',
            instruction_kn: 'ನೀವು ಸೆಮಿನಾರ್ ಹಾಲ್ ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
            instruction_hi: 'आप सेमिनार हॉल पहुँच गए हैं। धन्यवाद!',
          },
        ],
      },
    ];

    for (const r of roomsToSeed) {
      const roomId = Number(
        insertRoom.run(
          r.name,
          r.room_number,
          r.department_id,
          r.floor_id,
          r.category,
          r.description
        ).lastInsertRowid
      );
      if (r.starting_location && r.steps && r.steps.length > 0) {
        const routeId = Number(insertRoute.run(roomId, r.starting_location).lastInsertRowid);
        for (const step of r.steps) {
          insertStep.run(
            routeId,
            step.step_order,
            step.action_type,
            step.instruction_en,
            step.instruction_kn,
            step.instruction_hi
          );
        }
      }
    }
  });

  seedTx();
}

function seedMissingDefaultFacilityRoutes(): void {
  const defaults: Array<{
    room_number: string;
    starting_location: string;
    steps: Array<Omit<RouteStep, 'id' | 'route_id'>>;
  }> = [
    {
      room_number: 'ME-105',
      starting_location: 'Main Entrance',
      steps: [
        {
          step_order: 1,
          action_type: 'start',
          instruction_en: "Hello! Let's find the Mechanical Department.",
          instruction_kn: 'ನಮಸ್ಕಾರ! ಮೆಕ್ಯಾನಿಕಲ್ ವಿಭಾಗಕ್ಕೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
          instruction_hi: 'नमस्ते! आइए मैकेनिकल विभाग तक चलते हैं।',
        },
        {
          step_order: 2,
          action_type: 'straight',
          instruction_en: 'Walk straight past the central courtyard on the ground floor.',
          instruction_kn: 'ನೆಲ ಮಹಡಿಯ ಕೇಂದ್ರ ಅಂಗಳವನ್ನು ದಾಟಿ ನೇರವಾಗಿ ನಡೆದು ಹೋಗಿ.',
          instruction_hi: 'भूतल पर मुख्य आँगन से आगे सीधे चलें।',
        },
        {
          step_order: 3,
          action_type: 'right',
          instruction_en: 'Turn right into the Mechanical Engineering wing.',
          instruction_kn: 'ಮೆಕ್ಯಾನಿಕಲ್ ಇಂಜಿನಿಯರಿಂಗ್ ವಿಭಾಗದ ಕಡೆಗೆ ಬಲಕ್ಕೆ ತಿರುಗಿ.',
          instruction_hi: 'मैकेनिकल इंजीनियरिंग विंग में दाईं ओर मुड़ें।',
        },
        {
          step_order: 4,
          action_type: 'destination',
          instruction_en: 'You have reached the Mechanical Department. Thank you!',
          instruction_kn: 'ನೀವು ಮೆಕ್ಯಾನಿಕಲ್ ವಿಭಾಗವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
          instruction_hi: 'आप मैकेनिकल विभाग पहुँच गए हैं। धन्यवाद!',
        },
      ],
    },
    {
      room_number: 'CV-108',
      starting_location: 'Main Entrance',
      steps: [
        {
          step_order: 1,
          action_type: 'start',
          instruction_en: "Hello! Let's find the Civil Department.",
          instruction_kn: 'ನಮಸ್ಕಾರ! ಸಿವಿಲ್ ವಿಭಾಗಕ್ಕೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
          instruction_hi: 'नमस्ते! आइए सिविल विभाग तक चलते हैं।',
        },
        {
          step_order: 2,
          action_type: 'left',
          instruction_en: 'Turn left from the central lobby on the ground floor.',
          instruction_kn: 'ನೆಲ ಮಹಡಿಯ ಕೇಂದ್ರ ಲಾಬಿಯಿಂದ ಎಡಕ್ಕೆ ತಿರುಗಿ.',
          instruction_hi: 'भूतल की मुख्य लॉबी से बाईं ओर मुड़ें।',
        },
        {
          step_order: 3,
          action_type: 'straight',
          instruction_en: 'Walk straight past the Central Library towards Civil Engineering.',
          instruction_kn: 'ಕೇಂದ್ರ ಗ್ರಂಥಾಲಯವನ್ನು ದಾಟಿ ಸಿವಿಲ್ ಇಂಜಿನಿಯರಿಂಗ್ ಕಡೆಗೆ ನೇರವಾಗಿ ಹೋಗಿ.',
          instruction_hi: 'केंद्रीय पुस्तकालय से आगे सिविल इंजीनियरिंग की ओर सीधे चलें।',
        },
        {
          step_order: 4,
          action_type: 'destination',
          instruction_en: 'You have reached the Civil Department. Thank you!',
          instruction_kn: 'ನೀವು ಸಿವಿಲ್ ವಿಭಾಗವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
          instruction_hi: 'आप सिविल विभाग पहुँच गए हैं। धन्यवाद!',
        },
      ],
    },
    {
      room_number: 'SEM-205',
      starting_location: 'Main Entrance',
      steps: [
        {
          step_order: 1,
          action_type: 'start',
          instruction_en: "Hello! Let's find the Seminar Hall.",
          instruction_kn: 'ನಮಸ್ಕಾರ! ಸೆಮಿನಾರ್ ಹಾಲ್‌ಗೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
          instruction_hi: 'नमस्ते! आइए सेमिनार हॉल तक चलते हैं।',
        },
        {
          step_order: 2,
          action_type: 'stairs',
          instruction_en: 'Take the main staircase to the first floor.',
          instruction_kn: 'ಮುಖ್ಯ ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಮೊದಲನೇ ಮಹಡಿಗೆ ಹೋಗಿ.',
          instruction_hi: 'मुख्य सीढ़ियों से पहली मंजिल पर जाएँ।',
        },
        {
          step_order: 3,
          action_type: 'right',
          instruction_en: 'Turn right at the first floor landing to reach Seminar Hall SEM-205.',
          instruction_kn: 'ಮೊದಲನೇ ಮಹಡಿಯಲ್ಲಿ ಬಲಕ್ಕೆ ತಿರುಗಿ ಸೆಮಿನಾರ್ ಹಾಲ್ SEM-205 ತಲುಪಿ.',
          instruction_hi: 'पहली मंजिल पर दाईं ओर मुड़कर सेमिनार हॉल SEM-205 तक पहुँचें।',
        },
        {
          step_order: 4,
          action_type: 'destination',
          instruction_en: 'You have reached the Seminar Hall. Thank you!',
          instruction_kn: 'ನೀವು ಸೆಮಿನಾರ್ ಹಾಲ್ ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
          instruction_hi: 'आप सेमिनार हॉल पहुँच गए हैं। धन्यवाद!',
        },
      ],
    },
  ];

  const tx = db.transaction(() => {
    for (const def of defaults) {
      const room = db
        .prepare('SELECT id FROM rooms WHERE room_number = ?')
        .get(def.room_number) as { id: number } | undefined;
      if (!room) continue;
      const existingRoute = db
        .prepare('SELECT id FROM navigation_routes WHERE room_id = ?')
        .get(room.id);
      if (existingRoute) continue;

      const routeId = Number(
        db
          .prepare(
            'INSERT INTO navigation_routes (room_id, starting_location, is_active) VALUES (?, ?, 1)'
          )
          .run(room.id, def.starting_location).lastInsertRowid
      );
      const insertStep = db.prepare(
        `INSERT INTO route_steps (route_id, step_order, action_type, instruction_en, instruction_kn, instruction_hi, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      );
      for (const s of def.steps) {
        insertStep.run(
          routeId,
          s.step_order,
          s.action_type,
          s.instruction_en,
          s.instruction_kn,
          s.instruction_hi
        );
      }
    }
  });
  tx();
}

export function listRooms(options: { includeInactive?: boolean; query?: string } = {}): Room[] {
  const { includeInactive = false, query = '' } = options;
  const trimmed = query.trim().toLowerCase();

  let sql = `
    SELECT
      r.id,
      r.name,
      r.room_number,
      r.department_id,
      d.name as department_name,
      d.code as department_code,
      r.floor_id,
      f.floor_number,
      f.name as floor_name,
      r.category,
      r.description,
      r.is_active,
      CASE WHEN EXISTS (
        SELECT 1 FROM navigation_routes nr
        JOIN route_steps rs ON rs.route_id = nr.id
        WHERE nr.room_id = r.id AND nr.is_active = 1 AND rs.is_active = 1
      ) THEN 1 ELSE 0 END as has_route,
      r.created_at,
      r.updated_at
    FROM rooms r
    LEFT JOIN departments d ON d.id = r.department_id
    JOIN floors f ON f.id = r.floor_id
    WHERE 1 = 1
  `;

  const params: unknown[] = [];

  if (!includeInactive) {
    sql += ' AND r.is_active = 1';
  }

  if (trimmed.length > 0) {
    const like = `%${trimmed}%`;
    sql += `
      AND (
        LOWER(r.name) LIKE ?
        OR LOWER(r.room_number) LIKE ?
        OR LOWER(COALESCE(d.name, '')) LIKE ?
        OR LOWER(COALESCE(d.code, '')) LIKE ?
        OR LOWER(f.name) LIKE ?
        OR LOWER(r.category) LIKE ?
        OR LOWER(r.description) LIKE ?
      )
    `;
    params.push(like, like, like, like, like, like, like);
  }

  sql += ' ORDER BY f.floor_number ASC, r.name ASC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    room_number: String(row.room_number),
    department_id: row.department_id === null ? null : Number(row.department_id),
    department_name: row.department_name === null ? null : String(row.department_name),
    department_code: row.department_code === null ? null : String(row.department_code),
    floor_id: Number(row.floor_id),
    floor_number: Number(row.floor_number),
    floor_name: String(row.floor_name),
    category: String(row.category) as RoomCategory,
    description: String(row.description ?? ''),
    is_active: Boolean(row.is_active),
    has_route: Boolean(row.has_route),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }));
}

export function getRoomWithDirections(roomId: number, includeInactive = false): RoomWithDirections | null {
  const rooms = listRooms({ includeInactive });
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return null;

  const routeRow = db
    .prepare(
      `SELECT id, room_id, starting_location, is_active, updated_at
       FROM navigation_routes
       WHERE room_id = ?`
    )
    .get(roomId) as Record<string, unknown> | undefined;

  let route: NavigationRoute | null = null;
  if (routeRow && (includeInactive || Boolean(routeRow.is_active))) {
    const stepQuery = includeInactive
      ? `SELECT id, route_id, step_order, action_type, instruction_en, instruction_kn, instruction_hi, is_active, created_at, updated_at
         FROM route_steps
         WHERE route_id = ?
         ORDER BY step_order ASC, id ASC`
      : `SELECT id, route_id, step_order, action_type, instruction_en, instruction_kn, instruction_hi, is_active, created_at, updated_at
         FROM route_steps
         WHERE route_id = ? AND is_active = 1
         ORDER BY step_order ASC, id ASC`;

    const stepRows = db.prepare(stepQuery).all(Number(routeRow.id)) as Array<
      Record<string, unknown>
    >;

    const steps: RouteStep[] = stepRows.map((s) => ({
      id: Number(s.id),
      route_id: Number(s.route_id),
      step_order: Number(s.step_order),
      action_type: String(s.action_type) as RouteStep['action_type'],
      instruction_en: String(s.instruction_en),
      instruction_kn: String(s.instruction_kn),
      instruction_hi: String(s.instruction_hi),
      is_active: Boolean(s.is_active),
      created_at: String(s.created_at ?? ''),
      updated_at: String(s.updated_at ?? ''),
    }));

    if (includeInactive || steps.length > 0) {
      route = {
        id: Number(routeRow.id),
        room_id: Number(routeRow.room_id),
        starting_location: String(routeRow.starting_location),
        is_active: Boolean(routeRow.is_active),
        updated_at: String(routeRow.updated_at),
        steps,
      };
    }
  }

  return {
    ...room,
    route,
  };
}

export function listFloors(): Floor[] {
  const rows = db
    .prepare(
      'SELECT id, floor_number, name, description, created_at FROM floors ORDER BY floor_number ASC'
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    floor_number: Number(row.floor_number),
    name: String(row.name),
    description: String(row.description ?? ''),
    created_at: String(row.created_at),
  }));
}

export function listDepartments(): Department[] {
  const rows = db
    .prepare(
      'SELECT id, name, code, description, created_at FROM departments ORDER BY name ASC'
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    code: String(row.code),
    description: String(row.description ?? ''),
    created_at: String(row.created_at),
  }));
}

export function getAdminStats(): AdminDashboardStats {
  const totalRooms = (db.prepare('SELECT COUNT(*) as c FROM rooms').get() as { c: number }).c;
  const activeRooms = (
    db.prepare('SELECT COUNT(*) as c FROM rooms WHERE is_active = 1').get() as { c: number }
  ).c;
  const totalDepartments = (
    db.prepare('SELECT COUNT(*) as c FROM departments').get() as { c: number }
  ).c;
  const totalFloors = (db.prepare('SELECT COUNT(*) as c FROM floors').get() as { c: number }).c;
  const totalRoutes = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT nr.id) as c
         FROM navigation_routes nr
         JOIN route_steps rs ON rs.route_id = nr.id
         WHERE rs.is_active = 1`
      )
      .get() as { c: number }
  ).c;
  const totalVoiceInstructions = (
    db.prepare('SELECT COUNT(*) as c FROM route_steps').get() as { c: number }
  ).c;
  const activeVoiceInstructions = (
    db.prepare('SELECT COUNT(*) as c FROM route_steps WHERE is_active = 1').get() as { c: number }
  ).c;

  return {
    total_rooms: totalRooms,
    active_rooms: activeRooms,
    total_departments: totalDepartments,
    total_floors: totalFloors,
    total_routes: totalRoutes,
    total_voice_instructions: totalVoiceInstructions,
    active_voice_instructions: activeVoiceInstructions,
  };
}

export function getVoiceSettings(): VoiceSettings {
  const row = db
    .prepare(
      'SELECT voice_enabled, default_language, voice_speed, voice_pitch, updated_at FROM voice_settings WHERE id = 1'
    )
    .get() as Record<string, unknown> | undefined;

  if (!row) {
    return {
      voice_enabled: true,
      default_language: 'en',
      voice_speed: 0.95,
      voice_pitch: 1.0,
      updated_at: new Date().toISOString(),
    };
  }

  return {
    voice_enabled: Boolean(row.voice_enabled),
    default_language: String(row.default_language) as LanguageCode,
    voice_speed: Number(row.voice_speed),
    voice_pitch: Number(row.voice_pitch),
    updated_at: String(row.updated_at),
  };
}

export function updateVoiceSettings(input: {
  voice_enabled: boolean;
  default_language: LanguageCode;
  voice_speed: number;
  voice_pitch: number;
}): VoiceSettings {
  db.prepare(
    `UPDATE voice_settings
     SET voice_enabled = ?, default_language = ?, voice_speed = ?, voice_pitch = ?, updated_at = datetime('now')
     WHERE id = 1`
  ).run(
    input.voice_enabled ? 1 : 0,
    input.default_language,
    input.voice_speed,
    input.voice_pitch
  );
  return getVoiceSettings();
}

export function ensureRouteForRoom(roomId: number, startingLocation = 'Main Entrance'): number {
  const existing = db
    .prepare('SELECT id FROM navigation_routes WHERE room_id = ?')
    .get(roomId) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db
    .prepare(
      'INSERT INTO navigation_routes (room_id, starting_location, is_active) VALUES (?, ?, 1)'
    )
    .run(roomId, startingLocation);
  return Number(result.lastInsertRowid);
}

export function resequenceRouteSteps(routeId: number): void {
  const rows = db
    .prepare('SELECT id FROM route_steps WHERE route_id = ? ORDER BY step_order ASC, id ASC')
    .all(routeId) as Array<{ id: number }>;
  const updateStmt = db.prepare('UPDATE route_steps SET step_order = ? WHERE id = ?');
  rows.forEach((row, index) => {
    updateStmt.run(index + 1, row.id);
  });
}

export function listVoiceInstructions(filters: {
  roomId?: number;
  query?: string;
} = {}): VoiceInstructionRecord[] {
  let sql = `
    SELECT
      rs.id,
      rs.route_id,
      nr.room_id,
      r.name as room_name,
      r.room_number,
      r.floor_id,
      f.floor_number,
      f.name as floor_name,
      nr.starting_location,
      rs.step_order,
      rs.action_type,
      rs.instruction_kn,
      rs.instruction_en,
      rs.instruction_hi,
      rs.is_active,
      rs.created_at,
      rs.updated_at
    FROM route_steps rs
    JOIN navigation_routes nr ON nr.id = rs.route_id
    JOIN rooms r ON r.id = nr.room_id
    JOIN floors f ON f.id = r.floor_id
    WHERE 1 = 1
  `;

  const params: unknown[] = [];
  if (filters.roomId && Number.isInteger(filters.roomId)) {
    sql += ' AND nr.room_id = ?';
    params.push(filters.roomId);
  }

  const q = (filters.query ?? '').trim().toLowerCase();
  if (q.length > 0) {
    const like = `%${q}%`;
    sql += `
      AND (
        LOWER(r.name) LIKE ?
        OR LOWER(r.room_number) LIKE ?
        OR LOWER(f.name) LIKE ?
        OR LOWER(rs.instruction_en) LIKE ?
        OR LOWER(rs.instruction_kn) LIKE ?
        OR LOWER(rs.instruction_hi) LIKE ?
      )
    `;
    params.push(like, like, like, like, like, like);
  }

  sql += ' ORDER BY f.floor_number ASC, r.name ASC, rs.step_order ASC, rs.id ASC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    route_id: Number(row.route_id),
    room_id: Number(row.room_id),
    room_name: String(row.room_name),
    room_number: String(row.room_number),
    floor_id: Number(row.floor_id),
    floor_number: Number(row.floor_number),
    floor_name: String(row.floor_name),
    starting_location: String(row.starting_location),
    step_order: Number(row.step_order),
    action_type: String(row.action_type) as VoiceInstructionRecord['action_type'],
    instruction_kn: String(row.instruction_kn ?? ''),
    instruction_en: String(row.instruction_en ?? ''),
    instruction_hi: String(row.instruction_hi ?? ''),
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }));
}

export function getVoiceInstructionById(id: number): VoiceInstructionRecord | null {
  const row = db
    .prepare(
      `SELECT
        rs.id,
        rs.route_id,
        nr.room_id,
        r.name as room_name,
        r.room_number,
        r.floor_id,
        f.floor_number,
        f.name as floor_name,
        nr.starting_location,
        rs.step_order,
        rs.action_type,
        rs.instruction_kn,
        rs.instruction_en,
        rs.instruction_hi,
        rs.is_active,
        rs.created_at,
        rs.updated_at
      FROM route_steps rs
      JOIN navigation_routes nr ON nr.id = rs.route_id
      JOIN rooms r ON r.id = nr.room_id
      JOIN floors f ON f.id = r.floor_id
      WHERE rs.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!row) return null;
  return {
    id: Number(row.id),
    route_id: Number(row.route_id),
    room_id: Number(row.room_id),
    room_name: String(row.room_name),
    room_number: String(row.room_number),
    floor_id: Number(row.floor_id),
    floor_number: Number(row.floor_number),
    floor_name: String(row.floor_name),
    starting_location: String(row.starting_location),
    step_order: Number(row.step_order),
    action_type: String(row.action_type) as VoiceInstructionRecord['action_type'],
    instruction_kn: String(row.instruction_kn ?? ''),
    instruction_en: String(row.instruction_en ?? ''),
    instruction_hi: String(row.instruction_hi ?? ''),
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}
