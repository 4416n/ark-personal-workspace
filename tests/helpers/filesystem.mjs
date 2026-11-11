import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function assertPosixMode(t, file, expected = 0o600) {
  await t.test(`POSIX mode: ${path.basename(file)}`, {
    skip: process.platform === "win32"
      ? "Windows stat.mode does not represent NTFS ACLs; ACL protection is not tested here"
      : false,
  }, async () => {
    assert.equal((await fs.stat(file)).mode & 0o777, expected);
  });
}

export async function removeTestDirectory(directory) {
  const target = path.resolve(directory);
  const relative = path.relative(path.resolve(os.tmpdir()), target);
  // Only remove one of this suite's direct temporary directories, never a
  // computed parent or arbitrary workspace path. Windows may briefly retain
  // SQLite/browser handles after their owners have finished closing.
  assert.ok(
    /^ark-[^/\\]+$/.test(relative),
    `Refusing to remove a path outside an ark-* test directory: ${target}`,
  );
  await fs.rm(target, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
