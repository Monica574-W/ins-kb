// 資料庫快取（離線時由 Service Worker 回傳上次的 /api/library）
import { api } from './util.js';

let lib = null, pending = null;
export async function getLibrary(force = false) {
  if (lib && !force) return lib;
  if (!pending) pending = api('/api/library').then(v => (lib = Array.isArray(v) ? v : [])).finally(() => { pending = null; });
  return pending;
}
export async function getDoc(id) {
  const l = await getLibrary();
  return l.find(d => d.id === id) || null;
}
export function invalidateLibrary() { lib = null; }
