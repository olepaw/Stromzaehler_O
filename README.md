# stromott – Energie im Blick

Deutschsprachige, responsive Website für den öffentlichen ThingSpeak-Stromzählerkanal **2184811**. React, TypeScript und Vite; vollständig als statische Website betreibbar.

## Starten

Voraussetzung: Node.js 22.12 oder neuer (in der Cloud ist Node.js 24 vorhanden).

```sh
npm ci
npm run dev
```

Vite zeigt die Adresse des Entwicklungsservers an. In der Cloud gegebenenfalls die Port-Vorschau für Port 5173 verwenden. Die Website lädt den öffentlichen ThingSpeak-Kanal automatisch. Ein API-Schlüssel ist nicht nötig.

```sh
npm test                 # Berechnungen, Zeitzonen, Datenlücken, Abfrageaufteilung
npm run build            # TypeScript-Prüfung und Produktionsbuild
npm run preview          # Produktionsbuild lokal prüfen
npm run test:browser     # Bedienung mit kontrollierten Testdaten; laufenden Server benötigt
```

`npm run test:browser` verwendet vorhandenes Chromium (`CHROMIUM_PATH` optional). Mit `STROM_LIVE_TEST=1 npm run test:browser` wird zusätzlich der echte öffentliche Kanal über den vorhandenen HTTPS-Netzwerkzugang geprüft. Dazu muss `curl` installiert und `api.thingspeak.com` erreichbar sein. Tests umgehen weder TLS-Prüfung noch Netzwerkrichtlinien.

## Funktionen

- **Zeitraum-Suche:** Heute, Gestern, 7 Tage, 30 Tage oder frei wählbares Datum mit Uhrzeit. Alle Eingaben und Anzeigen folgen `Europe/Berlin`.
- **Verbrauchsfilter:** Mindest- und Höchstverbrauch je Stunde, Tag oder Monat. Treffer erscheinen im Verbrauchsdiagramm und in einer Intervalltabelle; der Verbrauchs-CSV-Export berücksichtigt die Filter. Die Übersichtszahlen gelten für den gesamten Zeitraum. Der Verlauf der Originalzählerstände bleibt ungefiltert.
- **Variable Diagramme:** Verbrauch, mittlere Leistung und kumulierte Zählerstände; Balken, Fläche oder Linie; stündliche, tägliche oder monatliche Auflösung, auswählbare Datenreihen und Zoom-Bereich.
- **Messwerte:** Originalwerte durchsuchen, nach Zeitpunkt sortieren, seitenweise ansehen und Treffer als CSV exportieren.
- **Kennzahlen:** Erfasster Netzbezug und Einspeisung, gemessene Leistungsspitze, geschätzte Kosten ohne Grundpreis.
- **Einstellungen:** Öffentliche Kanal-ID, Feldzuordnung, kWh/Wh, W/kW und Strompreis. Einstellungen bleiben lokal im Browser.
- **Aktualisierung:** Relative Zeiträume können minütlich neu geladen werden. Individuelle und abgeschlossene Zeiträume bleiben fest.
- **Demo:** Bei einer fehlenden Verbindung lassen sich ausdrücklich gekennzeichnete Beispieldaten zum Ausprobieren aktivieren. Es gibt keinen stillen Wechsel von Live- zu Beispieldaten.

## Daten und Berechnung

Die Voreinstellung interpretiert `field1` (Eingang) und `field2` (Ausgang) als kumulierte Zählerstände in **kWh**; `field3` (Leistung) als **Watt**. Die API bestätigt die Feldnamen, aber liefert keine verlässliche Einheitendefinition. Einheiten bitte in den Einstellungen mit dem verwendeten Zähler abgleichen. Der voreingestellte Strompreis von **0,32 €/kWh** ist ein editierbarer Beispielpreis.

Verbrauch ist die positive Differenz aufeinanderfolgender gültiger Zählerwerte. Zur Zuordnung auf Intervallgrenzen wird zwischen benachbarten Messungen linear interpoliert. Der vorhergehende Wert und bei historischen Zeiträumen der erste folgende Wert werden zusätzlich abgefragt. Das ist eine Schätzung innerhalb eines Messintervalls, keine Messung exakt an der Grenze.

Messlücken über zwei Stunden und sinkende Zählerstände werden nicht als Verbrauch gerechnet. Fehlende Werte bleiben fehlend. Die Oberfläche kennzeichnet unvollständige Abdeckung; Verbrauch und Kosten umfassen dann nur den erfassten Anteil. Leistungswerte werden pro Intervall als arithmetischer Mittelwert berechnet. Der gewählte Zeitraum ist halboffen: **Von einschließlich, Bis ausschließlich**. Verbrauchsberechnungen dürfen den Randwert bei „Bis“ zur Interpolation nutzen.

Abfragen laufen direkt gegen `https://api.thingspeak.com/channels/{id}/feeds.json`. CORS wird von ThingSpeak unterstützt. Zeiträume werden in Fenster geteilt und bei Erreichen des API-Limits von 8.000 Einträgen rekursiv verkleinert. Überlappende Antworten werden dedupliziert. Damit die Anwendung bedienbar bleibt, gelten ein Jahr pro Suche, maximal 240 API-Abfragen und ein Timeout pro Anfrage. Abfragen können abgebrochen werden. Bei sehr großen Datenmengen empfiehlt sich ein kleinerer Zeitraum. Nur die Darstellung von Originalzählerständen wird auf etwa 1.500 Punkte ausgedünnt; Messwerte und CSV bleiben vollständig.

## Bereitstellen

```sh
npm run build
```

Den Inhalt von `dist/` auf einem statischen HTTPS-Host bereitstellen, beispielsweise GitHub Pages, Netlify oder einen eigenen Webserver. Schriften, Icons und Diagrammbibliotheken sind im Build enthalten; es werden keine externen Schriftanbieter benötigt. Die Website hat keine Backend- oder Datenbankabhängigkeit.

### GitHub Pages

Im Repository unter **Settings → Pages → Build and deployment → Source** die Option **GitHub Actions** wählen. Der Workflow **Website veröffentlichen** baut und testet die Website bei Änderungen an `main`. Falls der erste Lauf vor der Pages-Aktivierung fehlgeschlagen ist, unter **Actions → Website veröffentlichen → Run workflow** erneut starten.

Der Workflow berücksichtigt den Unterpfad des Repositorys. Für eine lokale Prüfung desselben Builds:

```sh
VITE_BASE_PATH=/Stromzaehler_Ott/ npm run build
VITE_BASE_PATH=/Stromzaehler_Ott/ npm run preview
```

Die Standardadresse nach erfolgreicher Veröffentlichung lautet `https://olepaw.github.io/Stromzaehler_Ott/`. Diese Adresse funktioniert erst, wenn Pages aktiviert ist und der Workflow erfolgreich abgeschlossen wurde. Bei einem privaten Repository hängt die Verfügbarkeit von GitHub Pages vom GitHub-Tarif ab; eine Änderung der Repository-Sichtbarkeit ist für diese Anleitung nicht erforderlich und wird nicht automatisch vorgenommen.

Cloud-Netzwerkfreigabe für Entwicklung/Live-Tests: `api.thingspeak.com` zusätzlich zu den Paketregistrierungen. Die Website schreibt nicht in ThingSpeak und enthält keinen Read- oder Write-API-Schlüssel. Zugangsdaten gehören nicht ins Repository.
