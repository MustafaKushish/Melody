# 🎵 Melody

**Musik, die dich mitnimmt. Werbefrei, auf allen Geräten.**

Melody ist eine Musik-App für **iPhone, iPad, Android, Windows, macOS und Linux** aus einer einzigen Codebasis. Sie lässt sich wie eine native App installieren und läuft auch offline.

## ✨ Funktionen

### 🎤 Mitsingen
- **Lyrics laufen synchron mit**, die aktuelle Zeile leuchtet. Ein Tipp auf eine Zeile springt an diese Stelle.
- **Karaoke-Vollbild**: große Zeilen, die sich im Takt füllen, und ein Countdown vor dem Einsatz.
- **Originalstimme ausblenden**: ein Regler entfernt den Gesang aus dem Song, der Beat bleibt.
- **Mikrofon mit Hall**: Du hörst dich selbst, dazu eine **Mitsing-Quote** in Prozent.
- Lyrics kommen automatisch aus der freien Datenbank LRCLIB. Alternativ legst du `.lrc`-Dateien neben die Musik oder fügst den Text selbst ein.

### ✨ KI „Für dich“
- Du sagst, wonach dir ist („Etwas für einen sonnigen Sonntagmorgen“) oder tippst eine Stimmung an (Gute Laune, Workout, Fokus, Party, Mitsingen …).
- Die KI (Claude) stellt aus **deiner** Bibliothek einen Mix mit Spannungsbogen zusammen und **empfiehlt neue Künstler**, passende Radiosender und das passende Klangprofil.
- Ohne Internet oder API-Schlüssel springt automatisch die eingebaute Melody-Engine ein.

### 🎛 Sound-Studio – wie ein DJ
- **Melody-Sound (empfohlen)**: 6 von uns abgestimmte Klangprofile. *Melody Signature* ist der Standard für alle neuen Hörer.
- **„Beliebt bei Melody-Hörern“**: echtes, anonymes Ranking der Klangprofile. Unsere Profile sind voreingestellt und mit einem Klick wiederhergestellt („Zurück zum Melody-Sound“).
- **DJ-Pult**: Filter (Tief-/Hochpass), Echo, Hall, Stereo-Breite, Tempo mit oder ohne Tonhöhe, **Übergänge zwischen Songs (Crossfade über zwei Decks)**.
- **Effekt-Pads**: Echo-Out, Filter-Sweep, Bass-Kill, Vinyl-Stopp.
- Equalizer mit 10 Bändern und 12 weiteren Presets.

### 🚗 Fahrermodus – sicher unterwegs
- **Karte mit Navigation** (OpenStreetMap): Ziel suchen, Route, Abbiege-Hinweise mit Entfernung, Ankunftszeit, automatische Neuberechnung beim Verfahren.
- **Sprachansagen** („In 350 Metern links abbiegen auf Hauptstraße“). Die Musik wird dabei automatisch leiser.
- **Sprachsteuerung**: „Nächster Song“, „Leiser“, „Spiel Sommerwind“, „Spiel Gute Laune“, „Navigiere nach Zeil 10“, „Wann kommen wir an?“, „Gefällt mir“.
- **Sicherheit zuerst**: riesige Knöpfe, immer dunkel, Bildschirm bleibt an. **Ab 10 km/h sind Tippen und Suchen gesperrt.** Bedienen geht dann per Sprache, oder der **Beifahrer** schaltet die Sperre für 15 Minuten frei.
- Hoch- und Querformat, damit es auch in einer Handyhalterung oder auf einem Tablet am Armaturenbrett passt.
- Mit „Beenden“ geht es zurück; die Musik läuft weiter, auch im Hintergrund.

