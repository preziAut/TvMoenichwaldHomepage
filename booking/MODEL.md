# Zielmodell und Umsetzung des neuen Buchungssystems

Status: Entwurf nach Prüfung beider ep-3-Dumps, 13.11.2026. Das ausführbare SQLite-Modell in `tools/migrate.py` dient ausschließlich der Importprobe. Ein erster PostgreSQL-Buchungskern ist in `src/service.ts` und `migrations/001_core.sql` implementiert: Vereine, Mitglieder, Plätze, Regelversionen, Belegungen und Audit-Ereignisse. Die lokale Oberfläche testet diesen Kern mit synthetischen Daten. Weitere unten beschriebene Entitäten sind noch Entwurf.

## Grenzen und Identitäten

Mönichwald und Waldbach sind getrennte Vereinsbereiche. Jeder Datensatz und jede API-Abfrage enthält den Verein. Alt-IDs sind nur innerhalb eines Vereins eindeutig. Keine automatische Kontenzusammenführung anhand von E-Mail oder Namen. Der Server leitet den Verein aus der berechtigten Mitgliedschaft ab; eine vom Browser gesendete Vereins-ID allein gewährt keinen Zugriff.

| Entität | Zweck und Herkunft |
|---|---|
| clubs | Verein, Zeitzone, Anzeigename |
| accounts | Konto je Verein; Alt-ID, Alias, bestätigte E-Mail, Aktivierungszustand |
| memberships | Rolle und Vereinsstatus; alte `admin`/`assist`-Rechte erst nach Bestätigung |
| profiles | freigegebene Stammdaten aus `users_meta`; sensible Notizen getrennt |
| credentials / sessions | ausschließlich neue Zugangsdaten/Sitzungen; keine alten Hashes oder Reset-Tokens |
| courts | Plätze und freigegebene Betriebszeiten, Status und Reihenfolge |
| booking_policy_versions | versionierte Buchungsregeln pro Verein, später optionale Platzabweichungen |
| bookings | buchendes Konto, Platz, Sichtbarkeit, Status, Erstellungszeit, Regelversion |
| occurrences | konkrete Zeitintervalle einer Buchung; einzeln stornierbar |
| participants | Mitspieler aus `player-names`; Namen erzeugen keine neuen Konten |
| recurring_series | Seriendefinition aus Buchungsmetadaten; bestehende Termine zuerst 1:1 übernehmen |
| court_allocations | gemeinsame Belegungen für Reservierungen und Platzsperren, verhindert konkurrierende Belegung |
| events | Training, Turnier und Sperren; `sid=NULL` kann alle Plätze betreffen, Kapazität prüfen |
| billing_items | historische Positionen und Zahlungsstatus, ganzzahlige Beträge; keine Zahlung auslösen |
| audit_events / outbox | nachvollziehbare Änderungen und zuverlässig nach Commit verschickte Nachrichten |
| import_sources / legacy_map / migration_issues | Herkunft, Zuordnung, offene Fälle und dokumentierte Freigabe |

## Konfigurierbare Stornierungsfrist

Ein Vereinsadministrator kann die Frist in Minuten oder Stunden einstellen. Die API speichert eine validierte ganzzahlige Sekundenzahl, zeigt den berechneten Zeitpunkt verständlich an und protokolliert Änderung, Bearbeiter und Zeitpunkt. Negative Werte werden abgelehnt. „Stornieren deaktiviert“ ist ein eigener Schalter; 0 bedeutet ausdrücklich „bis zum Beginn“, nicht implizit „deaktiviert“ wie im Altcode.

Eine neue Einstellung erzeugt eine neue Regelversion. Jede Buchung erhält die beim Abschluss geltende Regelversion und einen berechneten Stornierungsschluss. Bestehende Buchungen behalten ihre Frist. Für importierte zukünftige Buchungen braucht es eine einmalige bestätigte Ausgangsregel. Bei Serien gilt die Frist je konkretem Termin; Sammelstornierung muss die betroffenen Termine vor Bestätigung anzeigen. Administratoren dürfen begründet übersteuern; dies wird protokolliert.

Weitere konfigurierbare Regeln: Vorausbuchung, minimale/maximale Dauer, Zeitraster, Öffnungszeiten, aktive Buchungslimits. Änderungen werden auf dem Server validiert, nicht nur im Formular. Die Oberfläche bietet Kalender, eigene Buchungen und einen getrennten Administrationsbereich.

