// S742i: the second move when nobody can book. Agile ran ten days with four
// live rentals, 116 waiting renters and no viewing time, while Today said the
// right thing and offered only a form. These presets open sensible windows in
// one tap from the Today card; the existing "new viewing times opened" sweep
// then emails every waiting renter whose building has a time (lib/availability-reopen).
// Pure.

export type PresetWindow = { weekday: number; start_minute: number; end_minute: number };

export const VIEWING_PRESETS = [
  {
    key: "weekday_evenings",
    label: "Weekday evenings",
    detail: "Monday to Friday, 5 to 7 pm",
    windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 17 * 60, end_minute: 19 * 60 })),
  },
  {
    key: "weekday_daytime",
    label: "Weekdays in the day",
    detail: "Monday to Friday, 10 am to 4 pm",
    windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 10 * 60, end_minute: 16 * 60 })),
  },
  {
    key: "saturday_mornings",
    label: "Saturday mornings",
    detail: "Saturday, 10 am to 1 pm",
    windows: [{ weekday: 6, start_minute: 10 * 60, end_minute: 13 * 60 }],
  },
] as const;

export type ViewingPresetKey = (typeof VIEWING_PRESETS)[number]["key"];

export function isViewingPresetKey(v: unknown): v is ViewingPresetKey {
  return VIEWING_PRESETS.some((p) => p.key === v);
}

export function viewingPreset(key: ViewingPresetKey) {
  return VIEWING_PRESETS.find((p) => p.key === key)!;
}

/**
 * The preset's windows minus any that already overlap an existing weekly
 * window on the same weekday (the landlord may have one Tuesday open). Pure.
 */
export function presetWindowsToAdd(key: ViewingPresetKey, existing: PresetWindow[]): PresetWindow[] {
  return viewingPreset(key).windows.filter(
    (w) => !existing.some((e) => e.weekday === w.weekday && e.start_minute < w.end_minute && e.end_minute > w.start_minute),
  );
}

/** What Today says after a preset opened. Pure. */
export function presetOpenedNotice(key: string | null | undefined, added: number | null): string | null {
  if (!isViewingPresetKey(key)) return null;
  const p = viewingPreset(key);
  if (added === 0) return `${p.label} were already open (${p.detail}). Nothing changed.`;
  return `${p.label} are open (${p.detail}). Renters waiting on a rental in a building that shows on those days get an email with the new times within 15 minutes.`;
}
