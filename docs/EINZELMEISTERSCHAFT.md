# Einzelmeisterschaft: Architektur und Umsetzung

Astro 7.4.12 baut die Vereinswebsite statisch. Tailwind 4 läuft über Vite. `Layout.astro`, `SectionContainer.astro` und `Button.astro` bilden die Grundlage für die neuen Ansichten. Cloudflare Pages betreibt das bestehende Git-Deployment und Functions für Kontakt und Weiterleitungen. Die Platzreservierung hat separat ein PostgreSQL-Modell. `/buchung-demo/` läuft im Browser mit PGlite, frei wählbaren Testrollen und einer flüchtigen In-Memory-Turnierverwaltung für Einzel und Mixed. Sie enthält keine produktiven Meisterschafts- oder Kontodaten, die zu migrieren wären.

## Betrieb und Datenzugriff

Statische Astro-Seiten plus Same-Origin Pages Functions erhalten das bestehende Deployment. D1-Binding `DB` verwaltet Turniere und Kontenzuordnungen. Produktion `tv-moenichwald` und Vorschau `tv-moenichwald-preview` benötigen getrennte Datenbanken mit EU-Jurisdiktion. D1 Time Travel und geschützte SQL-Exporte ergänzen sich. Vor Freigabe Wiederherstellung in einer getrennten Datenbank proben.

