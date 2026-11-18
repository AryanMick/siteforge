import { CMS, cmsShortcut } from '@/fixture-lab/cms-shortcut';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// http://127.0.0.1:4400/admin/... opens the same page in the local Drupal (see src/fixture-lab/cms-shortcut.ts).
export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return cmsShortcut(request, CMS.drupal, 'admin', (await params).path);
}
