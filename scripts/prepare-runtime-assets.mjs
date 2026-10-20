import { createRequire } from 'node:module';
import { cp, mkdir, readFile, readdir, writeFile, stat, realpath } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = join(root, 'public', 'assets');
const require = createRequire(import.meta.url);
const packageRoot = (name, entry = name) => {
  let directory = dirname(require.resolve(entry));
  while (directory !== dirname(directory)) {
    try {
      const metadata = require(join(directory, 'package.json'));
      if (metadata.name === name) return directory;
    } catch {}
    directory = dirname(directory);
  }
  throw new Error(`Package root missing: ${name}`);
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(assetRoot, { recursive: true });
const pdf = packageRoot('pdfjs-dist');
const tess = packageRoot('tesseract.js');
const tessRequire = createRequire(join(tess, 'package.json'));
const core = dirname(tessRequire.resolve('tesseract.js-core/package.json'));
await mkdir(join(assetRoot, 'pdfjs'), { recursive: true });
await cp(join(pdf, 'build', 'pdf.worker.min.mjs'), join(assetRoot, 'pdfjs', 'pdf.worker.min.mjs'));
for (const name of ['cmaps', 'standard_fonts', 'wasm']) await cp(join(pdf, name), join(assetRoot, 'pdfjs', name), { recursive: true });
await cp(join(pdf, 'LICENSE'), join(assetRoot, 'pdfjs', 'LICENSE'));
await mkdir(join(assetRoot, 'tesseract'), { recursive: true });
await cp(join(tess, 'dist', 'worker.min.js'), join(assetRoot, 'tesseract', 'worker.min.js'));
await cp(join(tess, 'LICENSE.md'), join(assetRoot, 'tesseract', 'LICENSE'));
await mkdir(join(assetRoot, 'tesseract-core'), { recursive: true });
for (const name of await readdir(core)) {
  if (/\.(js|wasm)$/.test(name) || /^LICENSE/.test(name)) await cp(join(core, name), join(assetRoot, 'tesseract-core', name));
}

// Retain license texts for production dependencies, including distinct transitive versions.
const packageInputs = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const notices = [], visited = new Set();
const collectNotices = async (name, parentRequire) => {
  let entry;
  try { entry = parentRequire.resolve(`${name}/package.json`); }
  catch { entry = parentRequire.resolve(name); }
  let directory = dirname(entry), metadata;
  while (directory !== dirname(directory)) {
    try { metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); if (metadata.name === name) break; } catch {}
    directory = dirname(directory);
  }
  if (metadata?.name !== name) throw new Error(`Production dependency metadata missing: ${name}`);
  const identity = await realpath(directory);
  if (visited.has(identity)) return;
  visited.add(identity);
  const destination = `notices/${metadata.name.replaceAll('/', '__')}@${metadata.version}`;
  const licenseFiles = [];
  for (const filename of (await readdir(directory)).sort()) {
    if (!/^(licen[sc]e|copying|notice)([._-]|$)/i.test(filename)) continue;
    await mkdir(join(assetRoot, destination), { recursive: true });
    await cp(join(directory, filename), join(assetRoot, destination, filename), { recursive: true });
    licenseFiles.push(`${destination}/${filename}`);
  }
  await mkdir(join(assetRoot, destination), { recursive: true });
  await writeFile(join(assetRoot, destination, 'package-metadata.json'), JSON.stringify({ name: metadata.name, version: metadata.version, license: metadata.license, author: metadata.author, contributors: metadata.contributors, repository: metadata.repository }, null, 2) + '\n');
  notices.push({ name: metadata.name, version: metadata.version, license: metadata.license, licenseTextStatus: licenseFiles.length ? 'included' : 'not-provided-by-package', files: licenseFiles, metadata: `${destination}/package-metadata.json` });
  const scopedRequire = createRequire(join(directory, 'package.json'));
  for (const dependency of Object.keys(metadata.dependencies ?? {}).sort()) await collectNotices(dependency, scopedRequire);
};
for (const name of Object.keys(packageInputs.dependencies).sort()) await collectNotices(name, require);
await writeFile(join(assetRoot, 'third-party-notices.json'), JSON.stringify({ schemaVersion: 1, packages: notices.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)) }, null, 2) + '\n');
const missingNotices = notices.filter(item => item.licenseTextStatus !== 'included');
if (missingNotices.length) process.stdout.write(`Release license review required: ${missingNotices.map(item => `${item.name}@${item.version}`).join(', ')}\n`);

