# Sekturnier

## Einstieg

Admins öffnen die Verwaltung und wählen beim Anlegen eines Events den Typ „Sekturnier (Doppelturnier)“. Name, Beginn und Games-Standard werden dort erfasst. Nach dem Speichern öffnet sich die eigene Turnierverwaltung. Die gemeinsame Icon-Navigation und die sanften Seitenwechsel gelten auch hier.

Teilnehmende werden aus den vorhandenen Vereinskontakten ausgewählt. Neue Kontakte verwenden dieselbe Prüfung auf doppelte Namen wie Einzelmeisterschaften. Die bestehenden Verknüpfungen zwischen Kontakt und Vereinskonto bleiben damit verwendbar. Für die erste Version tragen ausschließlich Admins Endergebnisse ein.

## Festgelegte Regeln

Die drei offenen Entscheidungen aus der Arbeitsfassung wurden am 19. November 2026 bestätigt.

- Ein vollständiges Ergebnis liegt vor, wenn mindestens eine Seite die Games-Vorgabe erreicht und keine Seite darüber liegt. Bei vier Games sind 4:2 und 4:4 gültig. Das Endergebnis wird ausdrücklich bestätigt.
- Ungleiche Töpfe sind zulässig. Die Turnierleitung wählt pro Topf genau die benötigten unterschiedlichen Aushilfen aus. Jede Person spielt höchstens zweimal pro Runde.
- Die öffentliche Tabelle ist über einen Leselink ohne Anmeldung verfügbar. Admins können die Freigabe über die Turniereinstellungen ändern.

Jede Person erhält genau einen gewerteten Einsatz pro Runde. Ein zusätzlicher Einsatz einer Aushilfe zählt für ihre eigene Rangliste nicht. Diese Kennzeichnung steht mit der Auslosung fest und kann durch spätere Ergebnisse nicht verändert werden. Jede Partie enthält vier unterschiedliche Personen, jedes Team eine Person aus jedem Topf. Wiederholte Partner und Gegner in späteren Runden sind erlaubt.

Vor der Auslosung lassen sich Töpfe und Games-Vorgabe ändern. Eine neue Runde übernimmt die vorherigen Töpfe und deren Games-Vorgabe. Aushilfen werden neu ausgewählt. Erst nach Abschluss der aktuellen Runde lässt sich die nächste vorbereiten.

Rangfolge entsteht ausschließlich aus der Summe gewerteter Games. Bei gleicher Summe gilt derselbe Rang. Die Tabelle zeigt zusätzlich die Zahl bereits gewerteter Einsätze. Eine laufende Runde ist als vorläufig markiert. Endergebnisse und Korrekturen aktualisieren die Adminansicht sofort; andere offene Ansichten fragen den Stand alle acht Sekunden ab. Verdeckte Tabs pausieren diese Abfragen.

Eine erneute Auslosung benötigt eine ausdrückliche Rücksetzung mit Grund. Sobald ein Ergebnis vorliegt, ist sie gesperrt. Ergebniskorrekturen benötigen einen Kommentar und bleiben auch nach Abschluss für Admins möglich. Frühere Rundenzuordnungen bleiben erhalten. Änderungen erscheinen in der Adminhistorie mit Zeitpunkt, Bearbeiter und gegebenenfalls altem sowie neuem Ergebnis.

Das Turnier verwaltet keine Platzbelegung. Die Turnierleitung plant die beiden Spiele einer Aushilfe nacheinander.

## Speicherung und Veröffentlichung

Die Erweiterung verwendet die vorhandene D1-Vereinsdatenbank und Vereinssitzung. Die additive Migration steht in `championships/migrations/0007_sekt.sql`. Sie legt sieben neue Tabellen an und referenziert die bestehenden Kontakte und Konten. Die Vorschau-Datenbank hat diese Migration erhalten. Die Produktionsdatenbank benötigt sie vor einer produktiven Veröffentlichung ebenfalls.

Jede Änderung prüft die Eventversion und die aktuelle Adminberechtigung innerhalb desselben Datenbank-Batches. Ergebnisspeicherung, Versionsänderung und Audit werden gemeinsam durchgeführt. Zusätzliche Spielversionen verhindern das Überschreiben parallel korrigierter Ergebnisse. Die Rangliste wird aus den gespeicherten Einsätzen abgeleitet, sodass wiederholtes Speichern keine Punkte addiert.

## Prüfungen

- `npm test` prüft die Fachlogik, die komplette API einschließlich fünf Runden und die bisherigen Einzelmeisterschaften.
- `npm run test:sekt` spielt über die Browseroberfläche ein Turnier mit 15 bestehenden Kontakten und zwei Runden durch. Es verwendet die echten API-Handler mit einer isolierten SQLite-Datenbank. Ein zweiter Browserkontext prüft die öffentliche, automatisch aktualisierte Rangliste.
- `npm run test:navigation` prüft Rechte, flüssige Seitenwechsel, Browserhistorie und reduzierte Bewegung bei 375 und 1280 Pixeln.

Für die Browsertests kann `CHAMPIONSHIP_BROWSER_PATH` auf eine vorhandene Chromium- oder Edge-Installation zeigen. Die Tests verwenden ausschließlich synthetische Kontakte.
