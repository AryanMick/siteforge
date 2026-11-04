import { apiError, json, localOnly } from '@/fixture-lab/http.mjs';
import { readConnection, wordpressClient, WordPressError } from '@/wordpress/client.mjs';
import { inspectWordPress } from '@/wordpress/inspect.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// What the local WordPress already has: its post types and taxonomies, theme, Elementor, and which SiteForge content
// types would reuse an existing post type (see src/wordpress/inspect.mjs). Uses .wordpress/connection.json.
export async function GET(request: Request) {
  try {
    localOnly(request);
    try {
      const connection = await readConnection(process.cwd());
      const summary = await inspectWordPress(wordpressClient({ url: connection.url, token: connection.token, timeoutMs: 20000 }));
      return json({ ...summary, adminUrl: connection.adminUrl ?? summary.adminUrl });
    } catch (error) {
      if (error instanceof WordPressError) return json({ error: error.message, code: error.code }, error.code === 'no_connection' ? 409 : 502);
      throw error;
    }
  } catch (error) { return apiError(error); }
}
