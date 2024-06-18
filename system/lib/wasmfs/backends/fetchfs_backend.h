#include <vector>

#include <emscripten/proxying.h>

#include "backend.h"

using namespace wasmfs;

extern "C" {

// Ensure that the root OPFS directory is initialized with ID 0.
int _wasmfs_fetchfs_init_root_directory(em_proxying_ctx* ctx, 
                                        const char* base_url);

// Look up the child under `parent` with `name`. Write 1 to `child_type` if it's
// a regular file or 2 if it's a directory. Write the child's file or directory
// ID to `child_id`, or -1 if the child does not exist, or -2 if the child
// exists but cannot be opened.
void _wasmfs_fetchfs_get_child(em_proxying_ctx* ctx,
                            int parent,
                            const char* name,
                            int* child_type,
                            int* child_id);

void _wasmfs_fetchfs_get_entries(em_proxying_ctx* ctx,
                              int dirID,
                              std::vector<Directory::Entry>* entries,
                              int* err);

void _wasmfs_fetchfs_free_handle(int handle_id);

int _wasmfs_fetchfs_read_handle(em_proxying_ctx* ctx,
                           int file_id,
                           uint8_t* buf,
                           uint32_t len,
                           off_t pos,
                           int32_t* nread);

void _wasmfs_fetchfs_get_size_handle(em_proxying_ctx* ctx, int file_id, off_t* size);

} // extern "C"
