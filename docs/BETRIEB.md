# Deployment und Betriebsübergabe

## Zielaufteilung

- Hauptwebsite: Cloudflare Pages, vom Nutzer bereitgestelltes öffentliches GitHub-Repository `preziAut/TvMoenichwaldHomepage`, Branch `main`, Build `npm run build`, Ausgabe `dist`, Node 24.
- Mönichwald: World4You, bestehende Subdomain `platz.tv-moenichwald.at`, eigenes ep-3 und eigene Datenbank.
- Waldbach: World4You, eigene neue Subdomain vor dem Websiteumzug einrichten. Bisher tatsächlich `https://www.tv-moenichwald.at/ep3wa` (nicht schon eine separate Subdomain!). Vorgeschlagen: `waldbach.tv-moenichwald.at`.
- Domainregistrierung, MX/TXT-Mail-Einträge und Mailkonten bei World4You erhalten.

## Konfiguration

Cloudflare Pages mit dem GitHub-Repository verbinden. Buildvariablen:

| Variable | Zweck |
|---|---|
| `PUBLIC_WALDBACH_URL` | Geprüfte neue HTTPS-Adresse des Waldbach-Portals |
| `PUBLIC_WEBCAM_URL` | HTTPS-Bildquelle auf dem alten Host oder separater Webcam-Subdomain |
| `PUBLIC_TURNSTILE_SITE_KEY` | Öffentlicher Turnstile-Schlüssel für freigegebene Hostnamen |
| `PUBLIC_SITE_APPROVED` | Erst nach vollständiger Abnahme `true` setzen |