World4You bietet paketabhängig MariaDB und Sicherungen an. Externer TLS-Zugriff bzw. ein sicherer Tunnel, der vorhandene Tarif und vertragliche Wiederherstellungsfristen sind für dieses Hosting nicht bestätigt. Eine MariaDB-Anbindung aus Pages würde einen zusätzlichen Verbindungsdienst oder ein separates Backend sowie Betriebs- und Latenzmessungen erfordern. Die native D1-Anbindung bleibt deshalb die Ausgangslösung. [Pages Bindings](https://developers.cloudflare.com/pages/functions/bindings/) · [D1 Datenstandort](https://developers.cloudflare.com/d1/configuration/data-location/) · [World4You Webhosting](https://www.world4you.com/hosting/web-hosting)

Better Auth 1.7.25 verifiziert einen einmaligen, gehashten E-Mail-Link. Ein Adapter speichert ausschließlich den SHA-256-Hash des temporären Better-Auth-Nachweises und die API entfernt ihn nach dem Austausch. Die anschließend verwendete Vereins-Session wird mit 256 Bit aus Web Crypto erzeugt und ebenfalls nur als Hash gespeichert. Das Secure-/HttpOnly-/SameSite-Cookie kann per Logout oder administrativer Kontensperre widerrufen werden. Eine erneute Anmeldung per E-Mail ersetzt den Passwort-Reset. Kontostatus, Rolle und Spielerzuordnung werden bei jeder geschützten Anfrage gelesen. [Better Auth D1](https://better-auth.com/blog/1-5)

## Dateien und Schnittstellen

| Bereich | Dateien |
| --- | --- |
| Fachlogik | `championships/domain/` für Auslosung, Rundenspielplan, Satzvalidierung, Rangfolge und Finalphase |
| SQL und Server | `championships/migrations/`, `championships/server/`, `functions/api/meisterschaften/`, `functions/api/spiele/`, `functions/api/meine-spiele.ts` |
| Oberfläche | `src/pages/meisterschaften/`, `src/components/championships/`, Einstieg auf `src/pages/turniere.astro` |
| Prüfungen | `tests/championships-*.test.mjs`, später Browserprüfungen für Wizard, Spieler und Bestätigung; bestehende GitHub-Prüfungen ergänzen |

Die SQL-Migration bildet Spielerprofile und eindeutige Kontenzuordnungen, Turniere, Teilnehmer, Phasen, Gruppen, Gruppenzuordnungen, Spiele, Sätze, Meldungen, Audit, Auslosungen und Entscheidungen ab. Die Auth-Migration folgt der nachgewiesenen Bibliothekskonfiguration. Spielversion, offizielles Ergebnis und Audit werden gemeinsam geschrieben. D1-Batch rollt bei Fehlern vollständig zurück; ein fehlgeschlagener Versionsvergleich muss deshalb auch nachfolgende Änderungen verhindern. [D1 Batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)

- `/api/meisterschaften` und `/:id` verwalten Liste und Stammdaten. Unterrouten für `teilnehmer`, `setzliste`, `auslosung/vorschau`, `auslosung/freigeben`, `gruppen`, `tabelle`, `spiele`, `vorrunde/abschliessen` und `folgephase`.
- `/api/spiele/:id` mit Aktionen `ergebnis`, `bestaetigen`, `beanstanden`, `admin-korrektur` und Terminplanung. `/api/meine-spiele` mit beteiligten Begegnungen. Separate Konten-, Freischaltungs- und Auth-Routen.
- Öffentliche Übersicht und Detail verwenden freigegebene Daten. Detailansichten für Gruppen, Spielplan und Finalphase. Spieleransicht mit Satzformular und Bestätigung. Admin-Wizard führt von Stammdaten über Setzliste und Gruppenvorschau bis zur Freigabe; eigenes Dashboard für Korrekturen und Berechtigungen.

## Fachliche Standards und Reihenfolge

Bei ungleich großen Gruppen fehlen gegebenenfalls die letzten Platzierungen. Eine einzelne Person in der letzten Platzierungsgruppe erhält einen Rang ohne Spiel. In der K.-o.-Qualifikation gehen gleichrangige Gruppenplätze vor; bei einem gruppenübergreifenden Schnitt wird eine vorab dokumentierte Reihenfolge benötigt. Mehrfachgleichstände werden nur bei vollständig gespieltem und eindeutigem direktem Vergleich aufgelöst; sonst ist ein begründeter Adminentscheid oder ein protokolliertes Los erforderlich. Bestätigte Folgespiele halten Korrekturen auf, bis ein Admin den Reset ausdrücklich entscheidet. Sonderwertungen wie Aufgabe und Walkover bleiben bis zur Definition ihrer Regeln deaktiviert.

1. Architektur, SQL-Constraints und Laufzeit verifizieren. Neue D1-Datenbanken leer beginnen; keine Kopie aus Buchung oder Demo.
2. Konten, Einladungen, Widerruf, Spielerzuordnung und Bootstrap des ersten Admins in isolierter Umgebung prüfen.
3. Stammdaten, Teilnehmer, Setzliste, reproduzierbare Auslosung und Spielplan verbinden.
4. Ergebnismeldungen, Versionierung, Tabellen und Audit testen. Beide Folgephasen mit Sperre und Vorschau integrieren.
5. Mobile Vereins-, Spieler- und Adminansichten einbinden. Browserchecks mit 375 px Breite sowie rollenabhängige API- und Integrationstests durchführen.
6. Produktive Freigabe nach Wiederherstellungsprobe, verifiziertem E-Mail-Versand, Admin-Einladung und Prüfung der bestehenden Reservierungs- und Kalenderfunktionen. Aufbewahrung und Löschfristen mit dem Verein vor Aufnahme realer Mitgliederdaten festlegen.

## Aktueller Stand

Lokal vorhanden sind die Fachlogik, die APIs für Meisterschaften, Auslosung und Phasen, die Ergebnis- und Konten-APIs, die passwortlose Authentifizierung und die Astro-Ansichten unter `/meisterschaften/`. SQLite-Tests decken unter anderem SQL-Constraints, Auslosung, Ergebnisbestätigung, Rollen, Session-Widerruf, veraltete Schreibversuche und den Abschluss eines Turniers ab. Die Oberfläche bietet den Einstieg, die öffentliche Ansicht, Anmeldung, „Meine Spiele“ und einen ersten Admin-Wizard. Ein Teil der weiterführenden Verwaltungsaktionen ist bisher nur über die API verfügbar.

## Cloudflare und SMTP in Betrieb nehmen

1. Die CLI `cf` ist für das Pages-Konto mit Endung `2730a1` autorisiert. Die EU-Datenbanken sind `tv-moenichwald-preview` (`bde2d396-68d9-4688-894c-830daeab4022`) und `tv-moenichwald` (`4186e577-ef5e-4644-b0c3-51203363b016`). Die Vorschau verwendet den Branch `meisterschaften-preview` und das Binding `DB`.
2. In Preview `DB` auf `tv-moenichwald-preview` und in Produktion auf `tv-moenichwald` binden. Die Migrationen `0001_competition.sql`, `0002_sessions.sql`, `0003_identity.sql` einmalig in dieser Reihenfolge je Datenbank ausführen. Erst Preview mit synthetischen Daten testen.
3. `nodejs_compat` für die Better-Auth-Laufzeit prüfen. In jedem Deployment `CHAMPIONSHIP_ORIGIN` auf den jeweiligen exakten HTTPS-Ursprung setzen. `CHAMPIONSHIP_AUTH_SECRET`, `CHAMPIONSHIP_SMTP_USER` und `CHAMPIONSHIP_SMTP_PASSWORD` als Secrets setzen. Ein Bootstrap-Admin erhält seine vorgesehene Kontokennung und E-Mail über `championship_memberships` und `championship_member_emails`. Es gibt keinen öffentlichen Bootstrap-Endpunkt.
4. Der SMTP-Transport nutzt Cloudflare TCP-Sockets, Port 587 und zwingendes STARTTLS mit Zertifikatsprüfung. Er sendet Anmeldedaten erst nach dem Upgrade und erwartet AUTH PLAIN. Mit dem Testpostfach den Eingang eines Anmeldelinks prüfen. Der lokale Protokolltest ersetzt diesen Live-Test nicht. [Cloudflare TCP-Sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) · [world4you SMTP](https://www.world4you.com/blog/domains/domaintipps/outlook-mit-eigener-domain)
5. Auf der Preview-URL Admin-Einladung, Spielablauf, beide Folgephasen und mobile Bedienung testen. Danach Produktionsdatenbank und Betriebssicherung separat verifizieren.

Den ersten Admin mit zwei parametrisierten SQL-Anweisungen in derselben Transaktion freischalten. Beide Parameter für die Kontokennung müssen dieselbe UUID verwenden; die E-Mail-Adresse wird beim ersten Login über Better Auth geprüft.

```sql
INSERT INTO championship_memberships (user_id, role, active) VALUES (?, 'admin', 1);
INSERT INTO championship_member_emails (user_id, email) VALUES (?, lower(trim(?)));
```

Lokal: `npm test` führt die Datenbank-, Workflow- und API-Tests aus. Nach `npm run build` prüft `npm run test:mobile` die Ergebnismeldung bei 375 px. Playwright kann das mit `npx playwright-core install chromium` installierte Chromium oder den Browser aus `CHAMPIONSHIP_BROWSER_PATH` verwenden.
