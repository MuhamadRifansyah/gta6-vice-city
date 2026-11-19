// Solmar Bay — save / load through localStorage. Money, mission progress and
// Rico's position survive between visits; a missing or corrupt save is ignored.
const SAVE_KEY = 'solmar-bay-save-v1';

export function saveGameData(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
export function loadGameData() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    return data;
  } catch {
    return null;
  }
}
export function hasSave() { return loadGameData() !== null; }
export function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
