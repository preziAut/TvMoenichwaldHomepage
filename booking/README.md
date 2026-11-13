# Neues Buchungssystem – Datenaufnahme und Importprobe

Dieser Bereich enthält die ep-3-Importprobe sowie einen funktionsfähigen Buchungskern mit lokaler Testoberfläche. Noch keine neue öffentlich nutzbare Buchungsanwendung, keine produktive Anmeldung und kein produktiver Datenbankwechsel.

## Lokale Buchungsdemo

Node 24 verwenden. Aus `booking/`:

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run dev
```

Auf diesem Windows-Rechner ist Node 24 bereits unter `../node_modules/node/bin/node.exe` vorhanden. Alternativer Start: `../node_modules/node/bin/node.exe src/dev-server.ts`.

Adresse: http://127.0.0.1:4390/ . Demokonten für beide Vereine, je eine Mitglieds- und Adminrolle. Alle Daten sind erfunden, liegen in einer lokalen PGlite-Testdatenbank im Arbeitsspeicher und verschwinden beim Neustart. Die Demo ist ausschließlich an die Loopback-Adresse gebunden; Host- und Origin-Prüfungen begrenzen Zugriffe auf diese lokale Adresse. Nicht über einen Tunnel veröffentlichen. Rollenwechsel ist eine ausdrücklich lokale Testfunktion, keine echte Anmeldung.

Umgesetzt: Kalender und Buchung/Stornierung, Platzsperren durch Administratoren, Fristverwaltung pro Verein mit versionierten Regeln, bestehende Fristen pro Buchung, Audit-Einträge, Idempotenz, atomarer Überlappungsschutz, Öffnungszeiten/Zeitfenster/Dauerlimits sowie vereinsbezogene Autorisierung. Der Kalender gibt keine fremden Mitgliedskennungen oder internen Sperrbegründungen aus.

`src/service.ts` enthält die serverseitige Fachlogik. `src/database.ts` stellt den PostgreSQL-Transaktionsadapter bereit. `migrations/001_core.sql` enthält das neue Schema; diese eigens geschriebene Schemadatei darf in Git, SQL-Sicherungen weiterhin nicht. Die Migration wird in der Demo einmal auf einer leeren Datenbank ausgeführt; ein Produktions-Migrationsrunner fehlt noch.

Die TypeScript-Tests laufen lokal mit PGlite und in CI zusätzlich gegen einen frischen PostgreSQL-17-Dienst mit mehreren Verbindungen. **`BOOKING_TEST_DATABASE_URL` ausschließlich für eine leere, wegwerfbare Testdatenbank setzen**: Die Tests erzeugen Tabellen und leeren diese zwischen Fällen. Niemals eine echte Datenbank angeben.

Browserprüfung: Buchung und Stornierung, Adminänderung von zwei auf drei Stunden bei unveränderter alter Buchungsfrist, unabhängige Waldbach-Regeln sowie Smartphonebreite 390 px ohne horizontales Überlaufen. Produktive Identität/Passwortaktivierung, Mailversand, dauerhafte Betriebsdatenbank, Serien, vollständige Datenübernahme aus der Importprobe und Deployment bleiben weitere Entwicklungsarbeit. Demo und echte Importdaten werden nicht verbunden.

## Ausführen

Python 3.12 oder neuer, keine zusätzlichen Pakete. Aus dem Repository-Verzeichnis:

```powershell
python -m unittest discover -s booking/tests -v
python booking/tools/migrate.py --moenichwald ../SQLServerBackups/mysqlsvr47_world4you_com.sql --waldbach ../SQLServerBackups/mysqlsvr69_world4you_com.sql
```

Ergebnisse ausschließlich in `booking/.private/`: `rehearsal.sqlite3` enthält personenbezogene Daten, `audit.json` den aggregierten Prüfbericht. Dieses Verzeichnis ist von Git ausgeschlossen. Nicht in Cloudflare, Build-Artefakte oder öffentliche Downloadverzeichnisse kopieren. Lokale Dateizugriffe und Backups müssen auf berechtigte Personen beschränkt sein; die SQLite-Datei ist nicht selbst verschlüsselt.

Der Import liest SQL als Text, führt weder Quell-SQL noch PHP aus und schreibt mit gebundenen Parametern. Quellen bleiben unverändert. Wiederholungen ersetzen je Verein die Prüfdaten in einer gemeinsamen Transaktion; IDs sind durch `(Verein, Alt-ID)` eindeutig. Der Quell-Hash dokumentiert den Stand. Dieses Verhalten ist nur für die Testdatenbank vorgesehen: Niemals neue Buchungen mit einem alten Dump überschreiben.

Passwort-Hashes, Login-IP, Login-Sperren und erkannte Authentifizierungs-Metadaten werden nicht übernommen. Alle Zielkonten haben vorerst die Rolle `none`; aktive reguläre Konten werden für Passwortneuvergabe vorgemerkt, privilegierte Konten für manuelle Bestätigung. Gesperrte, gelöschte, deaktivierte und Platzhalterkonten bleiben inaktiv. Ein Aktivierungsmailer existiert noch nicht und es wird keine E-Mail versendet.

Alle übrigen Quellzeilen bleiben in `source_records` als private, nicht ausführbare Daten erhalten. Darunter befinden sich Profile, Mitspielernamen, Notizen, Preise, Rechnungspositionen, Serieninformationen, Veranstaltungen und Altkonfiguration. Diese Inhalte dürfen später nicht ungefiltert als HTML gerendert oder als Konfiguration angewendet werden. Unbekannte Authentifizierungsdaten in Freitext sind durch Schlüsselprüfung nicht ausgeschlossen; vor einem Produktivtransfer ist die Feld-Allowlist weiter einzugrenzen.

Konten, Plätze, Buchungen und gültige Reservierungsintervalle werden zusätzlich normalisiert. Verwaiste/ungültige Reservierungen bleiben im Quellbestand, erscheinen aber nicht im normalisierten Kalender. Überschneidungen werden gemeldet, nicht still aufgelöst. Ereignisse, Serien und Abrechnung sind in dieser Stufe nur erhalten, noch nicht in produktive Funktionen übersetzt.

## Aufnahme vom 13.11.2026

Beide Dumps wurden laut Exportkopf am 13.11.2026 erstellt. Das beweist nicht, dass auf dem Server seitdem keine Änderungen erfolgten. Vor Umschaltung ist ein neuer vollständiger Export bei gestoppten Schreibzugriffen erforderlich.

| Bestand | Mönichwald | Waldbach |
|---|---:|---:|
| Konten | 185 | 108 |
| Plätze | 2 | 2 |
| Buchungen einschließlich Stornierungen/Serien | 6.333 | 1.838 |
| Reservierungszeilen | 7.628 | 1.857 |
| Kalenderereignisse | 257 | 15 |
| Rechnungspositionen | 406 | 0 |

Alle 293 Passwortfelder entsprechen bcrypt mit Kostenfaktor 6. Der frisch beschaffte ep-3-Code bestätigt bcrypt; sein optionaler MD5-Fallback wird nicht übernommen. Vorhandene Konten lassen sich erhalten, die bisherige Anmeldung wird bewusst nicht reaktiviert.

Mönichwald: 771 Reservierungen ohne vorhandene Buchung, 364 verwaiste Metadatensätze, zwei ungültige Zeitintervalle, fünf überlappende Reservierungspaare. Waldbach: zwei überlappende Reservierungspaare. Überschneidungen sind Prüfhinweise: Ob sie historisch zulässig waren, muss fachlich geklärt werden. Es wurde nichts aus den Originalen entfernt.

## Erfasste Platzregeln

Beide Vereine: 06:00–24:00 Uhr, 30-Minuten-Raster, maximal zwei Stunden je Buchung, 14 Tage Vorausbuchung, Kapazitätswert 4, keine positive Obergrenze aktiver Buchungen in der vorhandenen Einstellung. Die Bedeutung von Kapazität und Menge für Einzel/Doppel muss vor der neuen Validierung bestätigt werden.

`range_cancel` wird laut `SquareValidator.php` in Sekunden ausgewertet: Mönichwald 36 Sekunden, Waldbach 7.200 Sekunden. **Nutzervorgabe: Die Stornierungsfrist wird im neuen System durch Vereinsadministratoren konfigurierbar.** Die Altwerte bleiben als Herkunft dokumentiert und sind noch keine freigegebenen Produktivdefaults.

Zeitwerte sind in ep-3 lokale Datum-/Uhrzeitfelder. Die frisch beschaffte Standardkonfiguration nennt Europe/Berlin; die tatsächlich alten Laufzeitkonfigurationen beider Vereine müssen noch bestätigt werden. `24:00:00` wird in der Probe auf 00:00 des Folgetags normalisiert. Noch keine automatische UTC-Konvertierung; Sommerzeitlücken und doppelte Ortszeiten müssen vor Produktion geprüft werden.

## Nächste Entwicklungsstufe

Siehe [Zielmodell](MODEL.md): private Testumgebung mit neuer API, Kalender und Kontenaktivierung, danach vollständige Importabnahme. Produktionshosting, Mailanbieter und Zugangsdaten werden erst für diese Stufe benötigt. Der laufende Astro-Auftritt und beide bisherigen Portale werden durch diese Importprobe nicht verändert.
