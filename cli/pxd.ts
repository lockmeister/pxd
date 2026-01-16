#!/usr/bin/env -S npx tsx
/**
 * pxd CLI - Universal Tag System
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.pxd');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const ACTIVE_FILE = join(CONFIG_DIR, 'active');
const CACHE_FILE = join(CONFIG_DIR, 'cache.json');

interface CachedTag {
  id: string;
  name: string;
  meta?: Record<string, unknown>;
  links?: { type: string; url: string }[];
  created_at: number;
  updated_at: number;
}

interface Cache {
  tags: Record<string, CachedTag>;
  updated_at: number;
}

function loadCache(): Cache {
  if (!existsSync(CACHE_FILE)) {
    return { tags: {}, updated_at: 0 };
  }
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return { tags: {}, updated_at: 0 };
  }
}

function saveCache(cache: Cache) {
  cache.updated_at = Date.now();
  writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

function cacheSet(tag: CachedTag) {
  const cache = loadCache();
  cache.tags[tag.id] = tag;
  saveCache(cache);
}

function cacheDelete(id: string) {
  const cache = loadCache();
  delete cache.tags[id];
  saveCache(cache);
}

function cacheGet(id: string): CachedTag | undefined {
  return loadCache().tags[id];
}

function cacheAll(): CachedTag[] {
  return Object.values(loadCache().tags).sort((a, b) => b.updated_at - a.updated_at);
}

const HELP = `pxd - Universal Tag System

USAGE
  pxd new [name]              Create new ID (name optional)
  pxd show <id>               Show tag details + links
  pxd link <id> <type> <url>  Add link to tag
  pxd search <query>          Search tags by name
  pxd list                    List all tags
  pxd work [id]               Set/show active project
  pxd delete <id>             Delete tag (admin only)
  pxd sync                    Force sync cache from API

OPTIONS
  --help, -h                  Show this help
  --json                      Output as JSON (for scripting)

EXAMPLES
  pxd new                     # just get an ID (for Obsidian notes, etc)
  pxd new "Stripe token"      # ID + name (for tokens, resources)
  pxd link px8syphaf github https://github.com/org/echo
  pxd show px8syphaf
  pxd search stripe

CONFIG
  ~/.pxd/config.json          API URL and keys
  ~/.pxd/active               Current active project ID

ENV
  PXD_KEY                     API key (overrides config)
`;

interface Config {
  api_url: string;
  admin_key?: string;
  agent_key?: string;
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(CONFIG_FILE)) {
    const defaults: Config = {
      api_url: 'https://pxd.thelockmeister.workers.dev',
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
}

function getKey(config: Config): string {
  return process.env.PXD_KEY || config.admin_key || config.agent_key || '';
}

async function api(
  config: Config,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const key = getKey(config);
  
  // Add timeout to prevent hanging
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    const res = await fetch(`${config.api_url}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'X-PXD-Key': key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { ok: false, status: 0, data: { error: 'Request timeout' } };
    }
    return { ok: false, status: 0, data: { error: (err as Error).message } };
  } finally {
    clearTimeout(timeout);
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().split('T')[0];
}

function output(data: unknown, json: boolean) {
  if (json) {
    console.log(JSON.stringify(data));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(data);
  }
}

function err(msg: string, json: boolean) {
  if (json) {
    console.log(JSON.stringify({ error: msg }));
  } else {
    console.error(`Error: ${msg}`);
  }
  process.exit(1);
}

// Commands

async function cmdNew(config: Config, name: string | undefined, opts: { json: boolean }) {
  const res = await api(config, 'POST', '/id', { name: name || '' });
  if (!res.ok) {
    err((res.data as { error?: string }).error || 'Unknown error', opts.json);
  }
  const tag = res.data as { id: string; name: string; created_at: number };
  
  // Update cache
  cacheSet({ ...tag, updated_at: tag.created_at, links: [] });
  
  if (opts.json) {
    output(tag, true);
  } else {
    console.log(tag.id);
  }
}

async function cmdShow(config: Config, id: string, opts: { json: boolean }) {
  // Try cache first
  let tag = cacheGet(id);
  
  // Fetch from API to ensure fresh (and update cache)
  const res = await api(config, 'GET', `/id/${id}`);
  if (res.ok) {
    tag = res.data as CachedTag;
    cacheSet(tag);
  } else if (!tag) {
    err((res.data as { error?: string }).error || 'Not found', opts.json);
  }
  
  if (opts.json) {
    output(tag, true);
  } else {
    console.log(`ID:      ${tag!.id}`);
    console.log(`Name:    ${tag!.name}`);
    console.log(`Created: ${formatDate(tag!.created_at)}`);
    console.log(`Updated: ${formatDate(tag!.updated_at)}`);
    if (Object.keys(tag!.meta || {}).length > 0) {
      console.log(`Meta:    ${JSON.stringify(tag!.meta)}`);
    }
    if (tag!.links?.length) {
      console.log('Links:');
      for (const link of tag!.links) {
        console.log(`  ${link.type}: ${link.url}`);
      }
    }
  }
}

async function cmdLink(config: Config, id: string, type: string, url: string, opts: { json: boolean }) {
  const res = await api(config, 'POST', `/id/${id}/link`, { type, url });
  if (!res.ok) {
    err((res.data as { error?: string }).error || 'Unknown error', opts.json);
  }
  
  // Update cache
  const tag = cacheGet(id);
  if (tag) {
    tag.links = tag.links || [];
    tag.links.push({ type, url });
    tag.updated_at = Date.now();
    cacheSet(tag);
  }
  
  if (opts.json) {
    output({ ok: true, id, type, url }, true);
  } else {
    console.log(`Added ${type} link to ${id}`);
  }
}

async function cmdSearch(config: Config, query: string, opts: { json: boolean }) {
  // Search cache first (instant)
  const q = query.toLowerCase();
  let tags = cacheAll().filter(t => t.name.toLowerCase().includes(q));
  
  // Also fetch from API to ensure completeness
  const res = await api(config, 'GET', `/search?q=${encodeURIComponent(query)}`);
  if (res.ok) {
    const remoteTags = res.data as CachedTag[];
    // Merge into cache
    for (const t of remoteTags) {
      cacheSet(t);
    }
    tags = remoteTags;
  }
  
  if (opts.json) {
    output(tags, true);
  } else if (tags.length === 0) {
    console.log('No results');
  } else {
    for (const tag of tags) {
      console.log(`${tag.id}  ${tag.name}`);
    }
  }
}

async function cmdList(config: Config, opts: { json: boolean }) {
  // Use cache, refresh in background
  let tags = cacheAll();
  
  // Fetch from API to sync
  const res = await api(config, 'GET', '/list');
  if (res.ok) {
    const remoteTags = res.data as CachedTag[];
    // Full sync - rebuild cache from API
    const cache = loadCache();
    cache.tags = {};
    for (const t of remoteTags) {
      cache.tags[t.id] = t;
    }
    saveCache(cache);
    tags = remoteTags;
  }
  
  if (opts.json) {
    output(tags, true);
  } else if (tags.length === 0) {
    console.log('No tags');
  } else {
    for (const tag of tags) {
      console.log(`${tag.id}  ${tag.name}`);
    }
  }
}

function cmdWork(id?: string, opts: { json: boolean } = { json: false }) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  
  if (id) {
    writeFileSync(ACTIVE_FILE, id);
    if (opts.json) {
      output({ active: id }, true);
    } else {
      console.log(id);
    }
  } else {
    if (existsSync(ACTIVE_FILE)) {
      const active = readFileSync(ACTIVE_FILE, 'utf-8').trim();
      if (opts.json) {
        output({ active }, true);
      } else {
        console.log(active);
      }
    } else {
      if (opts.json) {
        output({ active: null }, true);
      } else {
        console.log('No active project');
      }
    }
  }
}

async function cmdDelete(config: Config, id: string, opts: { json: boolean }) {
  const res = await api(config, 'DELETE', `/id/${id}`);
  if (!res.ok) {
    err((res.data as { error?: string }).error || 'Unknown error', opts.json);
  }
  
  // Remove from cache
  cacheDelete(id);
  
  if (opts.json) {
    output({ ok: true, deleted: id }, true);
  } else {
    console.log(`Deleted: ${id}`);
  }
}

// Main

async function main() {
  const args = process.argv.slice(2);
  
  // Parse flags
  const jsonFlag = args.includes('--json');
  const helpFlag = args.includes('--help') || args.includes('-h');
  
  // Remove flags from args
  const positional = args.filter(a => !a.startsWith('--') && a !== '-h');
  const cmd = positional[0];
  
  if (helpFlag || !cmd) {
    console.log(HELP);
    process.exit(0);
  }
  
  const config = loadConfig();
  const opts = { json: jsonFlag };

  switch (cmd) {
    case 'new':
      // Name is optional - if not provided, just generates ID
      await cmdNew(config, positional[1] ? positional.slice(1).join(' ') : undefined, opts);
      break;

    case 'show':
      if (!positional[1]) {
        err('Usage: pxd show <id>', jsonFlag);
      }
      await cmdShow(config, positional[1], opts);
      break;

    case 'link':
      if (!positional[1] || !positional[2] || !positional[3]) {
        err('Usage: pxd link <id> <type> <url>', jsonFlag);
      }
      await cmdLink(config, positional[1], positional[2], positional[3], opts);
      break;

    case 'search':
      await cmdSearch(config, positional.slice(1).join(' '), opts);
      break;

    case 'list':
      await cmdList(config, opts);
      break;

    case 'work':
      cmdWork(positional[1], opts);
      break;

    case 'delete':
      if (!positional[1]) {
        err('Usage: pxd delete <id>', jsonFlag);
      }
      await cmdDelete(config, positional[1], opts);
      break;

    case 'sync':
      await cmdList(config, { json: false }); // list does full sync
      console.log('Cache synced');
      break;

    case 'help':
      console.log(HELP);
      break;

    default:
      err(`Unknown command: ${cmd}. Use --help for usage.`, jsonFlag);
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
