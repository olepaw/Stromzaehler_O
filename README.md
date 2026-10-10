# stromO – Energie im Blick

Deutschsprachige, responsive Website für den öffentlichen ThingSpeak-Stromzählerkanal **2184811**. React, TypeScript und Vite; vollständig als statische Website betreibbar.

## Starten

Voraussetzung: Node.js 22.12 oder neuer (in der Cloud ist Node.js 24 vorhanden).

```sh
npm ci
npm run dev
```

Vite zeigt die Adresse des Entwicklungsservers an. In der Cloud gegebenenfalls die Port-Vorschau für Port 5173 verwenden. Die Website lädt den öffentlichen ThingSpeak-Kanal automatisch. Ein API-Schlüssel ist nicht nötig.

```sh
npm test                 # Berechnungen, Zeitzonen, Datenlücken, Abfrageaufteilung und Cache
npm run build            # TypeScript-Prüfung und Produktionsbuild
npm run preview          # Produktionsbuild lokal prüfen
npm run test:browser     # Bedienung mit kontrollierten Testdaten; laufenden Server benötigt
```

`npm run test:browser` verwendet vorhandenes Chromium (`CHROMIUM_PATH` optional). Mit `STROM_LIVE_TEST=1 npm run test:browser` wird zusätzlich der echte öffentliche Kanal über den vorhandenen HTTPS-Netzwerkzugang geprüft. Dazu muss `curl` installiert und `api.thingspeak.com` erreichbar sein. Tests umgehen weder TLS-Prüfung noch Netzwerkrichtlinien.

## Funktionen

- **Zeitraum-Suche:** Heute, Gestern, 7 Tage, 30 Tage oder frei wählbares Datum mit Uhrzeit. Alle Eingaben und Anzeigen folgen `Europe/Berlin`.
- **Verbrauchsfilter:** Mindest- und Höchstverbrauch je Stunde, Tag oder Monat. Treffer erscheinen im Verbrauchsdiagramm und in einer Intervalltabelle; der Verbrauchs-CSV-Export berücksichtigt die Filter. Die Übersichtszahlen gelten für den gesamten Zeitraum. Der Verlauf der Originalzählerstände bleibt ungefiltert.
- **Variable Diagramme:** Verbrauch, mittlere Leistung und kumulierte Zählerstände; Balken, Fläche oder Linie; stündliche, tägliche, monatliche oder individuelle Auflösung, auswählbare Datenreihen und Zoom-Bereich. Bei „Individuell“ eine Stundenzahl eingeben und „Übernehmen“ wählen: erlaubt sind 1, 2, 3, 4, 6, 8, 12 und 24 Stunden. Andere Eingaben werden auf den nächsten passenden Teiler von 24 aufgerundet; 5 wird zu 6, also vier Abschnitte pro Tag.
- **Messwerte:** Originalwerte durchsuchen, nach Zeitpunkt sortieren, seitenweise ansehen und Treffer als CSV exportieren.
- **Kennzahlen:** Erfasster Netzbezug und Einspeisung, gemessene Leistungsspitze, geschätzte Kosten ohne Grundpreis.
- **Einstellungen:** Öffentliche Kanal-ID, Feldzuordnung, kWh/Wh, W/kW und Strompreis. Einstellungen bleiben lokal im Browser.
- **Aktualisierung:** Relative Zeiträume können minütlich neu geladen werden. Individuelle und abgeschlossene Zeiträume bleiben fest.
- **Datencache:** Asynchrone Speicherung in IndexedDB, auch nach dem Neuladen der Seite. Überschneidende Suchen verwenden dieselben Zeitfenster. Aktuelle, unvollständige und innerhalb der letzten 24 Stunden abgeschlossene Fenster gelten eine Minute, ältere abgeschlossene Fenster 24 Stunden. Der Aktualisieren-Knopf umgeht den Cache. Unter Einstellungen lässt sich der Datencache leeren.
- **Demo:** Bei einer fehlenden Verbindung lassen sich ausdrücklich gekennzeichnete Beispieldaten zum Ausprobieren aktivieren. Es gibt keinen stillen Wechsel von Live- zu Beispieldaten.

## Daten und Berechnung

Die Voreinstellung interpretiert `field1` (Eingang) und `field2` (Ausgang) als kumulierte Zählerstände in **kWh**; `field3` (Leistung) als **Watt**. Die API bestätigt die Feldnamen, aber liefert keine verlässliche Einheitendefinition. Einheiten bitte in den Einstellungen mit dem verwendeten Zähler abgleichen. Der voreingestellte Strompreis beträgt **0,27 €/kWh** und bleibt editierbar. Bereits gespeicherte Browser-Einstellungen werden beim Umstieg auf den neuen Namen übernommen; der bisherige Preis wird dabei einmal auf 0,27 €/kWh gesetzt.

Individuelle Abschnitte beginnen täglich um 00:00 Uhr in Berlin. Sechs Stunden ergeben 00–06, 06–12, 12–18 und 18–24 Uhr. An Tagen mit Zeitumstellung kann die tatsächliche Dauer eines Abschnitts abweichen; nicht existierende Uhrzeiten werden zur nächsten gültigen Uhrzeit verschoben. Bei einer Stunde bleiben die tatsächlich vorhandenen 23 bzw. 25 Stunden getrennt.