### 🏋️ Fitness-Modus
- **6 Trainingsarten**: Krafttraining, HIIT, Tabata, Laufen, Cardio & Spinning, Yoga & Dehnen.
- **Musik im richtigen Tempo**: Melody misst das Tempo (BPM) jedes Songs automatisch und wählt passende Titel, vom Aufwärmen bis zum Höhepunkt. Ein 82-BPM-Song zählt beim Laufen auch als 164 BPM.
- **Intervall-Timer** (HIIT 30/30, Tabata 20/10) mit großem Ring, Farben (grün = los, blau = Pause), Countdown-Pieptönen und **Sprach-Coach** („Runde 3. Los!“, „Letzte Runde! Gib alles!“). In Pausen wird die Musik leiser.
- **Krafttraining**: „Satz fertig“ antippen, und der Satzpausen-Timer läuft (60, 90, 120 oder 180 s). Sätze werden mitgezählt.
- **Laufen**: Das Handy misst das Schritt-Tempo über den Bewegungssensor. Die Musik passt sich an (±8 %, Tonhöhe bleibt).
- **Power-Knopf** ⚡: sofort der schnellste passende Song.
- **Großbildschirm**: Vollbild für Trainer, z. B. auf dem Fernseher im Kursraum.
- Trainingsverlauf mit Wochenübersicht. Klang und Tempo werden nach dem Training wiederhergestellt.

### 🎵 Song erkennen (wie Shazam)
- Ein **schwebender Erkennen-Knopf auf jeder Seite**, dazu Taste **S** am Computer, Sprachbefehl im Auto („Welcher Song ist das?“) und ein **Schnellzugriff auf dem Startbildschirm** (lange auf das Melody-Symbol drücken → „Song erkennen“).
- **Eigene Erkennung für den Melody-Katalog**, auch **offline**. Sie arbeitet mit Audio-Fingerabdrücken und wurde mit verrauschten „Handy-Aufnahmen“ getestet (Lautsprecher-Klang, Hall, starke Komprimierung). Sie erkennt sogar die Stelle im Song: **„Hier weiterhören“** spielt nahtlos dort weiter, wo die Musik gerade ist, und **„Herunterladen“** speichert den Song sofort offline.
- **Weltweite Erkennung** aller anderen Songs über den Dienst AudD (`AUDD_API_TOKEN`, ca. 2 $ pro 1.000 Erkennungen). Treffer zeigen Links zu Apple Music, Spotify und Deezer und landen auf der **Wunschliste**. Was oft gewünscht wird, nimmt Melody als Nächstes in den Katalog auf (`GET /api/admin/wishes`).
- Alternativ lässt sich eine Aufnahme-Datei auswählen. Die Aufnahmen werden nicht gespeichert.
- Neue Katalog-Songs brauchen einen Fingerabdruck: `node tools/build-fingerprints.mjs`.

### 🎉 Party & 🌙 Entspannen
- **Party-Modus**: Vollbild-Lichtshow im Takt der Musik, Übergänge von 6 s zwischen den Songs, Klang „Melody Party“, DJ-Pads. Beim Beenden kommt der eigene Sound zurück. Die Lichtshow pulsiert sanft, ohne Stroboskop, und bleibt bei „Bewegung reduzieren“ ruhig.
- **Entspannen**: weicher Klang, ruhiger Mix, die Musik endet nach 30 Minuten.

### ⬇️ Herunterladen & offline hören
- **Entdecken**: Songs aus dem Melody-Katalog streamen (mit Spulen) oder **herunterladen**, einzeln, als ganze Playlist oder alles auf einmal.
- Heruntergeladene Songs laufen **ohne Internet**. Der Tab „Offline“ in der Bibliothek zeigt alles, was offline verfügbar ist, samt Speicherbedarf.
- Ohne Verbindung werden nicht geladene Songs ausgegraut und übersprungen.
- Der Demo-Katalog (`catalog/`) enthält 6 eigens komponierte Songs mit Lyrics. Für einen echten Katalog lizenzfreie Quellen wie Jamendo/Audius anbinden oder eigene Künstler unter Vertrag nehmen.

### 🔗 Playlists teilen
- Ein Link enthält die ganze Playlist, ohne Server. Teilen per WhatsApp, Telegram, E-Mail, Kopieren oder über den Teilen-Dialog des Handys.
- Der Empfänger sieht „Geteilte Playlist von …“, kann sie abspielen und in seine Playlists übernehmen. Katalog-Songs laufen sofort, eigene Dateien werden in seiner Bibliothek gesucht.

### 💳 Konto, Abo & Gutscheine
- Konto mit 7 Tagen kostenloser Testphase, ohne Zahlungsdaten.
- **Monatsabo 4,99 €** oder **Jahresabo 49,99 €** (entspricht 4,17 €/Monat, 2 Monate geschenkt).
- **Gutscheine** über 1, 3, 6 oder 12 Monate: kaufen, verschenken (Teilen-Button) und einlösen.
- Abo verwalten und kündigen, Rechnungen herunterladen und Zahlungsmethode ändern über das Stripe-Kundenportal. Das erfüllt auch den gesetzlich verlangten Kündigungsbutton.
- Konto löschen in der App (DSGVO).

