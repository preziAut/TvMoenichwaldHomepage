# TV Mönichwald – Astro-Website

Modernisierter Vereinsauftritt ohne WordPress. Astro 7, TypeScript, Tailwind 4, Markdown/Content Collections. Bestehende ep-3-Portale bleiben getrennt bei World4You.

## Lokal starten

```sh
npm ci
npm run dev
```

Node 24 wird projektlokal installiert. Vorschau: http://127.0.0.1:4321. `npm run check`, `npm test`, `npm run build` und `npm run verify` prüfen Typen, kritische Funktionen, Build und interne Links. `npm run preview` zeigt den gebauten statischen Stand; Cloudflare Functions benötigen Cloudflare Pages oder Wrangler und laufen nicht im Astro-Devserver.

## Enthalten

- Alle 39 regulären veröffentlichten WordPress-Inhalte, 279 Attachment-Zuordnungen, 15 historische Termine und die übernommenen Galerien.
- Originales Vereinslogo, optimierte Bilder, Archive, Suche/Jahresfilter, tastaturbedienbare Bildansicht, getrennte Reservierungslinks.
- Permanente Alt-ID-/Medienweiterleitungen und Kontakt-Endpunkt mit Turnstile/Resend.
- GitHub Actions und Cloudflare-Deployment-Anleitung.

Die Website ist noch nicht produktiv freigegeben. Ohne Konfiguration bleibt das Formular deaktiviert und die Webcam zeigt einen ehrlichen Verfügbarkeitshinweis. Die alten Preisangaben widersprechen sich; Impressum und Datenschutz benötigen vervollständigte Vereinsangaben. `PUBLIC_SITE_APPROVED` ist standardmäßig false und setzt noindex. Das ersetzt keinen Zugriffsschutz für Vorschauen.

## Dokumentation

- [Inhalte pflegen](docs/INHALTSPFLEGE.md)
- [Deployment, Betrieb und offene Freigabepunkte](docs/BETRIEB.md)
- [Migrationsnachweis](docs/migration-inventory.json)
- [Medienprüfung](docs/media-report.json)

## Import wiederholen

Nur lokal mit den autorisierten Backups in den bisherigen Nachbarverzeichnissen:

```sh
python scripts/extract.py
npm run migrate
```

Der Import überschreibt die erzeugten Inhalte. Vor redaktionellen Änderungen einen Branch anlegen; späteren Neuimport nur dort ausführen und Diff prüfen. Die SQL-Dateien werden als Text gelesen, niemals ausgeführt. `.import/` und private Originale sind ausgeschlossen. Ein normaler Build benötigt keine Backups.

Nicht den übergeordneten Arbeitsordner veröffentlichen. Dieses Repository enthält keine SQL-Dumps, Buchungskonten oder alten PHP-Anwendungen.
