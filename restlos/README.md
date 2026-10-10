# 🥕 Restlos – Vorrat ohne Verschwendung

**Frictionless Food- und Haushaltsmanagement.** Etwa ein Drittel aller Lebensmittel landet im Müll, oft weil man vergisst, was im Kühlschrank liegt, oder zu viel einkauft. Vorrats-Apps scheitern meist am Eintippen. Restlos macht das Eintragen so einfach wie möglich:

| Problem | Lösung in Restlos |
|---|---|
| Eintippen nervt | **Kassenbon fotografieren.** Restlos erkennt die Lebensmittel, Mengen und Preise. Pfand, Rabatte und Drogerieartikel sortiert es aus. |
| Niemand tippt Ablaufdaten ein | **Haltbarkeit wird geschätzt** (über 80 Produkte, ab Kaufdatum). „Angebrochen“ und „Einfrieren“ passen sie an. |
| Man vergisst, was da ist | **Ampel-Übersicht** nach Dringlichkeit, Hinweis beim Öffnen, Erinnerungen im Handy-Kalender (.ics) |
| Was koche ich mit den Resten? | **Reste-Rezepte**, die zuerst das Ablaufende verbrauchen. Benannt nach deinen Resten („Frittata mit Zucchini & Paprika“). |
| Zu viel eingekauft | **Einkaufsliste mit Warnung** „Hast du noch: 6× Eier (noch 12 Tage)“. Abgehakte Sachen wandern direkt in den Vorrat. |
| Schaffe ich nicht mehr | **Im Hausflur teilen:** fertiger Text für die Haus-WhatsApp-Gruppe oder nebenan.de, Aushang mit Abreißzetteln zum Drucken |
| Bringt das was? | **Bilanz:** Gerettet-Quote, Euro im Müll, CO₂, „am häufigsten weggeworfen“ mit Tipp |

Weitere Eingabewege: **Sprechen** („2 Liter Milch, sechs Eier und Tomaten“) und **Eintippen** mit Vorschlägen.

## Ausprobieren

- **Online:** nach dem Zusammenführen in `main` unter `https://<name>.github.io/Melody/restlos/`. Auf dem Handy dann „Zum Home-Bildschirm“.
- **Lokal:** `cd restlos && npm start`, dann http://localhost:8080 öffnen. In der App „Beispiel-Vorrat laden“ antippen.
- **Tests:** `cd restlos && npm test` (Bon-Erkennung, Haltbarkeit, Rezepte, Bilanz, Speicher)

## Technik

- Installierbare Web-App (PWA), ohne Build-Schritt, läuft offline. Wie Melody: eine Codebasis für iPhone, Android und Desktop.
- **Datenschutz:** Alles bleibt auf dem Gerät (localStorage). Die Bon-Erkennung (Tesseract.js) läuft im Browser, das Foto wird nicht hochgeladen. Nur beim ersten Scan werden etwa 3 MB Erkennungsdaten aus dem Netz geladen.
- Aufbau:
  - `js/products.js` – Produktwissen: Haltbarkeit, Lagerort, Preis, CO₂, Bon-Schreibweisen
  - `js/receipt.js` – Bon-Text → Artikel (REWE, Edeka, Lidl, Aldi …)
  - `js/pantry.js` – Datum, Status (MHD vs. Verbrauchsdatum), Bilanz, Freitext/Sprache
  - `js/recipes.js` – 36 Rezepte und die Auswahl nach Dringlichkeit
  - `js/share.js` – Teilen-Text, Aushang, Kalender-Erinnerungen
  - `js/store.js` – Speicher mit Rückgängig
  - `js/ocr.js` – Texterkennung, `js/app.js` – Oberfläche

## Fahrplan

1. **Haushalt teilen:** ein gemeinsamer Vorrat für alle im Haushalt. Braucht einen kleinen Server mit Sync; der Melody-Server kann dafür als Vorlage dienen.
2. **Echte Push-Erinnerungen** auch bei geschlossener App (Web Push, auf dem iPhone ab iOS 16.4 für installierte Web-Apps)
3. **KI-Bon-Erkennung** mit Claude Vision als Ergänzung bei schlechten Fotos, dazu **KI-Rezepte** frei aus dem Vorrat (Server mit API-Schlüssel, wie bei Melody „Für dich“)
4. **Barcode scannen** + Open Food Facts für Produkte ohne Bon (z. B. Geschenke, Vorräte)
5. **Hausflur-Börse:** echte Angebote für Nachbarn im selben Haus (Einladungslink oder QR-Code am schwarzen Brett, Chat, „reserviert“)
6. **eBon-Anbindung:** digitale Kassenbons (REWE, Lidl Plus, Payback) automatisch übernehmen, ganz ohne Foto
7. Lernende Haltbarkeit: Wenn jemand das Datum oft ändert, passt Restlos die eigene Schätzung an.

*Haltbarkeiten und CO₂-Werte sind Durchschnittsschätzungen. Mindesthaltbarkeit heißt nicht „schlecht ab“. Bei Fleisch, Geflügel und Fisch (Verbrauchsdatum) warnt die App deutlich und bietet sie nicht zum Verschenken an.*