### Und außerdem
Bibliothek mit Covern, Alben und Künstlern · Playlists · Smart-Mixe · 30.000+ Radiosender · Sleep-Timer · Steuerung über Sperrbildschirm, Kopfhörer und Auto · Dunkel/Hell · offline nutzbar · **niemals Werbung**.

## 💶 Preiskalkulation

Alle Preise stehen an **einer Stelle**: `server/config.js`.

| | Monatlich | Jährlich |
|---|---|---|
| Kundenpreis (inkl. 19 % MwSt.) | **4,99 €** | **49,99 €** |
| netto | 4,19 € | 42,01 € |
| Zahlungsgebühr Stripe (ca. 1,5 % + 0,25 €, EU-Karten) | − 0,32 € | − 1,00 € |
| **Einnahme pro Kunde** | **3,87 € / Monat** | **41,01 € / Jahr (3,42 € / Monat)** |
| Laufende Kosten pro Kunde & Monat (Server, Speicher, KI bei Ø 10 Mixen, Support) | ca. 0,40 – 0,90 € | ca. 0,40 – 0,90 € |
| **Marge** | **≈ 3,00 – 3,50 €** | **≈ 2,50 – 3,00 €** |

**Schüler, Azubis & Studierende: halber Preis** 🎓

| | Preis | pro Monat | Einnahme nach MwSt. & Gebühren |
|---|---|---|---|
| Schüler monatlich | **2,49 €** | 2,49 € | ≈ 1,80 € |
| Schüler jährlich | **24,99 €** | 2,08 € | ≈ 1,82 € / Monat |

Bestätigung im Konto: Schule/Ausbildung/Studium, Name der Einrichtung, voraussichtliches Ende. Die Bestätigung gilt höchstens 12 Monate und wird dann neu abgefragt. Zusätzlich bestätigt man: mindestens 16 Jahre oder Einverständnis der Eltern. Standard ist die Selbstauskunft mit sofortiger Freischaltung. Mit `MELODY_STUDENT_AUTO_APPROVE=0` prüft ein Admin jede Anfrage (`GET /api/admin/students`, `POST /api/admin/students/decide` mit `Authorization: Bearer $MELODY_ADMIN_TOKEN`). Für größere Mengen lohnt ein Prüfdienst wie UNiDAYS oder SheerID.

| Gutschein | Preis | pro Monat |
|---|---|---|
| 1 Monat | 4,99 € | 4,99 € |
| 3 Monate | 14,49 € | 4,83 € |
| 6 Monate | 27,99 € | 4,67 € |
| 12 Monate | 49,99 € | 4,17 € |

**Warum so?** Melody kostet weniger als die Hälfte der großen Anbieter, ist aber kein Billig-Angebot. Der Jahrespreis belohnt Treue, Gutscheine kosten etwas mehr pro Monat als das Jahresabo, damit sich das Abo weiterhin lohnt.

**KI-Kosten im Blick:** Ein KI-Mix mit dem Standardmodell (Claude Opus 5.5) kostet bei ca. 300 Titeln etwa 5 Cent. Das Tageslimit steht deshalb auf **5 KI-Mixe pro Kunde** (`MELODY_AI_DAILY_LIMIT`). Mit `MELODY_AI_MODEL=claude-haiku-5-5` sinken die Kosten auf rund 0,1 Cent pro Mix. Die Empfehlungen fallen damit etwas einfacher aus.

**Hinweis:** Über Apple App Store oder Google Play gehen bei In-App-Käufen zusätzlich 15–30 % ab. Als Web-App (PWA) mit Stripe entfällt das.

## 🚀 Starten

Voraussetzung: **Node.js 22.5 oder neuer**.

```bash
cd server
npm install
npm start
```

Danach `http://localhost:8080` öffnen.

Ohne Stripe-Schlüssel läuft ein **Testmodus**: Abos und Gutscheine lassen sich ausprobieren, es wird nichts abgebucht. Ohne Anthropic-Schlüssel nutzt „Für dich“ die eingebaute Empfehlungs-Engine.

