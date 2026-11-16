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
const tournamentPanel = await readFile(path.join(root,'ui/tournaments.html'),'utf8');
const html=(await readFile(path.join(root,'ui/index.html'),'utf8'))
  .replace('href="/style.css"','href="./style.css"').replace('src="/app.js"','src="./demo.js"')
  .replace('href="/"','href="/buchung-demo/"')
  .replace('Lokale Testversion · Erfundene Konten · Keine echten Reservierungen',
    'ONLINE-DEMO · Nur erfundene Daten in deinem Browser · Neustart beim Neuladen · Keine echten Reservierungen')
  .replace('dieser lokalen Demo','dieser isolierten Demo')
  .replace('<!-- tournaments -->', () => tournamentPanel)
  .replace('<!-- club-content -->', `<section id="club-content" class="club-content" hidden>
  <h2>Termine und Bilder</h2>
  <form id="event-editor" hidden>
    <h3 id="event-form-title">Termin anlegen</h3>
    <label for="event-title">Titel</label><input id="event-title" required maxlength="120">
    <label for="event-date">Datum</label><input id="event-date" type="date" required>
    <label for="event-description">Beschreibung</label><textarea id="event-description" maxlength="2000"></textarea>
    <label><input id="event-public" type="checkbox"> Im Demokalender anzeigen</label>
    <button class="primary">Termin speichern</button>
    <button id="event-reset" type="button">Neuer Termin</button>
  </form>
  <h3>Veranstaltungskalender</h3>
  <ul id="club-events"></ul>
  <form id="photo-editor" hidden>
    <h3>Bild hinzufügen</h3>
    <label for="photo-file">JPEG, PNG oder WebP bis 8 MB</label><input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" required>
    <label for="photo-caption">Bildbeschreibung</label><input id="photo-caption" required maxlength="180">
    <button class="primary">Bild hinzufügen</button>
  </form>
  <h3>Galerie</h3><ul id="club-photos" class="club-photos"></ul>
  </section>`);
await writeFile(path.join(out,'index.html'),html);
for(const file of await readdir(out)) if((await stat(path.join(out,file))).size>25*1024*1024)
  throw new Error('Cloudflare asset exceeds 25 MiB: '+file);
console.log('Built isolated browser booking demo in dist/buchung-demo');
