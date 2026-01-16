#!/usr/bin/env -S npx tsx
/**
 * Add pxd IDs to Obsidian notes frontmatter
 * 
 * Usage:
 *   npx tsx add-pxd-to-obsidian.ts ~/life          # dry run
 *   npx tsx add-pxd-to-obsidian.ts ~/life --apply  # actually modify files
 */

import { readFileSync, writeFileSync, readdirSync, statSync, lstatSync } from 'fs';
import { join } from 'path';

// ID generation: px[a-z2-9]{7}
const CHARSET = 'abcdefghijkmnpqrstuvwxyz23456789';
function generateId(): string {
  const chars = Array.from({ length: 7 }, () =>
    CHARSET[Math.floor(Math.random() * CHARSET.length)]
  );
  return 'px' + chars.join('');
}

function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  
  function walk(currentDir: string) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      
      // Skip hidden dirs and common non-note dirs
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      
      const lstat = lstatSync(fullPath);
      // Skip symlinks to avoid loops
      if (lstat.isSymbolicLink()) continue;
      
      if (lstat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

interface ProcessResult {
  path: string;
  action: 'skip' | 'add-frontmatter' | 'add-pid';
  pid?: string;
}

function processFile(filePath: string, apply: boolean): ProcessResult {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  // Check if file has frontmatter
  if (lines[0] === '---') {
    // Find end of frontmatter
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') {
        endIndex = i;
        break;
      }
    }
    
    if (endIndex > 0) {
      // Check if pid already exists
      const frontmatter = lines.slice(1, endIndex);
      if (frontmatter.some(line => line.startsWith('pid:'))) {
        return { path: filePath, action: 'skip' };
      }
      
      // Add pid to existing frontmatter
      const pid = generateId();
      lines.splice(1, 0, `pid: ${pid}`);
      
      if (apply) {
        writeFileSync(filePath, lines.join('\n'));
      }
      
      return { path: filePath, action: 'add-pid', pid };
    }
  }
  
  // No frontmatter - add new frontmatter with pid
  const pid = generateId();
  const newContent = `---\npid: ${pid}\n---\n\n${content}`;
  
  if (apply) {
    writeFileSync(filePath, newContent);
  }
  
  return { path: filePath, action: 'add-frontmatter', pid };
}

// Main
const args = process.argv.slice(2);
const vaultPath = args.find(a => !a.startsWith('--'));
const apply = args.includes('--apply');

if (!vaultPath) {
  console.log('Usage: npx tsx add-pxd-to-obsidian.ts <vault-path> [--apply]');
  console.log('');
  console.log('  --apply    Actually modify files (default is dry run)');
  process.exit(1);
}

console.log(`Scanning ${vaultPath}...`);
console.log(apply ? 'Mode: APPLY (will modify files)' : 'Mode: DRY RUN (no changes)');
console.log('');

const files = findMarkdownFiles(vaultPath);
console.log(`Found ${files.length} markdown files\n`);

let skipped = 0;
let addedPid = 0;
let addedFrontmatter = 0;

for (const file of files) {
  const result = processFile(file, apply);
  
  switch (result.action) {
    case 'skip':
      skipped++;
      break;
    case 'add-pid':
      addedPid++;
      if (!apply) console.log(`Would add pid to frontmatter: ${result.path}`);
      break;
    case 'add-frontmatter':
      addedFrontmatter++;
      if (!apply) console.log(`Would add frontmatter: ${result.path}`);
      break;
  }
}

console.log('');
console.log('Summary:');
console.log(`  Skipped (already has pid): ${skipped}`);
console.log(`  ${apply ? 'Added' : 'Would add'} pid to existing frontmatter: ${addedPid}`);
console.log(`  ${apply ? 'Added' : 'Would add'} new frontmatter: ${addedFrontmatter}`);

if (!apply && (addedPid > 0 || addedFrontmatter > 0)) {
  console.log('');
  console.log('Run with --apply to make changes.');
}
