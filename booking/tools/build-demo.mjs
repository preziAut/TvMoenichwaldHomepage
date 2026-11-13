import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile,readdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.resolve(root,'../dist/buchung-demo');
await mkdir(out,{recursive:true});
await build({entryPoints:[path.join(root,'src/browser-entry.ts')],outfile:path.join(out,'demo.js'),bundle:true,
  platform:'browser',format:'esm',target:'es2022',minify:true,loader:{'.sql':'text'},logLevel:'warning'});
for(const file of ['pglite.wasm','pglite.data','btree_gist.tar.gz'])
  await copyFile(path.join(root,'node_modules/@electric-sql/pglite/dist',file),path.join(out,file));
await copyFile(path.join(root,'ui/style.css'),path.join(out,'style.css'));
const html=(await readFile(path.join(root,'ui/index.html'),'utf8'))
  .replace('href="/style.css"','href="./style.css"').replace('src="/app.js"','src="./demo.js"')
  .replace('href="/"','href="/buchung-demo/"')
  .replace('Lokale Testversion · Erfundene Konten · Keine echten Reservierungen',
    'ONLINE-DEMO · Nur erfundene Daten in deinem Browser · Neustart beim Neuladen · Keine echten Reservierungen')
  .replace('dieser lokalen Demo','dieser isolierten Demo');
await writeFile(path.join(out,'index.html'),html);
for(const file of await readdir(out)) if((await stat(path.join(out,file))).size>25*1024*1024)
  throw new Error('Cloudflare asset exceeds 25 MiB: '+file);
console.log('Built isolated browser booking demo in dist/buchung-demo');
