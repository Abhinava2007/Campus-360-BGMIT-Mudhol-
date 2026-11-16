import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigation, Search, X } from 'lucide-react';
import { DirectionPanel } from './DirectionPanel.tsx';
import type { LanguageCode, Room, RoomWithDirections, VoiceSettings } from '../types.ts';

interface StudentHomeProps {
  language: LanguageCode;
  voiceSettings: VoiceSettings;
  onLanguageChange: (lang: LanguageCode) => void;
}

const SEARCH_PLACEHOLDERS: Record<LanguageCode, string> = {
  en: 'Search room, room number, department, floor, or facility...',
  kn: 'ಕೊಠಡಿ, ಕೊಠಡಿ ಸಂಖ್ಯೆ, ವಿಭಾಗ, ಮಹಡಿ ಅಥವಾ ಸೌಲಭ್ಯವನ್ನು ಹುಡುಕಿ...',
  hi: 'कमरा, कमरा संख्या, विभाग, मंजिल या सुविधा खोजें...',
};

export function StudentHome({ language, voiceSettings, onLanguageChange }: StudentHomeProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<RoomWithDirections | null>(null);
  const [loadingDirections, setLoadingDirections] = useState(false);
  const [directionsError, setDirectionsError] = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    setLoadingRooms(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) throw new Error('Failed to load campus locations.');
      const data = (await res.json()) as { rooms: Room[] };
      setRooms(data.rooms);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load campus locations.');
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const filteredRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((room) => {
      return (
        room.name.toLowerCase().includes(q) ||
        room.room_number.toLowerCase().includes(q) ||
        (room.department_name && room.department_name.toLowerCase().includes(q)) ||
        (room.department_code && room.department_code.toLowerCase().includes(q)) ||
        room.floor_name.toLowerCase().includes(q) ||
        `floor ${room.floor_number}`.includes(q) ||
        room.category.toLowerCase().includes(q) ||
        room.description.toLowerCase().includes(q)
      );
    });
  }, [rooms, query]);

  const suggestions = useMemo(() => {
    return rooms.slice(0, 6);
  }, [rooms]);

  const handleOpenDirections = async (roomId: number) => {
    setLoadingDirections(true);
    setDirectionsError(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}`);
      if (!res.ok) throw new Error('Failed to load directions for this location.');
      const data = (await res.json()) as { room: RoomWithDirections };
      setSelectedRoom(data.room);
    } catch (err) {
      setDirectionsError(err instanceof Error ? err.message : 'Unable to load directions.');
    } finally {
      setLoadingDirections(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div
        className={
          selectedRoom
            ? 'grid grid-cols-1 items-start gap-6 lg:grid-cols-12'
            : 'mx-auto max-w-3xl'
        }
      >
        {/* Search & Results Column (hidden on mobile when viewing directions) */}
        <div
          className={`${selectedRoom ? 'hidden lg:col-span-5 lg:block' : 'block'}`}
        >
          <div className="mb-5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              BGMIT Mudhol Campus Navigation
            </h1>
          </div>

          {/* Large Search Bar */}
          <div className="relative">
            <label htmlFor="campus-search-input" className="sr-only">
              Search campus rooms and departments
            </label>
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="campus-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={SEARCH_PLACEHOLDERS[language]}
              autoComplete="off"
              className="w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-12 pr-11 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-2 focus:outline-blue-700/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Search Suggestions */}
          {suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Suggestions:</span>
              {suggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setQuery(item.name);
                  }}
                  className="min-h-[34px] rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-blue-700 hover:text-blue-700 whitespace-nowrap shrink-0"
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}

          {/* Error / Loading / Matching Results */}
          <div className="mt-5">
            {loadingRooms ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
                Loading campus directory...
              </div>
            ) : loadError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {loadError}
              </div>
            ) : filteredRooms.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
                No matching rooms, departments, or facilities found for "{query}".
              </div>
            ) : (
              <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {filteredRooms.map((room) => {
                  const isSelected = selectedRoom?.id === room.id;
                  return (
                    <li
                      key={room.id}
                      className={`flex items-center justify-between gap-4 px-4 py-3.5 transition-colors ${
                        isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 sm:text-base">
                          {room.name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-600">
                          <span className="font-mono font-medium text-slate-800 tabular-nums">
                            {room.room_number}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{room.floor_name}</span>
                          {room.department_name && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{room.department_name}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>{room.category}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleOpenDirections(room.id)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold tracking-wide text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0"
                      >
                        <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
                        DIRECTIONS
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Directions Column */}
        {selectedRoom && (
          <div className="lg:col-span-7">
            {loadingDirections ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
                Loading directions...
              </div>
            ) : directionsError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {directionsError}
              </div>
            ) : (
              <DirectionPanel
                room={selectedRoom}
                language={language}
                voiceSettings={voiceSettings}
                onLanguageChange={onLanguageChange}
                onBack={() => setSelectedRoom(null)}
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
