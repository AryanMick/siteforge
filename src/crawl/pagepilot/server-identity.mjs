import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';

export async function serverIdentity(root = process.cwd(), mode = process.env.NODE_ENV === 'production' ? 'production' : 'development') {
  return { app: 'pagepilot', workspaceId: createHash('sha256').update(await realpath(root)).digest('hex'), mode };
}
