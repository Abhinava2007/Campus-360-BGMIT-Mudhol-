import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Edit3,
  LogOut,
  Plus,
  Route as RouteIcon,
  Trash2,
} from 'lucide-react';
import { ConfirmModal } from './ConfirmModal.tsx';
import { VoiceDirectionManager } from './VoiceDirectionManager.tsx';
import type {
  AdminDashboardStats,
  AdminUser,
  Department,
  Floor,
  Room,
  RoomCategory,
  RoomWithDirections,
  RouteStep,
  StepActionType,
  VoiceSettings,
} from '../types.ts';

interface AdminPanelProps {
  token: string;
  admin: AdminUser;
  onLogout: () => void;
  onVoiceSettingsUpdated: (settings: VoiceSettings) => void;
}

type AdminTab = 'rooms' | 'floors' | 'departments' | 'directions' | 'voice';

const ROOM_CATEGORIES: RoomCategory[] = [
  'Department',
  'Classroom',
  'Laboratory',
  'Library',
  'HOD Room',
  'Staff Room',
  'Facility',
];

const STEP_TEMPLATES: Array<{
  label: string;
  action_type: StepActionType;
  en: string;
  kn: string;
  hi: string;
}> = [
  {
    label: '+ Start Greeting',
    action_type: 'start',
    en: "Hello! Let's find your destination.",
    kn: 'ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನಕ್ಕೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
    hi: 'नमस्ते! आइए आपके गंतव्य तक चलते हैं।',
  },
  {
    label: '+ Walk Straight',
    action_type: 'straight',
    en: 'Please walk straight ahead.',
    kn: 'ದಯವಿಟ್ಟು ನೇರವಾಗಿ ಮುಂದೆ ಹೋಗಿ.',
    hi: 'कृपया सीधे आगे बढ़ें।',
  },
  {
    label: '+ Turn Left',
    action_type: 'left',
    en: 'Now turn left.',
    kn: 'ಈಗ ಎಡಕ್ಕೆ ತಿರುಗಿ.',
    hi: 'अब बाईं ओर मुड़ें।',
  },
  {
    label: '+ Turn Right',
    action_type: 'right',
    en: 'Now turn right.',
    kn: 'ಈಗ ಬಲಕ್ಕೆ ತಿರುಗಿ.',
    hi: 'अब दाईं ओर मुड़ें।',
  },
  {
    label: '+ Take Stairs',
    action_type: 'stairs',
    en: 'Take the stairs to the next floor.',
    kn: 'ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಮುಂದಿನ ಮಹಡಿಗೆ ಹೋಗಿ.',
    hi: 'सीढ़ियों से अगली मंजिल पर जाएँ।',
  },
  {
    label: '+ Floor Change',
    action_type: 'floor_change',
    en: 'Proceed to the second floor.',
    kn: 'ಎರಡನೇ ಮಹಡಿಗೆ ತೆರಳಿ.',
    hi: 'दूसरी मंजिल पर जाएँ।',
  },
  {
    label: '+ Arrival',
    action_type: 'destination',
    en: 'You have reached your destination. Thank you!',
    kn: 'ನೀವು ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
    hi: 'आप अपने गंतव्य पर पहुँच गए हैं। धन्यवाद!',
  },
];