const lockPath = join(root, 'scripts', 'resources.lock.json');
let lock;
try { lock = JSON.parse(await readFile(lockPath, 'utf8')); } catch { lock = { schemaVersion: 1, resources: [] }; }
if (process.argv.includes('--download')) {
  const pinnedCommit = async repository => {
    const response = await fetch(`https://api.github.com/repos/${repository}/commits/main`, { headers: { 'User-Agent': 'SilverGuide-resource-build', Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`Cannot pin ${repository}: ${response.status}`);
    const data = await response.json();
    if (!/^[a-f0-9]{40}$/.test(data.sha)) throw new Error('Invalid source commit');
    return data.sha;
  };
  const repositories = { 'notofonts/noto-cjk': null, 'tesseract-ocr/tessdata_fast': null };
  const definitions = [
    { repository: 'notofonts/noto-cjk', source: 'Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf', path: 'fonts/NotoSansCJKjp-Regular.otf', license: 'OFL-1.1' },
    { repository: 'notofonts/noto-cjk', source: 'Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf', path: 'fonts/NotoSansJP-VF.ttf', license: 'OFL-1.1' },
    { repository: 'notofonts/noto-cjk', source: 'Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf', path: 'fonts/NotoSansJP-Regular.ttf', license: 'OFL-1.1', derivation: { tool: 'fontTools', version: '4.63.0', weight: 400, glyfPadding: 4, sourcePath: 'fonts/NotoSansJP-VF.ttf' } },
    { repository: 'notofonts/noto-cjk', source: 'Sans/LICENSE', path: 'fonts/LICENSE', license: 'OFL-1.1' },
    ...['jpn', 'eng', 'jpn_vert'].map(language => ({ repository: 'tesseract-ocr/tessdata_fast', source: `${language}.traineddata`, path: `tessdata/${language}.traineddata.gz`, license: 'Apache-2.0', gzip: true })),
    { repository: 'tesseract-ocr/tessdata_fast', source: 'LICENSE', path: 'tessdata/LICENSE', license: 'Apache-2.0' }
  ];
  for (const definition of definitions) {
    const existing = lock.resources.find(item => item.path === definition.path);
    const commit = existing?.commit ?? (repositories[definition.repository] ??= await pinnedCommit(definition.repository));
    const url = `https://raw.githubusercontent.com/${definition.repository}/${commit}/${definition.source}`;
    if (definition.derivation) {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      await promisify(execFile)(process.env.SILVERGUIDE_PYTHON ?? 'python', [join(root, 'scripts', 'derive-japanese-font.py'), join(assetRoot, definition.derivation.sourcePath), join(assetRoot, definition.path)]);
      const bytes = await readFile(join(assetRoot, definition.path));
      if (existing && digest(bytes) !== existing.sha256) throw new Error(`Derived font hash mismatch: ${definition.path}`);
      lock.resources = lock.resources.filter(item => item.path !== definition.path).concat({ ...definition, commit, url, bytes: bytes.byteLength, sha256: digest(bytes) });
      await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
      process.stdout.write(`Derived ${definition.path}\n`);
      continue;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Resource download failed (${response.status}): ${definition.path}`);
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.byteLength > 40 * 1024 * 1024) throw new Error('Resource size exceeded');
    const bytes = definition.gzip ? gzipSync(raw, { level: 9 }) : raw;
    if (existing && digest(bytes) !== existing.sha256) throw new Error(`Resource hash mismatch: ${definition.path}`);
    await mkdir(dirname(join(assetRoot, definition.path)), { recursive: true });
    await writeFile(join(assetRoot, definition.path), bytes);
    const record = { ...definition, commit, url, bytes: bytes.byteLength, sha256: digest(bytes) };
    lock.resources = lock.resources.filter(item => item.path !== definition.path).concat(record);
    await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
    process.stdout.write(`Prepared ${definition.path}\n`);
  }
}

if (lock.resources.length < 6) throw new Error('Japanese font and language resources are missing. Run pnpm run assets:download before building.');
for (const resource of lock.resources) {
  const bytes = await readFile(join(assetRoot, resource.path));
  if (digest(bytes) !== resource.sha256) throw new Error(`Bundled resource hash mismatch: ${resource.path}`);
}
const files = [];
const walk = async directory => {
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const info = await stat(path);
    if (info.isDirectory()) await walk(path);
    else if (name !== 'runtime-manifest.json') {
      const bytes = await readFile(path);
      files.push({ path: relative(assetRoot, path).replaceAll('\\', '/'), bytes: bytes.byteLength, sha256: digest(bytes) });
    }
  }
};
await walk(assetRoot);
const dependencies = Object.fromEntries(['pdfjs-dist', 'tesseract.js', 'pdf-lib', '@pdf-lib/fontkit'].map(name => [name, require(join(packageRoot(name), 'package.json')).version]));
await writeFile(join(assetRoot, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1, dependencies, resources: lock.resources, files }, null, 2) + '\n');
process.stdout.write(`Verified ${files.length} bundled runtime files\n`);
