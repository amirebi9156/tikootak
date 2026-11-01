#!/usr/bin/env node
/* ساخت آیکن‌های برند از logo-mark.svg با Chromium headless (بدون وابستگی npm).
   اجرا: CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/make-icons.mjs
   این اسکریپت فقط روی ماشین توسعه اجرا می‌شود؛ خروجی PNG/SVG داخل public است. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const publicDir = path.join(root, 'web-src', 'public');
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const logoSvg = path.join(publicDir, 'brand', 'logo-mark.svg');
if (!fs.existsSync(logoSvg)) throw new Error('brand/logo-mark.svg not found');
if (!fs.existsSync(chrome)) throw new Error(`Chrome not found: ${chrome}`);

// favicon: نسخهٔ مربع با پس‌زمینهٔ سبز-مشکی و لوگوی درون‌خطی (بدون وابستگی خارجی)
const raw = fs.readFileSync(logoSvg, 'utf8');
const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><rect width="320" height="320" rx="72" fill="#040B08"/><g transform="translate(18 29)">${inner}</g></svg>`;
fs.writeFileSync(path.join(publicDir, 'icon.svg'), favicon);
fs.writeFileSync(path.join(publicDir, 'brand', 'favicon.svg'), favicon);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tikootak-icons-'));
const jobs = [
  { file: 'apple-touch-icon.png', size: 180, pad: 0.18 },
  { file: 'icon-192.png', size: 192, pad: 0.18 },
  { file: 'icon-512.png', size: 512, pad: 0.18 },
  { file: 'icon-maskable-512.png', size: 512, pad: 0.24 },
];
function run(job) {
  const { size, pad, file } = job;
  const logo = Math.round(size * (1 - pad * 2));
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:#040B08}body{display:flex;align-items:center;justify-content:center}img{width:${logo}px;height:${logo}px;object-fit:contain}</style><img src="file:///${logoSvg.replace(/\\/g, '/')}">`;
  const htmlFile = path.join(tmp, `${file}.html`);
  const out = path.join(publicDir, file);
  fs.writeFileSync(htmlFile, html);
  return new Promise((resolve, reject) => {
    const p = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox', `--window-size=${size},${size}`, `--screenshot=${out}`, `file:///${htmlFile.replace(/\\/g, '/')}`], { stdio: 'ignore' });
    p.on('exit', code => code === 0 ? resolve(file) : reject(new Error(`${file}: chrome exit ${code}`)));
    p.on('error', reject);
  });
}
for (const job of jobs) console.log('made', await run(job));
fs.rmSync(tmp, { recursive: true, force: true });
