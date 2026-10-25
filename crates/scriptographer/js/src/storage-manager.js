import { defineInterfaces } from './define.js'
import { getDirectoryHandle } from './file-system.js'
import { natives } from './natives.js'

// `navigator.storage` for scripts outside a browser: each script's own folder
// of files, next to its `localStorage`, which the app keeps for it, for the
// File System standard's origin private file system. Its storage is always
// kept, and has no quota but the disk's, which it doesn't tell.

export class StorageManager {
  async estimate() {
    return { usage: natives.fs.usage() }
  }

  async persist() {
    return true
  }

  async persisted() {
    return true
  }

  async getDirectory() {
    const path = natives.fs.privateDirectory()
    if (path === null) {
      throw new DOMException(
        'Unable to get the directory: the script has no storage of its own.',
        'SecurityError'
      )
    }
    return getDirectoryHandle(path)
  }
}

defineInterfaces(StorageManager)
