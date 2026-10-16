// Guards the service worker's precache lists against drift: a module app.js imports but the
// SW doesn't precache (or a CDN <script> it doesn't know about) silently breaks offline boot.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

const sw = read('sw.js');
const html = read('index.html');

const arrayLiteral = name => {
  const match = sw.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} not found in sw.js`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
};

const shellAssets = arrayLiteral('SHELL_ASSETS');
const cdnAssets = arrayLiteral('CDN_ASSETS');
const scriptSrcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);

describe('service worker precache', () => {
  it('includes every module under modules/', () => {
    readdirSync(new URL('modules/', root))
      .filter(f => f.endsWith('.js'))
      .forEach(f => assert.ok(shellAssets.includes(`/modules/${f}`), `sw.js SHELL_ASSETS is missing /modules/${f}`));
  });

  it('only lists modules that exist', () => {
    const modules = readdirSync(new URL('modules/', root));
    shellAssets
      .filter(a => a.startsWith('/modules/'))
      .forEach(a => assert.ok(modules.includes(a.slice('/modules/'.length)), `${a} does not exist`));
  });

  it('includes the page shell and every local script', () => {
    ['/', '/styles.css'].forEach(a => assert.ok(shellAssets.includes(a), `missing ${a}`));
    scriptSrcs
      .filter(src => !/^https?:/.test(src))
      .forEach(src => assert.ok(shellAssets.includes(`/${src.replace(/^\//, '')}`), `missing /${src}`));
  });

  it('matches the CDN scripts in index.html exactly', () => {
    const cdnScripts = scriptSrcs.filter(src => /^https?:/.test(src));
    assert.deepEqual([...cdnAssets].sort(), [...cdnScripts].sort());
  });
});