## Speicherung und konkurrierende Buchungen

Für die Produktionsdatenbank ist PostgreSQL vorgesehen; API und interaktive TypeScript-Oberfläche werden getrennt vom statischen Astro-Build betrieben. Der konkrete Anbieter bleibt bis zur Betriebsentscheidung offen. Die SQLite-Probe ist kein Vorschlag, die öffentliche Website auf eine lokale Datei zugreifen zu lassen.

Zeitintervalle werden nach bestätigter Quellzeitzone in UTC überführt, zusätzlich bleibt die Vereinszeitzone erhalten. Intervalle sind halboffen `[Beginn, Ende)`: unmittelbar anschließende Buchungen sind zulässig. Nicht existierende oder mehrdeutige Ortszeiten werden zur Prüfung angehalten.

In PostgreSQL soll eine Exclusion Constraint auf `(club_id, court_id, tstzrange)` überschneidende aktive `court_allocations` verhindern. Buchungen und Sperren nutzen dieselbe Belegungstabelle. So entscheidet die Datenbank atomar über konkurrierende Anfragen. Serien werden in einer Transaktion angelegt, wiederholte Requests erhalten einen Idempotenzschlüssel. Grundlage: [PostgreSQL Range Types](https://www.postgresql.org/docs/current/rangetypes.html).

Historische Konflikte dürfen nicht durch Abschalten dieser Integritätsregel in produktive Belegungen gelangen: getrennt archivieren oder mit dokumentierter Entscheidung auflösen. Bestehende Kapazitäts-/Mengenlogik vor Einführung einer exklusiven Platzbelegung fachlich bestätigen.

## Aktivierung und Berechtigungen

Nur bestätigte aktive Konten erhalten eine zeitlich begrenzte Aktivierungsmöglichkeit über eine geprüfte Adresse. Tokens werden zufällig erzeugt, nur gehasht gespeichert, einmalig verbraucht und nach Passwortvergabe ungültig. Keine E-Mail ist Teil der Importprobe. Konten ohne eindeutige geeignete Adresse benötigen persönliche Zuordnung durch berechtigte Vereinsverwaltung.

Gesperrte, gelöschte, deaktivierte und Platzhalterkonten bleiben inaktiv. Adminrollen werden separat bestätigt, nicht aus einem alten Status ungeprüft freigegeben. Sitzungen, CSRF-Schutz, Rate Limits, Autorisierung je Ressource und sichere Passwortvergabe werden vor öffentlicher Anmeldung implementiert und getestet. Keine Namen/E-Mails/Passwortdaten in öffentlichen Kalenderantworten oder Logs.

## Prüfschritte bis zur Umschaltung

1. Importabweichungen klären, vollständige Quellzeilen zählen, Ereignisse/Serien/Preise und Rollen zuordnen. Bestätigte Auswahl der benötigten Profildaten und Aufbewahrung alter Notizen.
2. Neues Datenbankschema und API mit synthetischen Daten testen: Vereinsisolation, Stornierungsgrenzen, Doppelbuchungsrennen, Sperren, Serien und Wiederholungsrequests.
3. Kalender, Kontoaktivierung und Admin-Regelverwaltung in einer geschützten Testumgebung fertigstellen.
4. Beide Datenbestände erneut importieren, Termin- und Kontenzahlen abgleichen; unterschiedliche Kontostatus sowie Buchung/Stornierung und Mailversand praktisch prüfen.
5. Alte Schreibzugriffe für ein abgestimmtes Zeitfenster stoppen, frische Dumps sichern, final importieren, kontrollieren und erst dann neue Buchungen zulassen.
6. Nach der ersten neuen Buchung kein einfaches Zurückspielen eines alten Dumps: Rückfall muss neue Buchungen berücksichtigen. Alte Portale während der Umschaltung nicht parallel schreibend betreiben.

Offen: bestätigte Adminpersonen, tatsächliche Quellzeitzonen, Kapazitätslogik, freigegebene Anfangsregeln, aktuelle Daten nach dem Export, Hosting und Versanddienst. Keine dieser offenen Entscheidungen wird aus bloßem Ablauf von Zeit als freigegeben behandelt.
