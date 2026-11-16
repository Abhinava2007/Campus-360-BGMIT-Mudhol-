export type LanguageCode = 'kn' | 'en' | 'hi';

export type StepActionType =
  | 'start'
  | 'straight'
  | 'left'
  | 'right'
  | 'stairs'
  | 'floor_change'
  | 'destination'
  | 'custom';

export type RoomCategory =
  | 'Department'
  | 'Classroom'
  | 'Laboratory'
  | 'Library'
  | 'HOD Room'
  | 'Staff Room'
  | 'Facility';

export interface Department {
  id: number;
  name: string;
  code: string;
  description: string;
  created_at: string;
}

export interface Floor {
  id: number;
  floor_number: number;
  name: string;
  description: string;
  created_at: string;
}

export interface RouteStep {
  id?: number;
  route_id?: number;
  step_order: number;
  action_type: StepActionType;
  instruction_en: string;
  instruction_kn: string;
  instruction_hi: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface NavigationRoute {
  id: number;
  room_id: number;
  starting_location: string;
  is_active: boolean;
  updated_at: string;
  steps: RouteStep[];
}

export interface VoiceSettings {
  voice_enabled: boolean;
  default_language: LanguageCode;
  voice_speed: number;
  voice_pitch: number;
  updated_at: string;
}

export interface VoiceInstructionRecord {
  id: number;
  route_id: number;
  room_id: number;
  room_name: string;
  room_number: string;
  floor_id: number;
  floor_number: number;
  floor_name: string;
  starting_location: string;
  step_order: number;
  action_type: StepActionType;
  instruction_kn: string;
  instruction_en: string;
  instruction_hi: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: number;
  name: string;
  room_number: string;
  department_id: number | null;
  department_name: string | null;
  department_code: string | null;
  floor_id: number;
  floor_number: number;
  floor_name: string;
  category: RoomCategory;
  description: string;
  is_active: boolean;
  has_route: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoomWithDirections extends Room {
  route: NavigationRoute | null;
}

export interface AdminDashboardStats {
  total_rooms: number;
  active_rooms: number;
  total_departments: number;
  total_floors: number;
  total_routes: number;
  total_voice_instructions: number;
  active_voice_instructions: number;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
}
