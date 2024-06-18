addToLibrary({
  $wasmfsFetchFSHandles__deps: ['$HandleAllocator'],
  $wasmfsFetchFSHandles: "new HandleAllocator()",
  $wasmfsFetchFSBlobs__deps: ["$HandleAllocator"],
  $wasmfsFetchFSBlobs: "new HandleAllocator()",

  $wasmfsFetchFSProxyFinish__deps: ['emscripten_proxy_finish'],
  $wasmfsFetchFSProxyFinish: (ctx) => {
    // When using pthreads the proxy needs to know when the work is finished.
    // When used with JSPI the work will be executed in an async block so there
    // is no need to notify when done.
    _emscripten_proxy_finish(ctx);
  },

  _wasmfs_fetchfs_init_root_directory__deps: [
    '$wasmfsFetchFSHandles', '$wasmfsFetchFSProxyFinish',
  ],
  _wasmfs_fetchfs_init_root_directory: async function(ctx, baseUrlPtr) {
    // Closure compiler errors on this as it does not recognize the OPFS
    // API yet, it seems. Unfortunately an existing annotation for this is in
    // the closure compiler codebase, and cannot be overridden in user code
    // (it complains on a duplicate type annotation), so just suppress it.
    /** @suppress {checkTypes} */

    // allocated.length starts off as 1 since 0 is a reserved handle
    if (wasmfsFetchFSHandles.allocated.length !== 1) 
      return wasmfsFetchFSProxyFinish(ctx);

    let baseUrl = UTF8ToString(baseUrlPtr);

    wasmfsFetchFSHandles.allocated.push({
      parent: null,
      name: null,
      url: baseUrl,
      children: {},
    });

    wasmfsFetchFSProxyFinish(ctx);
  },

  // Return the file ID for the file with `name` under `parent`, creating it if
  // it doesn't exist and `create` or otherwise return a negative error code
  // corresponding to the error.
  $wasmfsFetchFSGetOrCreateFile__deps: ['$wasmfsFetchFSHandles'],
  $wasmfsFetchFSGetOrCreateFile: async function(parent, name) {
    let parentHandle = wasmfsFetchFSHandles.get(parent);
    if (!parentHandle) 
      return -{{{ cDefs.EEXIST }}};
    if (!parentHandle.children)
      return -{{{ cDefs.ENOTDIR }}};

    let fileId = parentHandle.children[name];
    if (fileId === undefined) {
      let url = parentHandle.url + "/" + name;
      let headers;
      try {
        let res = await fetch(url, { method: 'HEAD' });
        if (!res.ok)
          return -{{{ cDefs.ENOENT }}};
        headers = res.headers;
      } catch(e) {
        return -{{{ cDefs.EIO }}};
      }

      fileId = wasmfsFetchFSHandles.allocate({
        parent, name, url, headers,
        children: null,
      });

      parentHandle.children[name] = fileId;
    } else {
      let fileHandle = wasmfsFetchFSHandles.get(fileId);
      if (!fileHandle) 
        return -{{{ cDefs.EEXIST }}};
      if (fileHandle.children)
        return -{{{ cDefs.EISDIR }}};
    }

    return fileId;
  },

  // Return the file ID for the directory with `name` under `parent`, creating
  // it if it doesn't exist and `create` or otherwise return a negative error
  // code corresponding to the error.
  $wasmfsFetchFSGetOrCreateDir__deps: ['$wasmfsFetchFSHandles'],
  $wasmfsFetchFSGetOrCreateDir: async function(parent, name) {
    let parentHandle = wasmfsFetchFSHandles.get(parent);
    if (!parentHandle) 
      return -{{{ cDefs.EEXIST }}};
    if (!parentHandle.children)
      return -{{{ cDefs.ENOTDIR }}};

    let dirId = parentHandle.children[name];
    if (dirId === undefined) {
      dirId = wasmfsFetchFSHandles.allocate({
        parent, name,
        url: parentHandle.url + "/" + name,
        headers: null,
        children: {},
      });
    }

    return dirId;
  },

  _wasmfs_fetchfs_get_child__deps: ['$wasmfsFetchFSGetOrCreateFile',
                                 '$wasmfsFetchFSGetOrCreateDir', '$wasmfsFetchFSProxyFinish'],
  _wasmfs_fetchfs_get_child:
      async function(ctx, parent, namePtr, childTypePtr, childIDPtr) {
    if (!wasmfsFetchFSHandles.allocated[parent]) {
      let childID = -1;
      {{{ makeSetValue('childIDPtr', 0, 'childID', 'i32') }}};
      return wasmfsFetchFSProxyFinish(ctx);
    }
    let name = UTF8ToString(namePtr);
    let childType = 1;
    let childID = await wasmfsFetchFSGetOrCreateFile(parent, name, false);
    if (childID == -{{{ cDefs.EISDIR }}}) {
      childType = 2;
      childID = await wasmfsFetchFSGetOrCreateDir(parent, name, false);
    }
    {{{ makeSetValue('childTypePtr', 0, 'childType', 'i32') }}};
    {{{ makeSetValue('childIDPtr', 0, 'childID', 'i32') }}};
    wasmfsFetchFSProxyFinish(ctx);
  },

  _wasmfs_fetchfs_get_entries__deps: ['$wasmfsFetchFSProxyFinish'],
  _wasmfs_fetchfs_get_entries: async function(ctx, dirID, entriesPtr, errPtr) {
    let err = -{{{ cDefs.EIO }}};

    let dirHandle = wasmfsFetchFSHandles.get(dirID);
    if (!dirHandle) {
      {{{ makeSetValue('errPtr', 0, 'err', 'i32') }}};
      return wasmfsFetchFSProxyFinish(ctx);
    }
    if (!dirHandle.children) {
      err = -{{{ cDefs.ENOTDIR }}};
      {{{ makeSetValue('errPtr', 0, 'err', 'i32') }}};
      return wasmfsFetchFSProxyFinish(ctx);
    }

    for (let name in dirHandle.children) {
      let childId = dirHandle.children[name];
      let childHandle = wasmfsFetchFSHandles.get(childId);
      if (!childHandle) {
        {{{ makeSetValue('errPtr', 0, 'err', 'i32') }}};
        return wasmfsFetchFSProxyFinish(ctx);
      }

      let sp = stackSave();
      let namePtr = stringToUTF8OnStack(childHandle.name);
      let type = childHandle.children ?
        {{{ cDefine('File::DirectoryKind') }}} :
      {{{ cDefine('File::DataFileKind') }}};
        __wasmfs_fetchfs_record_entry(entriesPtr, namePtr, type)
      stackRestore(sp);
    }
    
    wasmfsFetchFSProxyFinish(ctx);
  },

  _wasmfs_fetchfs_free_handle__deps: ['$wasmfsFetchFSHandles'],
  _wasmfs_fetchfs_free_handle: (handleID) => {
    wasmfsFetchFSHandles.free(handleID);
  },

  _wasmfs_fetchfs_read_handle__deps: ['$wasmfsFetchFSHandles', '$wasmfsFetchFSProxyFinish'],
  _wasmfs_fetchfs_read_handle: async function(ctx, handleID, bufPtr, len, {{{ defineI64Param('pos') }}}, nreadPtr) {
    {{{ receiveI64ParamAsI53('pos', '', false) }}}

    let handle = wasmfsFetchFSHandles.get(handleID);
    let i53pos = Number(pos);
    let nread = 0;

    let acceptRange = handle.headers.get('Accept-Ranges') === 'bytes';

    try {
      // TODO: Use ReadableStreamBYOBReader once
      // https://bugs.chromium.org/p/chromium/issues/detail?id=1189621 is
      // resolved.
      let buf = await (acceptRange
        ? fetch(handle.url, { headers: { 'Range': `bytes=${i53pos}-${i53pos + len - 1}` } })
          .then(res => res.arrayBuffer())
        : fetch(handle.url).then(res => res.blob())
          .then(blob => blob.slice(i53pos, i53pos + len).arrayBuffer())
      );
      let data = new Uint8Array(buf);
      HEAPU8.set(data, bufPtr);
      nread += data.length;
    } catch (e) {
      if (e instanceof RangeError) {
        nread = -{{{ cDefs.EFAULT }}};
      } else {
#if ASSERTIONS
        err('unexpected error:', e, e.stack);
#endif
        nread = -{{{ cDefs.EIO }}};
      }
    }

    {{{ makeSetValue('nreadPtr', 0, 'nread', 'i32') }}};
    wasmfsFetchFSProxyFinish(ctx);
  },

  _wasmfs_fetchfs_get_size_handle__deps: ['$wasmfsFetchFSHandles', '$wasmfsFetchFSProxyFinish'],
  _wasmfs_fetchfs_get_size_handle: async function(ctx, fileID, sizePtr) {
    let size = -{{{ cDefs.EIO }}};

    let fileHandle = wasmfsFetchFSHandles.get(fileID);
    if (!fileHandle) {
      size = -{{{ cDefs.EEXIST }}};
      {{{ makeSetValue('sizePtr', 0, 'size', 'i64') }}};
      return wasmfsFetchFSProxyFinish(ctx);
    }

    if (fileHandle.children) {
      size = -{{{ cDefs.EISDIR }}};
      {{{ makeSetValue('sizePtr', 0, 'size', 'i64') }}};
      return wasmfsFetchFSProxyFinish(ctx);
    }

    if (!fileHandle.headers) {
      size = -{{{ cDefs.EACCES }}};
      {{{ makeSetValue('sizePtr', 0, 'size', 'i64') }}};
      return wasmfsFetchFSProxyFinish(ctx);
    }

    size = fileHandle.headers.get('Content-Length');
    {{{ makeSetValue('sizePtr', 0, 'size', 'i64') }}};
    wasmfsFetchFSProxyFinish(ctx);
  }
});
