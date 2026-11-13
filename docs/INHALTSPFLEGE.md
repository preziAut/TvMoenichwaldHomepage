# Inhalte über GitHub pflegen

1. Datei im passenden Ordner unter `src/content/` öffnen. Für Änderungen einen neuen Branch und Pull Request erstellen.
2. Text beziehungsweise Daten ändern. Titel und URL bestehender Inhalte möglichst erhalten; bei URL-Änderungen die Weiterleitung ergänzen.
3. Automatische Prüfungen und Cloudflare-Vorschau prüfen, anschließend den Pull Request nach `main` übernehmen.

## Neuer Beitrag

Datei `src/content/beitraege/saisoneroeffnung.md` erstellen:

```md
---
title: "Saisoneröffnung"
url: "/beitraege/saisoneroeffnung/"
date: "2027-04-24"
modified: "2027-04-24"
year: "2027"
categories: ["Vereinsleben"]
description: "Informationen zum Start in die neue Saison."
image: ""
---

Hier steht der Text. **Fettschrift**, Listen und [Links](/kontakt/) sind möglich.
```

Für Beiträge ohne altes WordPress-Gegenstück `legacyId` weglassen. Keine erfundenen Termine veröffentlichen.

## Termin

Unter `src/content/termine/` eine JSON-Datei anlegen. Felder: `id`, `title`, `start`, `end`, `description`, `recurrence`, `allDay`, `url`. Beispiel: id `training-2027-05-01`, Start `2027-05-01T09:00:00`, Ende `2027-05-01T11:00:00`, URL `/termine/training-2027-05-01/`. Alle Zeiten gelten für Europe/Vienna. Die bestehenden Daten enthalten nur Einzeltermine; neue Wiederholungen als einzelne Termine eintragen, bis ein Wiederholungsmodell umgesetzt wird. `recurrence` dafür `none` setzen.

## Bilder und Galerien

Neue weboptimierte Bilder unter `public/media/` mit eindeutigem Namen hochladen (keine vorhandene Datei mit langfristigem Cache überschreiben). Bilder nach Möglichkeit in WebP mit maximal 1600 Pixel Breite und kleiner Vorschau mit 640 Pixel Breite speichern. Keine unnötigen Metadaten oder Originale mit privatem Inhalt hochladen.

Galeriedatei unter `src/content/galerien/`: `title`, `url` und `images`. Jedes Bild enthält `src`, optional `thumb`, `alt`, `caption` und `title`. Die Reihenfolge im Array ist die Reihenfolge der Galerie. Die URL muss `/galerien/<Dateiname ohne .json>/` sein. Bildunterschriften sind Klartext.

## Pflegehinweise

Ergebnisse sind Markdown-Dateien unter `ergebnisse/`, allgemeine Vereinsseiten unter `seiten/`. Die Startseite sowie die speziellen Kalender-/Galerieübersichten verwenden eigene Vorlagen. Kontaktpersonen befinden sich auf der Kontaktseite, technische Zieladressen zentral in `src/config.ts` beziehungsweise Cloudflare-Umgebungsvariablen.

Für alle neuen Inhalte: interne Links, Smartphone-Vorschau und Tippfehler prüfen. Die bisherigen Angaben sind ein historischer Sicherungsstand und müssen redaktionell aktualisiert werden.
