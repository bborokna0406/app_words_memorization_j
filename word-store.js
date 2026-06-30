(function () {
  "use strict";

  const DATABASE_VERSION = 1;
  const WORDS_STORE = "words";
  const META_STORE = "meta";
  const MIGRATION_KEY = "local-storage-migration-v1";

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
  }

  function transactionResult(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error || new Error("Storage transaction aborted")), { once: true });
      transaction.addEventListener("error", () => reject(transaction.error || new Error("Storage transaction failed")), { once: true });
    });
  }

  window.createWordStore = function createWordStore(options) {
    const databaseName = `${options.storageKey}-indexeddb`;
    let database = null;
    let persistenceRequested = false;
    let writeQueue = Promise.resolve();

    function normalizeStoredItem(item) {
      return options.normalizeItem(item);
    }

    function toDatabaseItem(item, position) {
      const normalized = normalizeStoredItem(item);
      const search = {};
      options.indexFields.forEach((field) => {
        search[field] = options.normalizeForComparison(normalized[field]);
      });
      return { ...normalized, search, position };
    }

    function readLegacyWords() {
      try {
        const saved = localStorage.getItem(options.storageKey);
        if (!saved) return [];
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeStoredItem).filter(options.isValidItem);
      } catch {
        return [];
      }
    }

    function backupLegacyWords(words) {
      try {
        localStorage.setItem(options.storageKey, JSON.stringify(words));
        return true;
      } catch {
        return false;
      }
    }

    function openDatabase() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, DATABASE_VERSION);

        request.addEventListener("upgradeneeded", () => {
          const db = request.result;
          const words = db.objectStoreNames.contains(WORDS_STORE)
            ? request.transaction.objectStore(WORDS_STORE)
            : db.createObjectStore(WORDS_STORE, { keyPath: "id" });

          options.indexFields.forEach((field) => {
            if (!words.indexNames.contains(field)) {
              words.createIndex(field, `search.${field}`, { unique: false });
            }
          });

          if (!db.objectStoreNames.contains(META_STORE)) {
            db.createObjectStore(META_STORE, { keyPath: "key" });
          }
        });

        request.addEventListener("success", () => {
          const db = request.result;
          db.addEventListener("versionchange", () => db.close());
          resolve(db);
        }, { once: true });
        request.addEventListener("blocked", () => reject(new Error("Storage upgrade blocked")), { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
      });
    }

    async function readDatabaseWords() {
      const transaction = database.transaction(WORDS_STORE, "readonly");
      const request = transaction.objectStore(WORDS_STORE).getAll();
      const records = await requestResult(request);
      await transactionResult(transaction);
      return records
        .sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER))
        .map(normalizeStoredItem)
        .filter(options.isValidItem);
    }

    async function readMigrationStatus() {
      const transaction = database.transaction(META_STORE, "readonly");
      const request = transaction.objectStore(META_STORE).get(MIGRATION_KEY);
      const status = await requestResult(request);
      await transactionResult(transaction);
      return status;
    }

    async function markMigrationComplete(itemCount) {
      const transaction = database.transaction(META_STORE, "readwrite");
      transaction.objectStore(META_STORE).put({
        key: MIGRATION_KEY,
        completedAt: Date.now(),
        itemCount,
      });
      await transactionResult(transaction);
    }

    function migrationMatches(expected, actual) {
      if (expected.length !== actual.length) return false;
      const actualById = new Map(actual.map((item) => [item.id, item]));
      return expected.every((item) => {
        const match = actualById.get(item.id);
        return match && JSON.stringify(normalizeStoredItem(match)) === JSON.stringify(normalizeStoredItem(item));
      });
    }

    async function replaceDatabaseWords(words) {
      const snapshot = words.map(normalizeStoredItem).filter(options.isValidItem);
      const transaction = database.transaction(WORDS_STORE, "readwrite");
      const wordStore = transaction.objectStore(WORDS_STORE);
      wordStore.clear();
      snapshot.forEach((item, position) => wordStore.put(toDatabaseItem(item, position)));

      await transactionResult(transaction);
      return snapshot;
    }

    function enqueueWrite(operation) {
      const result = writeQueue.then(operation, operation);
      writeQueue = result.catch(() => {});
      return result;
    }

    async function initialize() {
      const legacyWords = readLegacyWords();

      if (!("indexedDB" in window)) {
        return { words: legacyWords, mode: "localStorage", migrated: false };
      }

      try {
        database = await openDatabase();
        let storedWords = await readDatabaseWords();
        const migrationStatus = await readMigrationStatus();
        let migrated = false;

        if (!migrationStatus) {
          const merged = new Map(legacyWords.map((item) => [item.id, item]));
          storedWords.forEach((item) => merged.set(item.id, item));
          storedWords = await replaceDatabaseWords(Array.from(merged.values()));
          const verifiedWords = await readDatabaseWords();
          if (!migrationMatches(storedWords, verifiedWords)) {
            throw new Error("Storage migration verification failed");
          }
          await markMigrationComplete(verifiedWords.length);
          storedWords = verifiedWords;
          migrated = legacyWords.length > 0;
        }

        return { words: storedWords, mode: "indexedDB", migrated };
      } catch {
        if (database) database.close();
        database = null;
        return { words: legacyWords, mode: "localStorage", migrated: false };
      }
    }

    function replaceAll(words) {
      const snapshot = words.map(normalizeStoredItem).filter(options.isValidItem);
      return enqueueWrite(async () => {
        if (database) {
          await replaceDatabaseWords(snapshot);
          backupLegacyWords(snapshot);
          return;
        }

        if (!backupLegacyWords(snapshot)) {
          throw new Error("Browser storage is full");
        }
      });
    }

    async function requestPersistence() {
      if (persistenceRequested) return;
      persistenceRequested = true;
      if (navigator.storage && typeof navigator.storage.persist === "function") {
        try {
          await navigator.storage.persist();
        } catch {
          // Storage still works when persistence is unavailable or denied.
        }
      }
    }

    return { initialize, replaceAll, requestPersistence };
  };
})();
