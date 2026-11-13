# Neues Buchungssystem – Datenaufnahme und Importprobe

Dieser Bereich enthält die erste Entwicklungsstufe: einen offline ausgeführten Import aus ep-3 sowie das Zielmodell. Noch keine neue öffentlich nutzbare Buchungsanwendung, keine Anmeldung und kein produktiver Datenbankwechsel.

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
