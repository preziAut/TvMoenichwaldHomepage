# Technische Prüfung – 13. November 2026

## Lokal verifiziert

- Astro/TypeScript: 0 Fehler, 0 Warnungen, 0 Hinweise.
- Acht automatisierte Funktionstests: Alt-ID-Weiterleitungen, echte 404 für unbekannte IDs, Waldbach-Schleifenschutz/Pfadübernahme, statische Requests, Methoden-/Origin-Prüfung, fehlende Konfiguration, Formularvalidierung sowie simulierte Turnstile-/Mail-Erfolge und -Fehler.
- Produktionsbuild: 72 HTML-Seiten.
- Referenzprüfung: interne Links und Bilddateien vorhanden; alle 39 regulären Quellinhalte zugeordnet; 279 von 279 Medienreferenzen aufgelöst.
- 13 Galerie-Datensätze (einschließlich zwei älterer Galerieformate), 15 historische Termine.
- Optimierte öffentliche Medien insgesamt rund 102 MB; größte Datei rund 15 MB. Originalarchive unverändert außerhalb des Repositories.
- Browser: Startseite, Desktoplayout bei 1440 px, mobile Darstellung bei 390 px ohne horizontales Überlaufen, mobile Navigation, Archivsuche nach Sektturnier sowie Galerie öffnen/weiterblättern/schließen geprüft. Keine defekten Bilder auf der geprüften Startseite.

## GitHub-Prüfung

Der GitHub-Actions-Lauf für Commit `27a9c02a83a6a29b10144db2fd5a530557a4cf0e` auf `feat/astro-migration` wurde erfolgreich abgeschlossen. Er umfasst `npm ci`, Inhalts-/Typprüfung, Funktionstests, Produktionsbuild, Referenzprüfung und das Build-Artefakt.

Prüfnachweis: https://github.com/preziAut/TvMoenichwaldHomepage/actions/runs/43504258148

## Noch offene Betriebsabnahme

- Domainumschaltung und abschließende Betriebsfreigabe.
- Echter Kontaktversand/Empfang mit konfigurierten Provider-Zugängen. Tests verwenden simulierte Provider-Antworten.
- Produktive Reservierung, Benutzerrechte, SMTP und Passwortzurücksetzen in beiden ep-3-Portalen: deren URLs liefern HTTP 403.
- Webcam-Aktualisierung: bisherige URL liefert HTTP 403.
- Vollständige Vereinsangaben und aktuelle Beitragspreise: siehe BETRIEB.md.
- Provider-Scan, Backup-Wiederherstellung und Freigabe der PHP-Anwendungen.

Die lokale Prüfung ist keine Behauptung einer vollständigen produktiven Betriebsfreigabe.

## Cloudflare-Veröffentlichung am 13. November 2026

- Pages-Projekt `tv-moenichwald` im vom Nutzer ausgewählten Konto `49a1b0704700ec0810ec88b5de2730a1`, Git-Integration mit `main`.
- Prüfadresse: https://tv-moenichwald.pages.dev (öffentlich, `noindex,nofollow`). Vereinsdomain nicht umgeschaltet.
- Commit `930425c`: 72 Seiten gebaut, Functions erfolgreich kompiliert, 631 Dateien hochgeladen. Deployment `d53b6102-5008-46db-aaaf-a05d5aa59fab`.
- GitHub-Prüfungen erfolgreich: https://github.com/preziAut/TvMoenichwaldHomepage/actions/runs/43505964885
- HTTP-Prüfung: Startseite 200; `/wp/?page_id=35` 301 nach `/verein/`; unbekannte Alt-ID und unbekannter Pfad jeweils 404; Kontakt-GET 405 und unkonfigurierter Kontakt-POST 503; unkonfiguriertes `/ep3wa/` 503.
- Startseite im Browser: keine defekten Bilder, kein horizontales Überlaufen. Die Prüfung ersetzt nicht die noch offenen Mail-, Buchungs- und Webcam-Tests.
- Der ältere Pages-Compiler unterstützt JSON-Importattribute nicht. `scripts/redirect-data.mjs` erzeugt deshalb vor Build und Tests ein gewöhnliches ESM-Datenmodul aus den bestehenden JSON-Zuordnungen.
