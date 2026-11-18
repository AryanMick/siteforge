import { rename } from 'node:fs/promises';

// Atomic file replacement. On Windows a rename onto a file that another process has open (the app reading a status
// file while a worker rewrites it) fails with EPERM, EACCES or EBUSY for a moment; retry briefly instead of failing.
export async function replaceFile(from, to, { attempts = 40 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await rename(from, to); }
    catch (error) {
      if (attempt >= attempts || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(10 * attempt, 100)));
    }
  }
}
