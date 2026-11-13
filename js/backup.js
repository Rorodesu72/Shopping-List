// 備份與還原。檔案是單一 JSON，照片以 base64 內嵌。
import { DATA_STORES, OPTIONAL_STORES, PHOTO_STORE, getAll, getMeta, replaceAll, setMeta } from './db.js';

const APP_ID = 'travel-shopping-list';
const FORMAT_VERSION = 1;
const BASE64_OVERHEAD = 1.37;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, type = 'image/jpeg') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function readData() {
  const data = {};
  for (const name of DATA_STORES) data[name] = await getAll(name);
  return data;
}

async function buildBackup(includePhotos) {
  const backup = {
    app: APP_ID,
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    includesPhotos: includePhotos,
    activeTripId: await getMeta('activeTripId'),
    data: await readData(),
    photos: [],
  };
  if (includePhotos) {
    for (const photo of await getAll(PHOTO_STORE)) {
      backup.photos.push({
        id: photo.id,
        createdAt: photo.createdAt,
        full: await blobToBase64(photo.full),
        thumb: await blobToBase64(photo.thumb),
      });
    }
  }
  return backup;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function backupFileName(date = new Date(), includePhotos = true) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `購物清單備份_${stamp}${includePhotos ? '' : '_文字'}.json`;
}

export async function createBackupFile(includePhotos) {
  const backup = await buildBackup(includePhotos);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  return new File([blob], backupFileName(new Date(), includePhotos), { type: 'application/json' });
}

export async function estimateBackupSize() {
  const data = await readData();
  const textBytes = new Blob([JSON.stringify(data)]).size;
  const photos = await getAll(PHOTO_STORE);
  const photoBytes = photos.reduce((sum, p) => sum + p.full.size + p.thumb.size, 0);
  return { textBytes, fullBytes: textBytes + Math.round(photoBytes * BASE64_OVERHEAD), photoCount: photos.length };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function markBackedUp(includePhotos) {
  await setMeta('lastBackupAt', new Date().toISOString());
  await setMeta('changesSinceBackup', 0);
  if (includePhotos) await setMeta('photoChangesSinceFull', 0);
}

// 先完整檢查，檔案有問題就在這裡丟出錯誤，不會碰到現有資料。
export function parseBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('這個檔案無法讀取，可能已損壞或不完整。請改選另一份備份。');
  }
  if (backup?.app !== APP_ID) throw new Error('這不是購物清單的備份檔，請重新選擇。');
  if (backup.formatVersion > FORMAT_VERSION) throw new Error('這份備份來自較新的版本，請先更新 App 再匯入。');
  for (const name of DATA_STORES) {
    if (OPTIONAL_STORES.includes(name) && backup.data && backup.data[name] === undefined) backup.data[name] = [];
    if (!Array.isArray(backup.data?.[name]) || backup.data[name].some((row) => !row?.id)) {
      throw new Error('備份內容不完整，無法匯入。請改選另一份備份。');
    }
  }
  if (!Array.isArray(backup.photos) || backup.photos.some((p) => !p?.id || !p.full || !p.thumb)) {
    throw new Error('備份裡的照片不完整，無法匯入。請改選另一份備份。');
  }
  const photos = backup.photos.map((p) => {
    try {
      return { id: p.id, createdAt: p.createdAt, full: base64ToBlob(p.full), thumb: base64ToBlob(p.thumb) };
    } catch {
      throw new Error('備份裡的照片已損壞，無法匯入。請改選另一份備份。');
    }
  });
  return {
    exportedAt: backup.exportedAt,
    includesPhotos: Boolean(backup.includesPhotos),
    activeTripId: backup.activeTripId,
    data: backup.data,
    photos,
    summary: {
      trips: backup.data.trips.length,
      items: backup.data.items.length,
      photos: photos.length,
    },
  };
}

async function saveSafetyCopy() {
  const data = await readData();
  const photos = await getAll(PHOTO_STORE);
  await setMeta('safetyCopy', { savedAt: new Date().toISOString(), activeTripId: await getMeta('activeTripId'), data, photos });
}

// 文字備份不含照片：還原時保留手機上現有的照片，品項才不會失去圖片。
export async function applyBackup(parsed) {
  await saveSafetyCopy();
  const stores = { ...parsed.data };
  if (parsed.includesPhotos) stores[PHOTO_STORE] = parsed.photos;
  await replaceAll(stores);
  await setMeta('activeTripId', parsed.activeTripId ?? parsed.data.trips[0]?.id ?? null);
  await setMeta('changesSinceBackup', 0);
  await setMeta('photoChangesSinceFull', 0);
}

export async function undoImport() {
  const copy = await getMeta('safetyCopy');
  if (!copy) return false;
  await replaceAll({ ...copy.data, [PHOTO_STORE]: copy.photos });
  await setMeta('activeTripId', copy.activeTripId);
  await setMeta('safetyCopy', null);
  await setMeta('changesSinceBackup', 1);
  return true;
}
