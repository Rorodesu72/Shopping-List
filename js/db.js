// IndexedDB 薄封裝。
const DB_NAME = 'travel-shopping-list';
// 版本 2：新增 tasks（行程準備事項）。
const DB_VERSION = 2;

export const DATA_STORES = ['trips', 'products', 'variants', 'items', 'stores', 'priceRecords', 'tasks'];
// 較晚才加入的資料表，舊備份裡沒有時當作空的。
export const OPTIONAL_STORES = ['tasks'];
export const PHOTO_STORE = 'photos';
const META_STORE = 'meta';

let dbPromise;

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        // 只建立還沒有的資料表，從舊版升級時原有資料不受影響。
        for (const name of [...DATA_STORES, PHOTO_STORE]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        // 新版要升級資料庫時，舊版頁面先放手，避免卡住。
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function getAll(name) {
  return promisify((await store(name)).getAll());
}

export async function get(name, id) {
  return promisify((await store(name)).get(id));
}

export async function put(name, value) {
  return promisify((await store(name, 'readwrite')).put(value));
}

export async function remove(name, id) {
  return promisify((await store(name, 'readwrite')).delete(id));
}

export async function getMeta(key, fallback = null) {
  const row = await get(META_STORE, key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  return put(META_STORE, { key, value });
}

// 在單一交易內整批取代，任何一步失敗都不會留下半套資料。
export async function replaceAll(dataByStore) {
  const db = await open();
  const names = Object.keys(dataByStore);
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) {
    const objectStore = tx.objectStore(name);
    objectStore.clear();
    for (const row of dataByStore[name]) objectStore.put(row);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