Tests: `npm test` (27 Tests für Konten, Abos, Gutscheine, Stripe-Webhooks, KI-Anfrage, Sicherheit, Song-Erkennung und Tempo-Messung).

### Demo ohne Server
`tools/build-demo.sh` baut eine Version, bei der Konten und Zahlungen im Browser simuliert werden. Sie eignet sich zum Vorführen und lässt sich auf jedem statischen Hosting (z. B. GitHub Pages) betreiben.

## 🌍 Online stellen

Melody braucht jetzt einen kleinen Node-Server, weil Konten und Zahlungen dort verwaltet werden. GitHub Pages reicht deshalb nicht mehr. Passende Anbieter sind zum Beispiel:

- **Render**, **Railway** oder **Fly.io** (einfach, ab ca. 5 €/Monat)
- ein eigener **Hetzner**-Server (ab ca. 4 €/Monat) mit nginx davor

Wichtig für den Betrieb:
1. Umgebungsvariablen aus `server/.env.example` setzen (`PUBLIC_URL`, `NODE_ENV=production`, `STRIPE_*`, `ANTHROPIC_API_KEY`).
2. Hinter einem Proxy (nginx, Render, Fly …) `TRUST_PROXY=1` setzen.
3. Die Datenbank `server/data/melody.db` (bzw. `MELODY_DB`) auf einem dauerhaften Laufwerk ablegen und **täglich sichern**.
4. Immer **HTTPS** verwenden.

