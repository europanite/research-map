/** The free mode never writes paper data or user API keys to the application server. */
const DB_NAME = 'research-map-browser-v1';
const DB_VERSION = 1;
type Store = 'maps' | 'searches';
const memory = new Map<string, unknown>();
let dbConnection: Promise<IDBDatabase | null> | undefined;

function connect(): Promise<IDBDatabase | null> {
  if (!dbConnection) {
    dbConnection = new Promise(resolve => {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('maps')) db.createObjectStore('maps');
          if (!db.objectStoreNames.contains('searches')) db.createObjectStore('searches');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbConnection;
}
export async function readLocal<T>(store: Store, key: string): Promise<T | undefined> {
  const db = await connect();
  if (!db) return memory.get(`${store}:${key}`) as T | undefined;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(store, 'readonly');
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
export async function writeLocal(store: Store, key: string, value: unknown): Promise<void> {
  const db = await connect();
  if (!db) { memory.set(`${store}:${key}`, value); return; }
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('IndexedDBへの保存に失敗しました。容量やブラウザ設定を確認してください。'));
      tx.onabort = () => reject(new Error('IndexedDBの書き込みが中断されました。'));
    } catch (error) { reject(error); }
  });
}
