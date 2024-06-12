/**
 * @license
 * Copyright 2023 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

addToLibrary({
  $ExternalFS__deps: [
    'wasmfs_create_externalfs_backend', 
    '_wasmfs_externalfs_get_object_store', '_wasmfs_externalfs_key_exists',
    '_wasmfs_externalfs_get_key', '_wasmfs_externalfs_delete_key'
  ],
  $ExternalFS: {
    createBackend(opts) {
      return _wasmfs_create_externalfs_backend();
    },
    addDirectory: async function(handle) {
      if (!(handle instanceof FileSystemDirectoryHandle))
        return null;
      const store = await __wasmfs_externalfs_get_object_store();
      if (await __wasmfs_externalfs_key_exists(store, handle.name))
        await __wasmfs_externalfs_delete_key(store, handle.name);
    
      return new Promise(async (resolve, reject) => {
        const writeReq = store.add(handle, handle.name);
        writeReq.onerror = reject;
        writeReq.onsuccess = (event) => resolve(event.target.result);
      });
    },
    getAllStoredHandles: async function() {
      const store = await __wasmfs_externalfs_get_object_store();
      return new Promise(async (resolve, reject) => {
        const getAllReq = store.getAll();
        getAllReq.onerror = reject;
        getAllReq.onsuccess = (event) => resolve(event.target.result);
      });
    },
    permitHandle: async function(handle) {
      const permission = await handle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') {
        const newPermission = await handle.requestPermission({ mode: 'read' });
        if (newPermission !== 'granted')
          return false;
      }

      return true;
    },
    getHandle: async function(directoryName) {
      const store = await __wasmfs_externalfs_get_object_store();
      const handle = await __wasmfs_externalfs_get_key(store, directoryName);
      if (!handle) return null;
      const permission = await this.permitHandle(handle);
      return permission ? handle : null;
    },
    removeHandle: async function(directoryName) {
      const store = await __wasmfs_externalfs_get_object_store();
      return __wasmfs_externalfs_delete_key(store, directoryName);
    },
  },
});

if (!WASMFS) {
  error("using -lexternalfs.js requires using WasmFS (-sWASMFS)");
}