Verbrauch ist die positive Differenz aufeinanderfolgender gültiger Zählerwerte. Zur Zuordnung auf Intervallgrenzen wird zwischen benachbarten Messungen linear interpoliert. Der vorhergehende Wert und bei historischen Zeiträumen der erste folgende Wert werden zusätzlich abgefragt. Das ist eine Schätzung innerhalb eines Messintervalls, keine Messung exakt an der Grenze.

Messlücken über zwei Stunden und sinkende Zählerstände werden nicht als Verbrauch gerechnet. Fehlende Werte bleiben fehlend. Die Oberfläche kennzeichnet unvollständige Abdeckung; Verbrauch und Kosten umfassen dann nur den erfassten Anteil. Leistungswerte werden pro Intervall als arithmetischer Mittelwert berechnet. Der gewählte Zeitraum ist halboffen: **Von einschließlich, Bis ausschließlich**. Verbrauchsberechnungen dürfen den Randwert bei „Bis“ zur Interpolation nutzen.

Abfragen laufen direkt gegen `https://api.thingspeak.com/channels/{id}/feeds.json`. CORS wird von ThingSpeak unterstützt. Zeiträume werden in Fenster geteilt und bei Erreichen des API-Limits von 8.000 Einträgen rekursiv verkleinert. Überlappende Antworten werden dedupliziert. Damit die Anwendung bedienbar bleibt, gelten ein Jahr pro Suche, maximal 240 API-Abfragen und ein Timeout pro Anfrage. Abfragen können abgebrochen werden. Bei sehr großen Datenmengen empfiehlt sich ein kleinerer Zeitraum. Nur die Darstellung von Originalzählerständen wird auf etwa 1.500 Punkte ausgedünnt; Messwerte und CSV bleiben vollständig.

Der Cache speichert vollständige UTC-Zeitfenster pro Kanal getrennt (bei kurzen Suchen tageweise), unabhängig von Diagrammtyp, Auflösung und Strompreis. Die Begrenzung beträgt **16 MiB geschätzte Nutzdaten und höchstens 64 Einträge**; tatsächlicher Speicherbedarf inklusive Browser-Verwaltung kann abweichen. Ein einzelnes Fenster über 4 MiB wird nicht gespeichert. Abgelaufene und am längsten nicht verwendete Einträge werden beim Schreiben entfernt. Die Bereinigung liest nur kleine Metadaten, keine vollständige Kopie aller Messwerte. Der Cache hält keine zusätzliche dauerhafte Kopie im JavaScript-Arbeitsspeicher. Im Arbeitsspeicher bleiben der ausgewählte Zeitraum und ein kleiner Randbereich zur Verbrauchsberechnung. Datum-/Zahlformatierer werden wiederverwendet; die Messwertsuche läuft nur in der Messwertansicht. Bei gesperrtem oder vollem Browserspeicher werden Daten weiterhin direkt geladen. Fehlerhafte oder unvollständig abgebrochene Zeitfenster werden nicht gecacht; abgelaufene Daten ersetzen keine fehlgeschlagene Live-Abfrage.

## Bereitstellen

```sh
npm run build
```

Den Inhalt von `dist/` auf einem statischen HTTPS-Host bereitstellen, beispielsweise GitHub Pages, Netlify oder einen eigenen Webserver. Schriften, Icons und Diagrammbibliotheken sind im Build enthalten; es werden keine externen Schriftanbieter benötigt. Die Website hat keine Backend- oder Datenbankabhängigkeit.

### GitHub Pages

Im Repository unter **Settings → Pages → Build and deployment → Source** die Option **GitHub Actions** wählen. Der Workflow **Website veröffentlichen** baut und testet die Website bei Änderungen an `main`. Falls der erste Lauf vor der Pages-Aktivierung fehlgeschlagen ist, unter **Actions → Website veröffentlichen → Run workflow** erneut starten.

Der Workflow berücksichtigt den Unterpfad des Repositorys. Für eine lokale Prüfung desselben Builds:

```sh
VITE_BASE_PATH=/Stromzaehler_O/ npm run build
VITE_BASE_PATH=/Stromzaehler_O/ npm run preview
```

Die Standardadresse nach erfolgreicher Veröffentlichung lautet `https://olepaw.github.io/Stromzaehler_O/`. Diese Adresse funktioniert erst, wenn Pages aktiviert ist und der Workflow erfolgreich abgeschlossen wurde. Bei einem privaten Repository hängt die Verfügbarkeit von GitHub Pages vom GitHub-Tarif ab; eine Änderung der Repository-Sichtbarkeit ist für diese Anleitung nicht erforderlich und wird nicht automatisch vorgenommen.

Cloud-Netzwerkfreigabe für Entwicklung/Live-Tests: `api.thingspeak.com` zusätzlich zu den Paketregistrierungen. Die Website schreibt nicht in ThingSpeak und enthält keinen Read- oder Write-API-Schlüssel. Zugangsdaten gehören nicht ins Repository.
