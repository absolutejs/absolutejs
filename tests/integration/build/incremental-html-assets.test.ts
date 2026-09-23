import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from '../../../src/core/build';

test('unrelated incremental builds retain compiled HTML script and style URLs', async () => {
 const root = await mkdtemp(join(resolve(import.meta.dir, '../../..'), '.html-assets-'));
 try {
  const html = join(root, 'html');
  const styles = join(root, 'styles');
  await mkdir(join(html, 'pages'), {recursive:true});
  await mkdir(join(html, 'scripts'), {recursive:true});
  await mkdir(styles, {recursive:true});
  await writeFile(join(html, 'scripts', 'counter.ts'), 'document.body.dataset.ready = "yes";');
  await writeFile(join(styles, 'theme.css'), 'body { color: red; }');
  await writeFile(join(html, 'pages', 'Home.html'), '<html><head><link rel="stylesheet" href="../../styles/theme.css"></head><body><script src="../scripts/counter.ts"></script></body></html>');
  const config = {cwd:root, htmlDirectory:html, buildDirectory:join(root,'build'),stylesConfig:styles,options:{throwOnError:true}};
  const initial = await build(config);
  if (!initial) throw new Error('Initial build failed');
  const page = initial.manifest.Home;
  if (!page) throw new Error('HTML page missing');
  const before = await readFile(page, 'utf8');
  expect(before).not.toContain('../scripts/counter.ts');
  expect(before).not.toContain('../../styles/theme.css');
  await build({...config,incrementalFiles:[join(root,'other-framework.ts')], options: {...config.options, baseManifest: initial.manifest}});
  const after = await readFile(page, 'utf8');
  expect(after).toBe(before);
 } finally {await rm(root,{recursive:true,force:true});}
}, 60000);
