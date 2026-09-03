/* IndexedDB persistence used by the browser-only fallback. */
(() => {
  const DB_NAME = "MYP";
  const DB_VERSION = 1;
  const PROMPT_STORE = "prompts";
  const IMAGE_STORE = "images";
  const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
  let database = null;

  function openDatabase() {
    if (database) return Promise.resolve(database);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const nextDatabase = event.target.result;
        if (!nextDatabase.objectStoreNames.contains(PROMPT_STORE)) {
          nextDatabase.createObjectStore(PROMPT_STORE, { keyPath: "id" });
        }
        if (!nextDatabase.objectStoreNames.contains(IMAGE_STORE)) {
          nextDatabase.createObjectStore(IMAGE_STORE);
        }
      };
      request.onsuccess = (event) => {
        database = event.target.result;
        resolve(database);
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async function getAllPrompts() {
    const nextDatabase = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = nextDatabase
        .transaction(PROMPT_STORE, "readonly")
        .objectStore(PROMPT_STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function replaceAllPrompts(data) {
    const nextDatabase = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = nextDatabase.transaction(PROMPT_STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(
          transaction.error ||
            new Error("IndexedDB prompt transaction aborted."),
        );
      const store = transaction.objectStore(PROMPT_STORE);
      store.clear();
      data.forEach((prompt) => store.put(prompt));
    });
  }

  function referencedImages(prompts) {
    const references = new Set();
    const add = (value) => {
      if (typeof value === "string" && value) references.add(value);
    };
    prompts.forEach((prompt) => {
      add(prompt?.image);
      (Array.isArray(prompt?.images) ? prompt.images : []).forEach(add);
      (Array.isArray(prompt?.sourceImages) ? prompt.sourceImages : []).forEach(
        add,
      );
    });
    return references;
  }

  async function commitPromptTransaction(data, deleteImages = []) {
    const nextDatabase = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = nextDatabase.transaction(
        [PROMPT_STORE, IMAGE_STORE],
        "readwrite",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(
          transaction.error || new Error("IndexedDB data transaction aborted."),
        );

      const promptStore = transaction.objectStore(PROMPT_STORE);
      const imageStore = transaction.objectStore(IMAGE_STORE);
      promptStore.clear();
      data.forEach((prompt) => promptStore.put(prompt));
      const references = referencedImages(data);
      [...new Set(deleteImages.filter(isLocalImage))]
        .filter((key) => !references.has(key))
        .forEach((key) => imageStore.delete(key));
    });
  }

  async function putImage(key, value) {
    const nextDatabase = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = nextDatabase.transaction(IMAGE_STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(
          transaction.error ||
            new Error("IndexedDB image transaction aborted."),
        );
      transaction.objectStore(IMAGE_STORE).put(value, key);
    });
  }

  async function getImage(key) {
    const nextDatabase = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = nextDatabase
        .transaction(IMAGE_STORE, "readonly")
        .objectStore(IMAGE_STORE)
        .get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteImage(key) {
    const nextDatabase = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = nextDatabase.transaction(
        [PROMPT_STORE, IMAGE_STORE],
        "readwrite",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(
          transaction.error ||
            new Error("IndexedDB image transaction aborted."),
        );
      const promptRequest = transaction.objectStore(PROMPT_STORE).getAll();
      promptRequest.onsuccess = () => {
        if (!referencedImages(promptRequest.result || []).has(key)) {
          transaction.objectStore(IMAGE_STORE).delete(key);
        }
      };
    });
  }

  const isLocalImage = (value) =>
    typeof value === "string" && value.startsWith("local:");

  window.MYPStorage = Object.freeze({
    MAX_IMAGE_BYTES,
    getAllPrompts,
    replaceAllPrompts,
    commitPromptTransaction,
    putImage,
    getImage,
    deleteImage,
    isLocalImage,
  });
})();