export function AdminPanel({
  token,
  admin,
  onLogout,
  onVoiceSettingsUpdated,
}: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('rooms');
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Room form state
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [roomForm, setRoomForm] = useState({
    name: '',
    room_number: '',
    department_id: '' as string,
    floor_id: '' as string,
    category: 'Classroom' as RoomCategory,
    description: '',
    is_active: true,
  });
  const [roomSearch, setRoomSearch] = useState('');

  // Floor form state
  const [editingFloorId, setEditingFloorId] = useState<number | null>(null);
  const [showFloorForm, setShowFloorForm] = useState(false);
  const [floorForm, setFloorForm] = useState({
    floor_number: '0',
    name: '',
    description: '',
  });

  // Department form state
  const [editingDeptId, setEditingDeptId] = useState<number | null>(null);
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [deptForm, setDeptForm] = useState({
    name: '',
    code: '',
    description: '',
  });

  // Route & Multilingual step editor state
  const [selectedRouteRoomId, setSelectedRouteRoomId] = useState<number | null>(null);
  const [startingLocation, setStartingLocation] = useState('Main Entrance');
  const [routeActive, setRouteActive] = useState(true);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [savingRoute, setSavingRoute] = useState(false);

  // Delete confirmation modal
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }),
    [token]
  );

  const fetchAllAdminData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, roomsRes, floorsRes, deptsRes] = await Promise.all([
        fetch('/api/admin/dashboard', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/rooms', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/floors'),
        fetch('/api/departments'),
      ]);

      if (statsRes.status === 401 || roomsRes.status === 401) {
        onLogout();
        return;
      }

      const statsData = (await statsRes.json()) as { stats: AdminDashboardStats };
      const roomsData = (await roomsRes.json()) as { rooms: Room[] };
      const floorsData = (await floorsRes.json()) as { floors: Floor[] };
      const deptsData = (await deptsRes.json()) as { departments: Department[] };

      setStats(statsData.stats);
      setRooms(roomsData.rooms);
      setFloors(floorsData.floors);
      setDepartments(deptsData.departments);
    } catch {
      setBanner({ type: 'error', text: 'Failed to load campus administration data.' });
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    fetchAllAdminData();
  }, [fetchAllAdminData]);

  const loadRouteForRoom = useCallback(
    async (roomId: number) => {
      setSelectedRouteRoomId(roomId);
      setLoadingRoute(true);
      try {
        const res = await fetch(`/api/admin/rooms/${roomId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          onLogout();
          return;
        }
        const data = (await res.json()) as { room: RoomWithDirections };
        if (data.room.route) {
          setStartingLocation(data.room.route.starting_location);
          setRouteActive(data.room.route.is_active);
          setRouteSteps(data.room.route.steps);
        } else {
          setStartingLocation('Main Entrance');
          setRouteActive(true);
          setRouteSteps([]);
        }
      } catch {
        setBanner({ type: 'error', text: 'Failed to load route steps.' });
      } finally {
        setLoadingRoute(false);
      }
    },
    [token, onLogout]
  );

  // ---------- ROOM HANDLERS ----------
  const openAddRoom = () => {
    setEditingRoomId(null);
    setRoomForm({
      name: '',
      room_number: '',
      department_id: departments[0]?.id ? String(departments[0].id) : '',
      floor_id: floors[0]?.id ? String(floors[0].id) : '',
      category: 'Classroom',
      description: '',
      is_active: true,
    });
    setShowRoomForm(true);
  };

  const openEditRoom = (room: Room) => {
    setEditingRoomId(room.id);
    setRoomForm({
      name: room.name,
      room_number: room.room_number,
      department_id: room.department_id ? String(room.department_id) : '',
      floor_id: String(room.floor_id),
      category: room.category,
      description: room.description,
      is_active: room.is_active,
    });
    setShowRoomForm(true);
  };

  const handleSaveRoom = async (e: FormEvent) => {
    e.preventDefault();
    setBanner(null);

    const payload = {
      name: roomForm.name,
      room_number: roomForm.room_number,
      department_id: roomForm.department_id ? Number(roomForm.department_id) : null,
      floor_id: Number(roomForm.floor_id),
      category: roomForm.category,
      description: roomForm.description,
      is_active: roomForm.is_active,
    };

    const url = editingRoomId ? `/api/admin/rooms/${editingRoomId}` : '/api/admin/rooms';
    const method = editingRoomId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { error?: string };

    if (!res.ok) {
      setBanner({ type: 'error', text: data.error || 'Could not save room.' });
      return;
    }

    setShowRoomForm(false);
    setBanner({
      type: 'success',
      text: editingRoomId ? 'Room updated successfully.' : 'New room added successfully.',
    });
    await fetchAllAdminData();
  };

  const handleToggleRoomActive = async (room: Room) => {
    setBanner(null);
    const res = await fetch(`/api/admin/rooms/${room.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ is_active: !room.is_active }),
    });
    if (!res.ok) {
      setBanner({ type: 'error', text: 'Failed to update room status.' });
      return;
    }
    setBanner({
      type: 'success',
      text: `${room.name} is now ${room.is_active ? 'inactive' : 'active'}.`,
    });
    await fetchAllAdminData();
  };

  const requestDeleteRoom = (room: Room) => {
    setConfirmState({
      open: true,
      title: 'Delete Room',
      message: `Are you sure you want to delete "${room.name}" (${room.room_number})? Any configured directions for this room will also be permanently deleted.`,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/rooms/${room.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setBanner({ type: 'error', text: data.error || 'Failed to delete room.' });
          return;
        }
        if (selectedRouteRoomId === room.id) {
          setSelectedRouteRoomId(null);
          setRouteSteps([]);
        }
        setBanner({ type: 'success', text: `Deleted "${room.name}".` });
        await fetchAllAdminData();
      },
    });
  };

  // ---------- FLOOR HANDLERS ----------
  const openAddFloor = () => {
    setEditingFloorId(null);
    const nextNum =
      floors.length > 0 ? Math.max(...floors.map((f) => f.floor_number)) + 1 : 0;
    setFloorForm({ floor_number: String(nextNum), name: '', description: '' });
    setShowFloorForm(true);
  };

  const openEditFloor = (floor: Floor) => {
    setEditingFloorId(floor.id);
    setFloorForm({
      floor_number: String(floor.floor_number),
      name: floor.name,
      description: floor.description,
    });
    setShowFloorForm(true);
  };

  const handleSaveFloor = async (e: FormEvent) => {
    e.preventDefault();
    setBanner(null);
    const url = editingFloorId ? `/api/admin/floors/${editingFloorId}` : '/api/admin/floors';
    const method = editingFloorId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: authHeaders,
      body: JSON.stringify({
        floor_number: Number(floorForm.floor_number),
        name: floorForm.name,
        description: floorForm.description,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setBanner({ type: 'error', text: data.error || 'Failed to save floor.' });
      return;
    }

    setShowFloorForm(false);
    setBanner({
      type: 'success',
      text: editingFloorId ? 'Floor updated successfully.' : 'Floor added successfully.',
    });
    await fetchAllAdminData();
  };

  const requestDeleteFloor = (floor: Floor) => {
    setConfirmState({
      open: true,
      title: 'Delete Floor',
      message: `Are you sure you want to delete "${floor.name}" (Floor ${floor.floor_number})?`,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/floors/${floor.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setBanner({ type: 'error', text: data.error || 'Cannot delete floor.' });
          return;
        }
        setBanner({ type: 'success', text: `Deleted "${floor.name}".` });
        await fetchAllAdminData();
      },
    });
  };

  // ---------- DEPARTMENT HANDLERS ----------
  const openAddDept = () => {
    setEditingDeptId(null);
    setDeptForm({ name: '', code: '', description: '' });
    setShowDeptForm(true);
  };

  const openEditDept = (dept: Department) => {
    setEditingDeptId(dept.id);
    setDeptForm({ name: dept.name, code: dept.code, description: dept.description });
    setShowDeptForm(true);
  };

  const handleSaveDept = async (e: FormEvent) => {
    e.preventDefault();
    setBanner(null);
    const url = editingDeptId
      ? `/api/admin/departments/${editingDeptId}`
      : '/api/admin/departments';
    const method = editingDeptId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: authHeaders,
      body: JSON.stringify(deptForm),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setBanner({ type: 'error', text: data.error || 'Failed to save department.' });
      return;
    }

    setShowDeptForm(false);
    setBanner({
      type: 'success',
      text: editingDeptId
        ? 'Department updated successfully.'
        : 'Department added successfully.',
    });
    await fetchAllAdminData();
  };

  const requestDeleteDept = (dept: Department) => {
    setConfirmState({
      open: true,
      title: 'Delete Department',
      message: `Delete "${dept.name}"? Rooms linked to this department will remain active without a department assignment.`,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/departments/${dept.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setBanner({ type: 'error', text: data.error || 'Cannot delete department.' });
          return;
        }
        setBanner({ type: 'success', text: `Deleted "${dept.name}".` });
        await fetchAllAdminData();
      },
    });
  };

  // ---------- DIRECTION & LANGUAGE HANDLERS ----------
  const addStepFromTemplate = (tpl: (typeof STEP_TEMPLATES)[number]) => {
    setRouteSteps((prev) => [
      ...prev,
      {
        step_order: prev.length + 1,
        action_type: tpl.action_type,
        instruction_en: tpl.en,
        instruction_kn: tpl.kn,
        instruction_hi: tpl.hi,
      },
    ]);
  };

  const addBlankStep = () => {
    setRouteSteps((prev) => [
      ...prev,
      {
        step_order: prev.length + 1,
        action_type: 'custom',
        instruction_en: '',
        instruction_kn: '',
        instruction_hi: '',
      },
    ]);
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= routeSteps.length) return;
    setRouteSteps((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next.map((s, idx) => ({ ...s, step_order: idx + 1 }));
    });
  };

  const removeStep = (index: number) => {
    setRouteSteps((prev) =>
      prev.filter((_, i) => i !== index).map((s, idx) => ({ ...s, step_order: idx + 1 }))
    );
  };

  const updateStepField = (
    index: number,
    field: 'action_type' | 'instruction_en' | 'instruction_kn' | 'instruction_hi',
    value: string
  ) => {
    setRouteSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, [field]: value } : step))
    );
  };

  const handleSaveRoute = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedRouteRoomId) return;
    setBanner(null);
    setSavingRoute(true);

    try {
      const res = await fetch(`/api/admin/routes/${selectedRouteRoomId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          starting_location: startingLocation,
          is_active: routeActive,
          steps: routeSteps,
        }),
      });
      const data = (await res.json()) as { error?: string; room?: RoomWithDirections };
      if (!res.ok) {
        setBanner({ type: 'error', text: data.error || 'Could not save directions.' });
        return;
      }
      if (data.room?.route) {
        setRouteSteps(data.room.route.steps);
      }
      setBanner({ type: 'success', text: 'Directions and multilingual instructions saved.' });
      await fetchAllAdminData();
    } finally {
      setSavingRoute(false);
    }
  };

  const requestDeleteRoute = () => {
    if (!selectedRouteRoomId) return;
    const targetRoom = rooms.find((r) => r.id === selectedRouteRoomId);
    setConfirmState({
      open: true,
      title: 'Delete Route Directions',
      message: `Delete all walking directions for "${targetRoom?.name ?? 'this room'}"? Students will see "Directions are not available for this location yet." until a new route is configured.`,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/routes/${selectedRouteRoomId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setBanner({ type: 'error', text: data.error || 'Failed to delete route.' });
          return;
        }
        setRouteSteps([]);
        setBanner({ type: 'success', text: 'Route deleted.' });
        await fetchAllAdminData();
      },
    });
  };

  const filteredAdminRooms = useMemo(() => {
    const q = roomSearch.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.room_number.toLowerCase().includes(q) ||
        (r.department_name && r.department_name.toLowerCase().includes(q)) ||
        r.floor_name.toLowerCase().includes(q)
    );
  }, [rooms, roomSearch]);

  const selectedRouteRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRouteRoomId) ?? null,
    [rooms, selectedRouteRoomId]
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Admin Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Campus 360 Admin Panel
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Signed in as <span className="font-medium text-slate-900">{admin.email}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign Out
        </button>
      </div>

      {/* Dashboard Stats */}
      {stats && (
        <section
          aria-label="Campus summary statistics"
          className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Total Rooms</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {stats.total_rooms}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
              {stats.active_rooms} active in search
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Total Departments</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {stats.total_departments}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Total Floors</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {stats.total_floors}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Total Configured Routes</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {stats.total_routes}
            </div>
          </div>
        </section>
      )}

      {/* Status Banner */}
      {banner && (
        <div
          role="status"
          className={`mt-5 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
            banner.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Section Navigation Tabs */}
      <nav
        aria-label="Admin sections"
        className="mt-6 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1"
      >
        {(
          [
            ['rooms', 'Room Management'],
            ['floors', 'Floor Management'],
            ['departments', 'Departments'],
            ['directions', 'Directions & Languages'],
            ['voice', 'Voice Direction Management'],
          ] as Array<[AdminTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-[40px] flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
              tab === id
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Loading data...
        </div>
      ) : (
        <div className="mt-6">
          {/* ==================== ROOM MANAGEMENT ==================== */}
          {tab === 'rooms' && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <input
                  type="search"
                  value={roomSearch}
                  onChange={(e) => setRoomSearch(e.target.value)}
                  placeholder="Filter rooms by name, number, department, or floor..."
                  className="min-h-[44px] w-full max-w-md rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={openAddRoom}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add New Room
                </button>
              </div>

              {showRoomForm && (
                <form
                  onSubmit={handleSaveRoom}
                  className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
                >
                  <h2 className="text-lg font-semibold text-slate-900">
                    {editingRoomId ? 'Edit Room' : 'Add New Room'}
                  </h2>

                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Room Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={roomForm.name}
                        onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })}
                        placeholder="e.g. CSE Department"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Room Number *
                      </label>
                      <input
                        type="text"
                        required
                        value={roomForm.room_number}
                        onChange={(e) =>
                          setRoomForm({ ...roomForm, room_number: e.target.value })
                        }
                        placeholder="e.g. CSE-301"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-700 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700">Floor *</label>
                      <select
                        required
                        value={roomForm.floor_id}
                        onChange={(e) => setRoomForm({ ...roomForm, floor_id: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                      >
                        {floors.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name} (Floor {f.floor_number})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Department
                      </label>
                      <select
                        value={roomForm.department_id}
                        onChange={(e) =>
                          setRoomForm({ ...roomForm, department_id: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                      >
                        <option value="">None / General Campus</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Category *
                      </label>
                      <select
                        required
                        value={roomForm.category}
                        onChange={(e) =>
                          setRoomForm({
                            ...roomForm,
                            category: e.target.value as RoomCategory,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                      >
                        {ROOM_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-end pb-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
                        <input
                          type="checkbox"
                          checked={roomForm.is_active}
                          onChange={(e) =>
                            setRoomForm({ ...roomForm, is_active: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-slate-300 text-blue-700"
                        />
                        Active in Student Search
                      </label>
                    </div>

                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-xs font-medium text-slate-700">
                        Description
                      </label>
                      <input
                        type="text"
                        value={roomForm.description}
                        onChange={(e) =>
                          setRoomForm({ ...roomForm, description: e.target.value })
                        }
                        placeholder="Brief room or facility details"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="mt-5 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowRoomForm(false)}
                      className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="min-h-[44px] rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                    >
                      {editingRoomId ? 'Save Changes' : 'Create Room'}
                    </button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Room</th>
                      <th className="px-4 py-3">Number</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3">Floor</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAdminRooms.map((room) => (
                      <tr key={room.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{room.name}</div>
                          <div className="text-xs text-slate-500">{room.category}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800 tabular-nums">
                          {room.room_number}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {room.department_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{room.floor_name}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleToggleRoomActive(room)}
                            className={`min-h-[32px] rounded-md border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                              room.is_active
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {room.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setTab('directions');
                                loadRouteForRoom(room.id);
                              }}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 whitespace-nowrap"
                            >
                              <RouteIcon className="h-3.5 w-3.5" aria-hidden="true" />
                              {room.has_route ? 'Edit Route' : 'Add Route'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditRoom(room)}
                              aria-label={`Edit ${room.name}`}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteRoom(room)}
                              aria-label={`Delete ${room.name}`}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ==================== FLOOR MANAGEMENT ==================== */}
          {tab === 'floors' && (
            <section className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Campus Floors</h2>
                <button
                  type="button"
                  onClick={openAddFloor}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Floor
                </button>
              </div>

              {showFloorForm && (
                <form
                  onSubmit={handleSaveFloor}
                  className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
                >
                  <h3 className="text-base font-semibold text-slate-900">
                    {editingFloorId ? 'Edit Floor' : 'Add New Floor'}
                  </h3>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Floor Number *
                      </label>
                      <input
                        type="number"
                        required
                        value={floorForm.floor_number}
                        onChange={(e) =>
                          setFloorForm({ ...floorForm, floor_number: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Floor Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={floorForm.name}
                        onChange={(e) => setFloorForm({ ...floorForm, name: e.target.value })}
                        placeholder="e.g. Third Floor"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Description
                      </label>
                      <input
                        type="text"
                        value={floorForm.description}
                        onChange={(e) =>
                          setFloorForm({ ...floorForm, description: e.target.value })
                        }
                        placeholder="Departments or facilities on this floor"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowFloorForm(false)}
                      className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="min-h-[44px] rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                    >
                      {editingFloorId ? 'Save Floor' : 'Create Floor'}
                    </button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Floor #</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {floors.map((floor) => (
                      <tr key={floor.id}>
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900 tabular-nums">
                          {floor.floor_number}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{floor.name}</td>
                        <td className="px-4 py-3 text-slate-600">{floor.description || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditFloor(floor)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteFloor(floor)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ==================== DEPARTMENT MANAGEMENT ==================== */}
          {tab === 'departments' && (
            <section className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Departments</h2>
                <button
                  type="button"
                  onClick={openAddDept}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Department
                </button>
              </div>

              {showDeptForm && (
                <form
                  onSubmit={handleSaveDept}
                  className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
                >
                  <h3 className="text-base font-semibold text-slate-900">
                    {editingDeptId ? 'Edit Department' : 'Add Department'}
                  </h3>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Department Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={deptForm.name}
                        onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                        placeholder="e.g. AI & ML Department"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Code *</label>
                      <input
                        type="text"
                        required
                        value={deptForm.code}
                        onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })}
                        placeholder="e.g. AIML"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Description
                      </label>
                      <input
                        type="text"
                        value={deptForm.description}
                        onChange={(e) =>
                          setDeptForm({ ...deptForm, description: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDeptForm(false)}
                      className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="min-h-[44px] rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                    >
                      {editingDeptId ? 'Save Department' : 'Create Department'}
                    </button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Department Name</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {departments.map((dept) => (
                      <tr key={dept.id}>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-700">
                          {dept.code}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{dept.name}</td>
                        <td className="px-4 py-3 text-slate-600">{dept.description || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditDept(dept)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteDept(dept)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ==================== DIRECTION & LANGUAGE MANAGEMENT ==================== */}
          {tab === 'directions' && (
            <section className="space-y-5">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <label
                  htmlFor="route-room-select"
                  className="block text-sm font-semibold text-slate-900"
                >
                  Select Destination Room to Manage Directions &amp; Multilingual Instructions
                </label>
                <select
                  id="route-room-select"
                  value={selectedRouteRoomId ?? ''}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (id > 0) loadRouteForRoom(id);
                  }}
                  className="mt-2 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  <option value="">-- Choose a room or facility --</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.room_number}) — {r.floor_name}{' '}
                      {r.has_route ? '[Configured]' : '[No Route Yet]'}
                    </option>
                  ))}
                </select>
              </div>

              {selectedRouteRoom && (
                <form
                  onSubmit={handleSaveRoute}
                  className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">
                        Route for {selectedRouteRoom.name} ({selectedRouteRoom.room_number})
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {selectedRouteRoom.floor_name}
                        {selectedRouteRoom.department_name
                          ? ` · ${selectedRouteRoom.department_name}`
                          : ''}
                      </p>
                    </div>
                    {selectedRouteRoom.has_route && (
                      <button
                        type="button"
                        onClick={requestDeleteRoute}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Delete Route
                      </button>
                    )}
                  </div>

                  {loadingRoute ? (
                    <p className="py-6 text-sm text-slate-500">Loading route steps...</p>
                  ) : (
                    <>
                      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-700">
                            Starting Location *
                          </label>
                          <input
                            type="text"
                            required
                            value={startingLocation}
                            onChange={(e) => setStartingLocation(e.target.value)}
                            placeholder="e.g. Main Entrance"
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                          />
                        </div>
                        <div className="flex items-end pb-2">
                          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
                            <input
                              type="checkbox"
                              checked={routeActive}
                              onChange={(e) => setRouteActive(e.target.checked)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-700"
                            />
                            Publish directions to students
                          </label>
                        </div>
                      </div>

                      {/* Quick Insert Multilingual Templates */}
                      <div className="mt-5 border-t border-slate-100 pt-4">
                        <div className="text-xs font-semibold text-slate-700">
                          Quick-Insert Instruction Step (editable in Kannada, English &amp; Hindi):
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {STEP_TEMPLATES.map((tpl) => (
                            <button
                              key={tpl.label}
                              type="button"
                              onClick={() => addStepFromTemplate(tpl)}
                              className="min-h-[36px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:border-blue-700 hover:bg-blue-50 hover:text-blue-700 whitespace-nowrap"
                            >
                              {tpl.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={addBlankStep}
                            className="min-h-[36px] rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-700 hover:text-blue-700 whitespace-nowrap"
                          >
                            + Custom Step
                          </button>
                        </div>
                      </div>

                      {/* Step Sequence & Multilingual Editor */}
                      <div className="mt-5 space-y-4">
                        {routeSteps.length === 0 ? (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                            No walking steps added yet. Use the instruction buttons above to build
                            the route in Kannada, English, and Hindi.
                          </div>
                        ) : (
                          routeSteps.map((step, index) => (
                            <div
                              key={index}
                              className="rounded-lg border border-slate-200 bg-slate-50/70 p-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-700 font-mono text-xs font-bold text-white tabular-nums">
                                    {index + 1}
                                  </span>
                                  <select
                                    value={step.action_type}
                                    onChange={(e) =>
                                      updateStepField(index, 'action_type', e.target.value)
                                    }
                                    aria-label={`Step ${index + 1} instruction type`}
                                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                                  >
                                    <option value="start">Start Greeting</option>
                                    <option value="straight">Walk Straight</option>
                                    <option value="left">Turn Left</option>
                                    <option value="right">Turn Right</option>
                                    <option value="stairs">Staircase</option>
                                    <option value="floor_change">Floor Change</option>
                                    <option value="destination">Destination Reached</option>
                                    <option value="custom">Custom Instruction</option>
                                  </select>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => moveStep(index, -1)}
                                    disabled={index === 0}
                                    aria-label={`Move step ${index + 1} up`}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                                  >
                                    <ArrowUp className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveStep(index, 1)}
                                    disabled={index === routeSteps.length - 1}
                                    aria-label={`Move step ${index + 1} down`}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                                  >
                                    <ArrowDown className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeStep(index)}
                                    aria-label={`Remove step ${index + 1}`}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                                <div>
                                  <label className="block text-xs font-medium text-slate-700">
                                    Kannada – ಕನ್ನಡ *
                                  </label>
                                  <textarea
                                    required
                                    rows={2}
                                    value={step.instruction_kn}
                                    onChange={(e) =>
                                      updateStepField(index, 'instruction_kn', e.target.value)
                                    }
                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                                  />
                                </div>

                                <div>
                                  <label className="block text-xs font-medium text-slate-700">
                                    English *
                                  </label>
                                  <textarea
                                    required
                                    rows={2}
                                    value={step.instruction_en}
                                    onChange={(e) =>
                                      updateStepField(index, 'instruction_en', e.target.value)
                                    }
                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                                  />
                                </div>

                                <div>
                                  <label className="block text-xs font-medium text-slate-700">
                                    Hindi – हिन्दी *
                                  </label>
                                  <textarea
                                    required
                                    rows={2}
                                    value={step.instruction_hi}
                                    onChange={(e) =>
                                      updateStepField(index, 'instruction_hi', e.target.value)
                                    }
                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                                  />
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
                        <button
                          type="submit"
                          disabled={savingRoute || routeSteps.length === 0}
                          className="min-h-[44px] rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                        >
                          {savingRoute ? 'Saving...' : 'Save Route & Instructions'}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              )}
            </section>
          )}

          {/* ==================== VOICE DIRECTION MANAGEMENT ==================== */}
          {tab === 'voice' && (
            <VoiceDirectionManager
              token={token}
              rooms={rooms}
              floors={floors}
              onDataChanged={fetchAllAdminData}
              onVoiceSettingsUpdated={onVoiceSettingsUpdated}
            />
          )}
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmState?.open)}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        busy={deleting}
        onCancel={() => setConfirmState(null)}
        onConfirm={async () => {
          if (!confirmState) return;
          setDeleting(true);
          try {
            await confirmState.onConfirm();
          } finally {
            setDeleting(false);
            setConfirmState(null);
          }
        }}
      />
    </main>
  );
}
