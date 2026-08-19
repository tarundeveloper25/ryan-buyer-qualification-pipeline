#!/usr/bin/env node
'use strict';

/**
 * pipeline-builder CLI
 *
 * Usage:
 *   npx github:go-code-bot/pipeline-builder
 *   npx github:go-code-bot/pipeline-builder add ./path
 *   npx github:go-code-bot/pipeline-builder sync ./path
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const OWNER = 'go-code-bot';
const REPO = 'pipeline-builder';
const BRANCH = 'main';
const API_BASE = 'https://api.github.com';
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
const CLI_FILES = new Set(['cli.js', 'install.sh', 'package.json', 'README.md', '.gitignore', '.npmignore']);

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'pipeline-builder-cli/1.0',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'pipeline-builder-cli/1.0' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function log(message) {
  console.log(`  ${message}`);
}

async function listRepoFiles() {
  const body = await fetchText(`${API_BASE}/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`);
  const data = JSON.parse(body);
  if (!Array.isArray(data.tree)) {
    throw new Error('Could not list repository files from GitHub API');
  }
  return data.tree.filter((item) => item.type === 'blob').map((item) => item.path);
}

async function installSkills(targetDir, { overwrite = false } = {}) {
  const absTarget = path.resolve(process.cwd(), targetDir);
  const files = await listRepoFiles();
  const skillFiles = files.filter((file) => {
    const first = file.split('/')[0];
    return !CLI_FILES.has(first) && !CLI_FILES.has(file);
  });

  log(`Source: https://github.com/${OWNER}/${REPO}`);
  log(`Target: ${absTarget}`);
  log(`Files: ${skillFiles.length}`);

  let written = 0;
  let skipped = 0;
  for (const relPath of skillFiles) {
    const destPath = path.join(absTarget, relPath);
    if (!overwrite && fs.existsSync(destPath)) {
      skipped += 1;
      log(`skipped ${relPath}`);
      continue;
    }
    const content = await fetchBuffer(`${RAW_BASE}/${relPath}`);
    ensureDir(destPath);
    fs.writeFileSync(destPath, content);
    written += 1;
    log(`wrote ${relPath}`);
  }

  console.log(`\nInstalled pipeline-builder skill files: ${written} written, ${skipped} skipped.`);
  console.log('Validate with: node scripts/validate-pipeline.js assets/pipeline.json');
}

async function main() {
  const command = process.argv[2] || 'add';
  const target = process.argv[3] || '.';
  if (command === 'add') {
    await installSkills(target, { overwrite: false });
    return;
  }
  if (command === 'sync') {
    await installSkills(target, { overwrite: true });
    return;
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log('Usage: skills [add|sync] [target-dir]');
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
