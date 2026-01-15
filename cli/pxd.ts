#!/usr/bin/env -S npx tsx
/**
 * pxd CLI - Universal Tag System
 * 
 * Usage:
 *   pxd new "Project name"           Create new tag
 *   pxd show <id>                    Show tag details
 *   pxd link <id> <type> <url>       Add link to tag
 *   pxd search <query>               Search tags
 *   pxd list                         List all tags
 *   pxd work <id>                    Set active project
 *   pxd work                         Show active project
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.pxd');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const ACTIVE_FILE = join(CONFIG_DIR, 'active');

interface Config {
  api_url: string;
  admin_key?: string;
  agent_key?: string;
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(CONFIG_FILE)) {
    const defaults: Config = {
      api_url: 'https://pxd.lockmeister.workers.dev',
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
}

function getKey(config: Config): string {
  // Prefer admin key, fall back to agent key, then env
  return config.admin_key || config.agent_key || process.env.PXD_KEY || '';
}

async function api(
  config: Config,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const key = getKey(config);
  const res = await fetch(`${config.api_url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-PXD-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function copyToClipboard(text: string): boolean {
  try {
    execSync(`echo -n "${text}" | wl-copy`, { stdio: 'pipe', timeout: 2000 });
    return true;
  } catch {
    try {
      execSync(`echo -n "${text}" | xclip -selection clipboard`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().split('T')[0];
}

// Commands

async function cmdNew(config: Config, name: string) {
  const res = await api(config, 'POST', '/id', { name });
  if (!res.ok) {
    console.error('Error:', (res.data as { error?: string }).error || 'Unknown error');
    process.exit(1);
  }
  const tag = res.data as { id: string; name: string };
  const copied = copyToClipboard(tag.id);
  console.log(`Created: ${tag.id}`);
  console.log(`Name:    ${tag.name}`);
  if (copied) console.log('(copied to clipboard)');
}

async function cmdShow(config: Config, id: string) {
  const res = await api(config, 'GET', `/id/${id}`);
  if (!res.ok) {
    console.error('Error:', (res.data as { error?: string }).error || 'Not found');
    process.exit(1);
  }
  const tag = res.data as {
    id: string;
    name: string;
    meta: Record<string, unknown>;
    links: { type: string; url: string }[];
    created_at: number;
    updated_at: number;
  };
  console.log(`ID:      ${tag.id}`);
  console.log(`Name:    ${tag.name}`);
  console.log(`Created: ${formatDate(tag.created_at)}`);
  console.log(`Updated: ${formatDate(tag.updated_at)}`);
  if (Object.keys(tag.meta).length > 0) {
    console.log(`Meta:    ${JSON.stringify(tag.meta)}`);
  }
  if (tag.links?.length > 0) {
    console.log('Links:');
    for (const link of tag.links) {
      console.log(`  ${link.type}: ${link.url}`);
    }
  }
}

async function cmdLink(config: Config, id: string, type: string, url: string) {
  const res = await api(config, 'POST', `/id/${id}/link`, { type, url });
  if (!res.ok) {
    console.error('Error:', (res.data as { error?: string }).error || 'Unknown error');
    process.exit(1);
  }
  console.log(`Added ${type} link to ${id}`);
}

async function cmdSearch(config: Config, query: string) {
  const res = await api(config, 'GET', `/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    console.error('Error:', (res.data as { error?: string }).error || 'Unknown error');
    process.exit(1);
  }
  const tags = res.data as { id: string; name: string; updated_at: number }[];
  if (tags.length === 0) {
    console.log('No results');
    return;
  }
  for (const tag of tags) {
    console.log(`${tag.id}  ${tag.name}  (${formatDate(tag.updated_at)})`);
  }
}

async function cmdList(config: Config) {
  const res = await api(config, 'GET', '/list');
  if (!res.ok) {
    console.error('Error:', (res.data as { error?: string }).error || 'Unknown error');
    process.exit(1);
  }
  const tags = res.data as { id: string; name: string; updated_at: number }[];
  if (tags.length === 0) {
    console.log('No tags');
    return;
  }
  for (const tag of tags) {
    console.log(`${tag.id}  ${tag.name}  (${formatDate(tag.updated_at)})`);
  }
}

function cmdWork(id?: string) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  
  if (id) {
    writeFileSync(ACTIVE_FILE, id);
    console.log(`Active project: ${id}`);
  } else {
    if (existsSync(ACTIVE_FILE)) {
      console.log(readFileSync(ACTIVE_FILE, 'utf-8').trim());
    } else {
      console.log('No active project');
    }
  }
}

async function cmdDelete(config: Config, id: string) {
  const res = await api(config, 'DELETE', `/id/${id}`);
  if (!res.ok) {
    console.error('Error:', (res.data as { error?: string }).error || 'Unknown error');
    process.exit(1);
  }
  console.log(`Deleted: ${id}`);
}

// Main

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const config = loadConfig();

  switch (cmd) {
    case 'new':
      if (!args[1]) {
        console.error('Usage: pxd new "name"');
        process.exit(1);
      }
      await cmdNew(config, args.slice(1).join(' '));
      break;

    case 'show':
      if (!args[1]) {
        console.error('Usage: pxd show <id>');
        process.exit(1);
      }
      await cmdShow(config, args[1]);
      break;

    case 'link':
      if (!args[1] || !args[2] || !args[3]) {
        console.error('Usage: pxd link <id> <type> <url>');
        process.exit(1);
      }
      await cmdLink(config, args[1], args[2], args[3]);
      break;

    case 'search':
      await cmdSearch(config, args.slice(1).join(' '));
      break;

    case 'list':
      await cmdList(config);
      break;

    case 'work':
      cmdWork(args[1]);
      break;

    case 'delete':
      if (!args[1]) {
        console.error('Usage: pxd delete <id>');
        process.exit(1);
      }
      await cmdDelete(config, args[1]);
      break;

    default:
      console.log(`pxd - Universal Tag System

Usage:
  pxd new "name"              Create new tag
  pxd show <id>               Show tag details
  pxd link <id> <type> <url>  Add link to tag
  pxd search <query>          Search tags
  pxd list                    List all tags
  pxd work [id]               Set/show active project
  pxd delete <id>             Delete tag (admin only)

Config: ~/.pxd/config.json`);
  }
}

main().catch(console.error);
