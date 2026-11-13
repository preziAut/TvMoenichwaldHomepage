# Technische Prüfung – 13. November 2026

## Lokal verifiziert

- Astro/TypeScript: 0 Fehler, 0 Warnungen, 0 Hinweise.
- Acht automatisierte Funktionstests: Alt-ID-Weiterleitungen, echte 404 für unbekannte IDs, Waldbach-Schleifenschutz/Pfadübernahme, statische Requests, Methoden-/Origin-Prüfung, fehlende Konfiguration, Formularvalidierung sowie simulierte Turnstile-/Mail-Erfolge und -Fehler.
- Produktionsbuild: 72 HTML-Seiten.
- Referenzprüfung: interne Links und Bilddateien vorhanden; alle 39 regulären Quellinhalte zugeordnet; 279 von 279 Medienreferenzen aufgelöst.
- 13 Galerie-Datensätze (einschließlich zwei älterer Galerieformate), 15 historische Termine.
- Optimierte öffentliche Medien insgesamt rund 102 MB; größte Datei rund 15 MB. Originalarchive unverändert außerhalb des Repositories.
- Browser: Startseite, Desktoplayout bei 1440 px, mobile Darstellung bei 390 px ohne horizontales Überlaufen, mobile Navigation, Archivsuche nach Sektturnier sowie Galerie öffnen/weiterblättern/schließen geprüft. Keine defekten Bilder auf der geprüften Startseite.

## Nicht als erledigt abgenommen

- Cloudflare-Pages-Deployment, Domainumschaltung und produktive Function-Routen.
- Echter Kontaktversand/Empfang mit konfigurierten Provider-Zugängen. Tests verwenden simulierte Provider-Antworten.
- Produktive Reservierung, Benutzerrechte, SMTP und Passwortzurücksetzen in beiden ep-3-Portalen: deren URLs liefern HTTP 403.
- Webcam-Aktualisierung: bisherige URL liefert HTTP 403.
- Vollständige Vereinsangaben und aktuelle Beitragspreise: siehe BETRIEB.md.
- Provider-Scan, Backup-Wiederherstellung und Freigabe der PHP-Anwendungen.

Die lokale Prüfung ist keine Behauptung einer vollständigen produktiven Betriebsfreigabe.
