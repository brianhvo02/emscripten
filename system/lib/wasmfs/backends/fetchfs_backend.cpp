#include <emscripten/threading.h>
#include <stdlib.h>

#include "backend.h"
#include "file.h"
#include "fetchfs_backend.h"
#include "support.h"
#include "thread_utils.h"
#include "wasmfs.h"

using namespace wasmfs;

namespace {

using ProxyWorker = emscripten::ProxyWorker;
using ProxyingQueue = emscripten::ProxyingQueue;

class Worker {
public:
#ifdef __EMSCRIPTEN_PTHREADS__
  ProxyWorker proxy;

  template<typename T> void operator()(T func) { proxy(func); }
#else
  // When used with JSPI on the main thread the various wasmfs_fetchfs_* functions
  // can be directly executed since they are all async.
  template<typename T> void operator()(T func) {
    if constexpr (std::is_invocable_v<T&, ProxyingQueue::ProxyingCtx>) {
      // TODO: Find a way to remove this, since it's unused.
      ProxyingQueue::ProxyingCtx p;
      func(p);
    } else {
      func();
    }
  }
#endif
};

class FetchFSFile : public DataFile {
public:
  Worker& proxy;
  int fileID;

  FetchFSFile(mode_t mode, backend_t backend, int fileID, Worker& proxy)
    : DataFile(mode, backend), proxy(proxy), fileID(fileID) {}

  ~FetchFSFile() override {
    proxy([&]() { _wasmfs_fetchfs_free_handle(fileID); });
  }

private:
  off_t getSize() override {
    off_t size;
    proxy([&](auto ctx) {
      _wasmfs_fetchfs_get_size_handle(ctx.ctx, fileID, &size);
    });
    return size;
  }

  int setSize(off_t size) override {
    WASMFS_UNREACHABLE("Unexpected open state");
  }

  int open(oflags_t flags) override { return 0; }

  int close() override { return 0; }

  ssize_t read(uint8_t* buf, size_t len, off_t offset) override {
    // TODO: use an i64 here.
    int32_t nread;
    proxy([&](auto ctx) {
      _wasmfs_fetchfs_read_handle(ctx.ctx, fileID, buf, len, offset, &nread);
    });
    return nread;
  }

  ssize_t write(const uint8_t* buf, size_t len, off_t offset) override {
    WASMFS_UNREACHABLE("Unexpected open state");
  }

  int flush() override { return 0; }
};

class FetchFSDirectory : public Directory {
public:
  Worker& proxy;

  // The ID of this directory in the JS library.
  int dirID = 0;

  FetchFSDirectory(mode_t mode, backend_t backend, int dirID, Worker& proxy)
    : Directory(mode, backend), proxy(proxy), dirID(dirID) {}

  ~FetchFSDirectory() override {
    // Never free the root directory ID.
    if (dirID != 0) {
      proxy([&]() { _wasmfs_fetchfs_free_handle(dirID); });
    }
  }

private:
  std::shared_ptr<File> getChild(const std::string& name) override {
    int childType = 0, childID = 0;
    proxy([&](auto ctx) {
      _wasmfs_fetchfs_get_child(
        ctx.ctx, dirID, name.c_str(), &childType, &childID);
    });
    if (childID == -1) {
      WASMFS_UNREACHABLE("No directory mounted.");
    } else if (childID < -1) {
      // TODO: More fine-grained error reporting.
      if (childID == -ENOENT)
        fprintf(stderr, "File %s does not exist\n", name.c_str());
      return NULL;
    }
    if (childType == 1) {
      return std::make_shared<FetchFSFile>(0777, getBackend(), childID, proxy);
    } else if (childType == 2) {
      return std::make_shared<FetchFSDirectory>(
        0777, getBackend(), childID, proxy);
    } else {
      WASMFS_UNREACHABLE("Unexpected child type");
    }
  }

  std::shared_ptr<DataFile> insertDataFile(const std::string& name,
                                           mode_t mode) override {
    return nullptr;
  }

  std::shared_ptr<Directory> insertDirectory(const std::string& name,
                                             mode_t mode) override {
    return nullptr;
  }

  std::shared_ptr<Symlink> insertSymlink(const std::string& name,
                                         const std::string& target) override {
    // Symlinks not supported.
    // TODO: Propagate EPERM specifically.
    return nullptr;
  }

  int insertMove(const std::string& name, std::shared_ptr<File> file) override {
    return -1;
  }

  int removeChild(const std::string& name) override {
    return -1;
  }

  ssize_t getNumEntries() override {
    auto entries = getEntries();
    if (int err = entries.getError()) {
      return err;
    }
    return entries->size();
  }

  Directory::MaybeEntries getEntries() override {
    std::vector<Directory::Entry> entries;
    int err = 0;
    proxy([&](auto ctx) {
      _wasmfs_fetchfs_get_entries(ctx.ctx, dirID, &entries, &err);
    });
    if (err) {
      assert(err < 0);
      if (err == -EACCES)
        fprintf(stderr, "Directory requires read permission\n");
      return {err};
    }
    return {entries};
  }
};

class FetchFSBackend : public Backend {
  std::string directory_name;
  std::string base_url;

public:
  Worker proxy;
  FetchFSBackend(const std::string& base_url): base_url(base_url) {}

  std::shared_ptr<DataFile> createFile(mode_t mode) override {
    // No way to support a raw file without a parent directory.
    // TODO: update the core system to document this as a possible result of
    // `createFile` and to handle it gracefully.
    return nullptr;
  }

  std::shared_ptr<Directory> createDirectory(mode_t mode) override {
    proxy([&](auto ctx) {
      _wasmfs_fetchfs_init_root_directory(ctx.ctx, base_url.c_str());
    });

    return std::make_shared<FetchFSDirectory>(mode, this, 1, proxy);
  }

  std::shared_ptr<Symlink> createSymlink(std::string target) override {
    // Symlinks not supported.
    return nullptr;
  }
};

} // anonymous namespace

extern "C" {

backend_t wasmfs_create_fetchfs_backend(char const *base_url) {
  // ProxyWorker cannot safely be synchronously spawned from the main browser
  // thread. See comment in thread_utils.h for more details.
  assert(
    !emscripten_is_main_browser_thread() &&
      "Cannot safely create FetchFS backend on main browser thread");
  return wasmFS.addBackend(std::make_unique<FetchFSBackend>(base_url));
}

void EMSCRIPTEN_KEEPALIVE _wasmfs_fetchfs_record_entry(
  std::vector<Directory::Entry>* entries, const char* name, int type) {
  entries->push_back({name, File::FileKind(type), 0});
}

} // extern "C"
