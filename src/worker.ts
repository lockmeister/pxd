/**
 * pxd - Universal Tag System Worker
 * 
 * API:
 *   POST   /id              - create new tag
 *   GET    /id/:id          - get tag
 *   PUT    /id/:id          - update tag (admin only)
 *   DELETE /id/:id          - delete tag (admin only)
 *   GET    /search?q=       - search tags
 *   GET    /health          - health check
 */

interface Env {
  DB: D1Database;
  PXD_ADMIN_KEY: string;
  PXD_AGENT_KEY: string;
}

type Role = 'admin' | 'agent' | 'none';

// ID generation: px[a-z2-9]{7}
const CHARSET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no 0,1,l,o
function generateId(): string {
  const chars = Array.from({ length: 7 }, () => 
    CHARSET[Math.floor(Math.random() * CHARSET.length)]
  );
  return 'px' + chars.join('');
}

function getRole(request: Request, env: Env): Role {
  const key = request.headers.get('X-PXD-Key');
  if (!key) return 'none';
  if (key === env.PXD_ADMIN_KEY) return 'admin';
  if (key === env.PXD_AGENT_KEY) return 'agent';
  return 'none';
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const role = getRole(request, env);

    // Health check - public
    if (path === '/health') {
      return json({ ok: true });
    }

    // All other routes require auth
    if (role === 'none') {
      return error('Unauthorized', 401);
    }

    // POST /id - create new tag
    if (method === 'POST' && path === '/id') {
      const body = await request.json() as { name: string; meta?: Record<string, unknown> };
      if (!body.name) return error('name required');

      // Generate unique ID (retry on collision)
      let id: string;
      let attempts = 0;
      do {
        id = generateId();
        const existing = await env.DB.prepare('SELECT id FROM tags WHERE id = ?').bind(id).first();
        if (!existing) break;
        attempts++;
      } while (attempts < 10);

      if (attempts >= 10) return error('Failed to generate unique ID', 500);

      const now = Date.now();
      await env.DB.prepare(
        'INSERT INTO tags (id, name, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(id, body.name, JSON.stringify(body.meta || {}), now, now).run();

      return json({ id, name: body.name, meta: body.meta || {}, created_at: now }, 201);
    }

    // GET /id/:id - get tag
    if (method === 'GET' && path.startsWith('/id/')) {
      const id = path.slice(4);
      const tag = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(id).first();
      if (!tag) return error('Not found', 404);

      const links = await env.DB.prepare('SELECT type, url FROM links WHERE tag_id = ?').bind(id).all();
      
      return json({
        ...tag,
        meta: JSON.parse(tag.meta as string || '{}'),
        links: links.results,
      });
    }

    // PUT /id/:id - update tag (admin only)
    if (method === 'PUT' && path.startsWith('/id/')) {
      if (role !== 'admin') return error('Admin required', 403);

      const id = path.slice(4);
      const body = await request.json() as { name?: string; meta?: Record<string, unknown> };
      
      const existing = await env.DB.prepare('SELECT id FROM tags WHERE id = ?').bind(id).first();
      if (!existing) return error('Not found', 404);

      const updates: string[] = [];
      const values: unknown[] = [];

      if (body.name) {
        updates.push('name = ?');
        values.push(body.name);
      }
      if (body.meta !== undefined) {
        updates.push('meta = ?');
        values.push(JSON.stringify(body.meta));
      }
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);

      await env.DB.prepare(
        `UPDATE tags SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...values).run();

      return json({ ok: true });
    }

    // DELETE /id/:id - delete tag (admin only)
    if (method === 'DELETE' && path.startsWith('/id/')) {
      if (role !== 'admin') return error('Admin required', 403);

      const id = path.slice(4);
      await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    // POST /id/:id/link - add link
    if (method === 'POST' && path.match(/^\/id\/[a-z0-9]+\/link$/)) {
      const id = path.split('/')[2];
      const body = await request.json() as { type: string; url: string };
      if (!body.type || !body.url) return error('type and url required');

      const existing = await env.DB.prepare('SELECT id FROM tags WHERE id = ?').bind(id).first();
      if (!existing) return error('Tag not found', 404);

      await env.DB.prepare(
        'INSERT INTO links (tag_id, type, url, created_at) VALUES (?, ?, ?, ?)'
      ).bind(id, body.type, body.url, Date.now()).run();

      return json({ ok: true }, 201);
    }

    // DELETE /id/:id/link/:type - remove link (admin only)
    if (method === 'DELETE' && path.match(/^\/id\/[a-z0-9]+\/link\/[a-z]+$/)) {
      if (role !== 'admin') return error('Admin required', 403);

      const parts = path.split('/');
      const id = parts[2];
      const type = parts[4];

      await env.DB.prepare('DELETE FROM links WHERE tag_id = ? AND type = ?').bind(id, type).run();
      return json({ ok: true });
    }

    // GET /search?q= - search tags
    if (method === 'GET' && path === '/search') {
      const q = url.searchParams.get('q') || '';
      const results = await env.DB.prepare(
        'SELECT id, name, meta, created_at, updated_at FROM tags WHERE name LIKE ? ORDER BY updated_at DESC LIMIT 50'
      ).bind(`%${q}%`).all();

      return json(results.results.map(r => ({
        ...r,
        meta: JSON.parse(r.meta as string || '{}'),
      })));
    }

    // GET /list - list all tags
    if (method === 'GET' && path === '/list') {
      const results = await env.DB.prepare(
        'SELECT id, name, created_at, updated_at FROM tags ORDER BY updated_at DESC LIMIT 100'
      ).all();
      return json(results.results);
    }

    return error('Not found', 404);
  },
};
