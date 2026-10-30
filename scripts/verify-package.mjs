import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyPackage(outputDirectory) {
  const root = resolve(outputDirectory);
  const metadata = JSON.parse(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const buildInfo = JSON.parse(await readFile(join(root, 'build-info.json'), 'utf8'));
  if (manifest.version !== metadata.version || manifest.manifest_version !== 3) throw new Error('Invalid package version/manifest');
  if (manifest.background.service_worker && manifest.incognito !== 'split') throw new Error('Chromium private workspace requires split mode');
  if (manifest.browser_specific_settings && manifest.incognito === 'split') throw new Error('Gecko does not support split mode');
  const gecko = Boolean(manifest.browser_specific_settings?.gecko) && Array.isArray(manifest.background?.scripts) && manifest.background.scripts.length > 0 && !manifest.background.service_worker;
  const chromium = typeof manifest.background?.service_worker === 'string' && !manifest.background.scripts && !manifest.browser_specific_settings;
  if ((!gecko && !chromium) || buildInfo.browserTarget !== (gecko ? 'gecko' : 'chromium')) throw new Error('Build browser target does not match the packaged manifest');
  const inside = (base, path) => {
    const target = resolve(base, path), rel = relative(base, target);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Package path escapes its root');
    return target;
  };
  if (manifest.action.default_popup) throw new Error('3.0.0 must open its native side panel directly');
  const panel = gecko ? manifest.sidebar_action?.default_panel : manifest.side_panel?.default_path;
  if (panel !== 'sidebar.html') throw new Error('Native explanation panel is missing');
  if (!manifest.content_scripts?.some(entry => entry.js?.includes('content.js'))) throw new Error('Automatic form guidance content script is missing');
  if (manifest.permissions?.includes('storage')) throw new Error('3.0.0 must not require persistent storage');
  for (const file of ['workspace.html', panel, manifest.background.service_worker ?? manifest.background.scripts[0], 'content.js']) await stat(inside(root, file));
  for (const icon of [...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action.default_icon ?? {})]) await stat(inside(root, icon));
  const content = await readFile(join(root, 'content.js'), 'utf8');
  if (/^\s*(?:import|export)\s/m.test(content)) throw new Error('Content script must be a classic self-contained script');
  for (const html of ['workspace.html', panel]) {
    const source = await readFile(join(root, html), 'utf8');
    for (const match of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      if (/^(?:[a-z]+:|\/\/)/i.test(match[1])) throw new Error('Remote executable HTML script');
      await stat(inside(root, match[1].replace(/^\//, '')));
    }
  }
  if (manifest.options_ui?.page === 'demo/setup.html') {
    for (const page of ['index', 'setup', 'results', 'guide']) {
      const source = await readFile(inside(root, `demo/${page}.html`), 'utf8');
      for (const match of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
        if (/^(?:[a-z]+:|\/\/)/i.test(match[1])) throw new Error('Remote bundled demo script');
        await stat(inside(root, match[1].replace(/^\//, '')));
      }
    }
    for (const name of ['original', 'fillable']) {
      const source = await readFile(`demo/assets/library-application-${name}.pdf`);
      const packaged = await readFile(inside(root, `demo/assets/library-application-${name}.pdf`));
      if (!source.equals(packaged)) throw new Error('Bundled comparison PDF changed');
    }
  }
  const assetRoot = join(root, 'assets');
  const runtime = JSON.parse(await readFile(join(assetRoot, 'runtime-manifest.json'), 'utf8'));
  for (const entry of runtime.files) {
    const bytes = await readFile(inside(assetRoot, entry.path));
    if (bytes.byteLength !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Runtime asset integrity failed: ${entry.path}`);
  }
  const containsPrivateKey = value => value && typeof value === 'object' && (value.kty === 'EC' && typeof value.d === 'string' || Object.values(value).some(containsPrivateKey));
  const inspectJson = async directory => {
    for (const name of await readdir(directory)) {
      const target = join(directory, name), info = await stat(target);
      if (info.isDirectory()) await inspectJson(target);
      else if (name.endsWith('.json') && containsPrivateKey(JSON.parse(await readFile(target, 'utf8')))) throw new Error('Private signing key found in package');
    }
  };
  await inspectJson(root);
  console.log(`Verified ${manifest.version} package: ${runtime.files.length} runtime assets, local script entries, private-key exclusion`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyPackage(process.argv[2] ?? 'dist');