Functions-Secrets: `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `CONTACT_FROM` (verifizierter Absender), `CONTACT_TO` (Vereinsadresse). Nicht in Git oder PUBLIC_-Variablen eintragen. Runtime-Konfiguration `WALDBACH_URL` und `WEBCAM_URL` analog zu den Buildvariablen setzen. Für Produktion und Preview getrennt konfigurieren; Preview soll keine echten E-Mails versenden.

Resend-Absenderdomain verifizieren und erforderliche DNS-Einträge ergänzen, ohne bestehende Mail-Einträge zu ersetzen. Turnstile auf die erlaubten Hostnamen beschränken. `/api/contact` per Cloudflare-Regel zusätzlich auf z. B. fünf POST-Anfragen pro Minute je IP begrenzen, sofern der gewählte Tarif diese Regel unterstützt. Der Endpunkt prüft unabhängig davon Origin, Größen, Felder, Honeypot, Turnstile-Hostname und -Action; ohne Secrets liefert er 503.

In Pages einen Deploy Hook einrichten und im GitHub-Repository als `CLOUDFLARE_DEPLOY_HOOK` hinterlegen. Der tägliche Workflow aktualisiert die zeitabhängigen Terminlisten. Jeder Git-Push wird über die Pages-Git-Integration gebaut. Bei privaten Vorschauen Zugangsschutz aktivieren; noindex allein verhindert keinen Zugriff.

## Weiterleitungen

`functions/_middleware.js` verarbeitet alte WordPress-IDs und Medienpfade anhand der generierten Zuordnungstabellen. Unbekannte IDs liefern 404. `/ep3wa/...` wird erst bei konfiguriertem `WALDBACH_URL` unter Erhalt von Pfad und Query temporär weitergeleitet. Nicht auf denselben Hauptdomain-Ursprung konfigurieren (Schleifenschutz). Unbekannte alte Permalinks vor Freischaltung anhand der tatsächlichen URL-Liste prüfen.

Die bisherigen Webcam-Adressen unter `/joomla/` dürfen nach dem Hauptdomainwechsel nicht auf einen abgebauten Pfad zeigen. Die Kamera beziehungsweise ihr Upload muss auf einem getrennten Host weiterlaufen. Quell-HTTPS und tatsächliche Bildaktualisierung testen. Ohne bestätigte Quelle bleibt das Bild deaktiviert.

## Noch notwendige Freigaben und Live-Prüfungen

Diese Punkte sind nicht durch den lokalen Build erledigt:

- Domainzuordnung und produktive Umgebungsvariablen. Pages-Projekt und Git-Integration sind eingerichtet (siehe unten).
- World4You-Vertrag, Dokumentenverzeichnisse, PHP-Erweiterungen, Datenbankzugang und Backup-Wiederherstellung prüfen.
- Mönichwald und Waldbach mit aktuellen Datenständen in geschützter Umgebung testen. Der vorhandene Wiederherstellungsbericht bestätigt keine öffentliche Betriebsfreigabe. Waldbach benötigt eine eigene Aufbereitung mit frischen Herstellerdateien.
- Für beide Portale Login, Passwortzurücksetzen, Rollen, Platzverfügbarkeit, Reservierung/Stornierung und SMTP prüfen. Keine Testbuchungen auf Produktivdaten ohne abgestimmten Testablauf.
- Waldbach-Subdomain vor Umschaltung aktivieren; ursprüngliche Hauptdomain-Pfadabhängigkeiten und Cookies prüfen.
- Webcam-Quelle prüfen; bisherige Quelle `/joomla/images/webcampic/tv.jpg`.
- Widersprüchliche Saisonkartenpreise auf den Altseiten IDs 60 und 698 klären; beide Quelltexte sind erhalten und derzeit entsprechend gekennzeichnet.
- Verantwortlichen Rechtsträger, Adresse, Vereinsdaten und Datenschutzhinweise bestätigen. Es wurde im bekannten regulären Seitenbestand kein vollständiges separates Impressum gefunden; die neuen Texte sind ausdrücklich noch nicht freigegeben.
- Einmaliger echter Kontaktversand und Empfangstest mit eingerichtetem Dienst; lokale Tests simulieren den Mailanbieter.

## Umschaltung und Rückfall

1. Frische Datei-/Datenbanksicherungen erstellen und Wiederherstellung getrennt testen.
2. Beide Buchungsportale und die Webcam vom Hauptdomain-Webhosting entkoppeln.
3. Website auf Pages-Vorschau abnehmen; relevante Altlinks und Mailversand prüfen.
4. Nur Website-DNS ändern. MX, SPF, DKIM, DMARC und Buchungsadressen erhalten.
5. Nach erfolgreicher Prüfung WordPress öffentlich abschalten und dessen Archiv außerhalb des Webroots aufbewahren.
6. Für Rollback eine bekannte funktionierende Astro-Version in Pages erneut bereitstellen. Buchungsdatenbanken werden beim Websitewechsel nicht verändert.

Tägliche Buchungsdatenbanksicherungen getrennt speichern, Wiederherstellung regelmäßig üben. Zuständigkeit für PHP-/ep-3-Updates bleibt bestehen. Website-Fehler und 404-Aufrufe datensparsam auswerten; keine Formulardaten oder Tokens in Logs schreiben.

## Andere Hosts

`dist/` ist statisches HTML und kann auf World4You oder GitHub Pages ausgeliefert werden. Dort funktionieren Cloudflare Functions nicht automatisch: Alt-ID-Weiterleitungen, Kontaktformular und Waldbach-Übergang benötigen dort ein ausdrücklich eingerichtetes Äquivalent. Ein Wechsel ist daher kein bloßes Kopieren mit unveränderter Funktionszusage.

## Lesende Live-Prüfung am 13.11.2026

Die Astro-Website ist unter https://tv-moenichwald.pages.dev veröffentlicht. Projekt `tv-moenichwald`, Konto `49a1b0704700ec0810ec88b5de2730a1`, automatische Builds aus `main`, Build `npm run build`, Ausgabe `dist`. Der Nutzer hat den Migrationsbranch in `main` zusammengeführt. Die Vereinsdomain wurde nicht umgestellt. Die bestehende MCP-Verbindung ist noch einem anderen Cloudflare-Konto zugeordnet; dieses Projekt wurde über das ausgewählte Browserkonto eingerichtet.

Deploy Hook für den täglichen Neubuild und produktive Mail-/Turnstile-/Buchungs-/Webcam-Variablen sind noch nicht eingerichtet. Die Prüfadresse bleibt bis zur Freigabe auf `noindex,nofollow`.

Die HTTPS-Adressen für Mönichwald, Waldbach und das bisherige Webcam-Bild lieferten jeweils HTTP 403. Kein Login, keine Buchung und kein Versand wurden produktiv durchgeführt. Dies ist keine Funktionsabnahme.