### Stripe einrichten
1. Konto auf [stripe.com](https://stripe.com) anlegen und den geheimen Schlüssel als `STRIPE_SECRET_KEY` hinterlegen.
2. Webhook anlegen: `https://deine-domain/api/stripe/webhook` mit den Events `checkout.session.completed`, `invoice.paid`, `customer.subscription.created`, `customer.subscription.updated` und `customer.subscription.deleted`. Das Signing Secret wird zu `STRIPE_WEBHOOK_SECRET`.
3. Im Stripe-Dashboard das **Kundenportal** aktivieren (Kündigen, Planwechsel, Rechnungen).
4. Zahlungsarten aktivieren: Karte, PayPal, SEPA, Apple Pay und Google Pay.
5. Unter Checkout die Zustimmung zu AGB und Widerrufsverzicht als Pflicht-Checkbox einschalten.

Produkte musst du in Stripe nicht anlegen, die Preise kommen direkt aus `server/config.js`.

### KI einrichten
Einen API-Schlüssel unter [console.anthropic.com](https://console.anthropic.com) erstellen und als `ANTHROPIC_API_KEY` setzen.

## 🚘 Melody im Auto: was heute geht und was als Nächstes kommt

| | Heute (Web-App) | Mit nativer App (Capacitor) |
|---|---|---|
| Musik über Bluetooth/AUX/USB im Auto | ✅ | ✅ |
| Titel, Cover und Lenkradtasten im Autodisplay | ✅ (Media Session) | ✅ |
| Fahrermodus mit Karte, Navigation und Sprachsteuerung auf dem Handy | ✅ | ✅ |
| Melody **direkt auf dem Bildschirm des Autos** (Apple CarPlay / Android Auto) | ❌ technisch nicht möglich | ✅ mit Audio-App-Freigabe von Apple bzw. Android-Auto-Media-Vorlage |
| Song-Erkennung über **Shazams eigene Datenbank** (ShazamKit), Erkennen-Knopf im Kontrollzentrum / als Widget | ❌ | ✅ ShazamKit ist für iOS und Android verfügbar (Apple-Entwicklerkonto) |
| Navigation auf dem Autobildschirm | ❌ | nur mit Navigations-Freigabe (strenge Auflagen) |
| Autos mit eingebautem Android (Android Automotive: Volvo, Polestar, Renault …) | ❌ | ✅ als Media-App über Google Play |

Für Karten-Kacheln, Ortssuche und Routen nutzt Melody die freien OpenStreetMap-Dienste. Diese sind für Tests gedacht. Bei vielen Nutzern braucht es einen Anbieter (z. B. MapTiler, Stadia Maps, eigener OSRM-Server). Die Adressen lassen sich in `js/drive.js` (`DEFAULT_GEO`) austauschen.

## 🏢 Idee: Melody für Fitnessstudios
Studios brauchen für Musik über Lautsprecher eine **GEMA-Lizenz für öffentliche Wiedergabe**, und die kostet oft mehrere hundert Euro im Jahr. Ein **GEMA-freier Melody-Katalog** (eigene Künstler, Musik ohne Verwertungsgesellschaft) wäre ein starkes Geschäftsmodell:
- „Melody Studio“, z. B. 29 €/Monat pro Studio: Großbildschirm-Kurstimer, Musik im Kurstempo, mehrere Räume.
- Mitglieder hören mit ihrem eigenen Melody-Abo dieselben Kurs-Playlists zu Hause weiter.

## ⚖️ Vor dem Start mit echten Zahlungen

- [ ] **Impressum, AGB, Datenschutz und Widerrufsbelehrung** in `legal/` durch geprüfte Texte ersetzen (Anwalt oder Rechtstexte-Dienst). Die Dateien sind derzeit nur Vorlagen.
- [ ] Gewerbe anmelden und Umsatzsteuer klären.
- [ ] **Minderjährige**: Verträge mit Minderjährigen brauchen in der Regel die Zustimmung der Eltern. Abo-Bedingungen und Einwilligung anwaltlich prüfen lassen.
- [ ] **Schüler-Abo**: Verlängert sich ein Schüler-Abo nach Ablauf des Nachweises, muss es auf den normalen Preis umgestellt oder eine neue Bestätigung angefragt werden. Das ist noch nicht automatisiert.
- [ ] **Navigation**: Hinweis in den AGB, dass die Navigation nur unterstützt und die Verkehrsregeln Vorrang haben.
- [ ] **Lyrics**: LRCLIB ist eine freie Community-Datenbank. Für einen großen kommerziellen Betrieb Lizenzen über einen Lyrics-Anbieter (z. B. LyricFind, Musixmatch) prüfen.
- [ ] **Musik-Katalog**: Melody spielt die eigene Musik der Kunden und Internetradio. Ein Katalog der großen Labels wie bei Spotify erfordert Lizenzverträge (Labels, GEMA) mit Millionen-Vorauszahlungen. Legal und günstig erweitern lässt sich Melody mit freien Katalogen wie Jamendo oder Audius.

## 🗂 Aufbau

```
index.html, css/, icons/   App-Oberfläche (PWA, offline-fähig)
js/app.js                  Ansichten: Start, Bibliothek, Playlists, Radio, Einstellungen
js/account.js              Anmeldung, Abo-Auswahl, Gutscheine, Konto
js/lyrics.js               Lyrics, Karaoke-Modus, Mikrofon, Mitsing-Quote
js/foryou.js               KI-Empfehlungen + eingebaute Empfehlungs-Engine
js/studio.js               Sound-Studio: Melody-Sound, Ranking, DJ-Pult, Equalizer
js/player.js               Audio-Engine: 2 Decks, Crossfade, Effekte, Stimmentfernung
js/db.js, js/tags.js       Lokale Musikbibliothek, ID3-Tags & Cover
legal/                     Impressum, AGB, Datenschutz, Widerruf (Vorlagen)
server/config.js           ★ Preise, Testphase, KI-Limit
server/index.js            HTTP-Server & API
server/auth.js             Konten & Sitzungen (scrypt-Passwörter, HttpOnly-Cookies)
server/billing.js          Stripe-Abos, Gutscheine, Webhooks, Testmodus
server/ai.js               KI-Mix über die Claude API (strukturierte Antwort)
server/lyrics.js           Lyrics-Suche mit Cache
server/test/               Automatische Tests
```

## 🔒 Datenschutz & Sicherheit

- Musikdateien bleiben **nur auf dem Gerät** und werden nie hochgeladen.
- Passwörter werden mit scrypt gehasht. Sitzungen laufen über HttpOnly-Cookies mit SameSite=Lax, und die API nimmt nur JSON an (Schutz vor CSRF).
- Begrenzung von Anmelde-, Registrierungs- und Gutschein-Versuchen.
- Kartendaten erreichen den Server nie, die Zahlung läuft über Stripe. Webhooks werden per Signatur geprüft.
- Keine Werbung, keine Tracker. Das Ranking der Klangprofile zählt nur anonym.
