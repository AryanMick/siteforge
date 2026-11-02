import { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

const gate = process.env.SITEFORGE_TEST_RELEASE_GATE;
if (gate) {
  const unlink = fs.unlink;
  fs.unlink = async function(path) {
    if (String(path).endsWith('/active.lock/owner.json')) {
      await fs.writeFile(join(gate, 'waiting'), 'ready');
      const deadline = Date.now() + 15000;
      while (true) {
        try { await fs.access(join(gate, 'release')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (Date.now() > deadline) throw new Error('Test release gate timed out');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    return unlink(path);
  };
  syncBuiltinESMExports();
}
