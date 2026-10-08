# 🎵 Melody

**Deine Musik. Werbefrei. Auf allen Geräten.**

Melody ist eine Musik- und Streaming-App, die auf **iPhone, iPad, Android, Windows, macOS und Linux** läuft – aus einer einzigen Codebasis. Sie lässt sich wie eine native App installieren, funktioniert offline und zeigt niemals Werbung.

## ✨ Was Melody besser macht als Spotify & Apple Music

| | Melody | Spotify Free | Apple Music |
|---|---|---|---|
| Werbung | **Nie** | Ja | – |
| Kosten | **Kostenlos** | Werbung / ab 10,99 €/Monat | ab 10,99 €/Monat |
| Eigene Musikdateien | **Ja, voller Funktionsumfang** | eingeschränkt | eingeschränkt |
| Offline ohne Abo | **Ja** | Nein | Nein |
| 10-Band-Equalizer mit 12 Presets | **Ja, auf jedem Gerät** | nur Mobil | einfache Presets |
| Wiedergabegeschwindigkeit 0,5×–2× für Musik | **Ja** | nur Podcasts | Nein |
| Sleep-Timer mit sanftem Ausblenden | **Ja** | Ja | Nein (nur iOS-Uhr) |
| Live-Radio (30.000+ Sender weltweit) | **Ja** | Nein | wenige Sender |
| Tracking / Datenweitergabe | **Keins** | Ja | Ja |
| Metadaten selbst bearbeiten | **Ja** | Nein | Nur Mac |

### Funktionen
- **Bibliothek**: Dateien oder ganze Ordner importieren (MP3, M4A/AAC, FLAC, OGG/Opus, WAV …), Drag & Drop am Computer. Titel, Künstler, Album, Jahr und **Cover werden automatisch gelesen** (ID3-Tags), sonst aus dem Dateinamen „Künstler - Titel“.
- **Ansichten**: Titel, Alben, Künstler, Lieblingssongs, Suche und Sortierung (A–Z, Künstler, neu, meistgehört, Länge).
- **Smart-Mixe**: Zufallsmix, Lieblingssongs, Deine Top-Hits, Wiederentdecken (30 Tage nicht gehört), Frisch importiert, Schnelle Runde (< 3 Min.).
- **Playlists**: erstellen, umbenennen, löschen, Titel hinzufügen und entfernen.
- **Player**: Zufall, Wiederholen (alle/einer), Warteschlange mit „Als Nächstes abspielen“, Vollbild-Player mit **Live-Visualizer**.
- **Sound**: 10-Band-Equalizer, 12 Presets (Bass-Boost, Gesang, Rock, Nachtmodus …), Geschwindigkeit 0,5×–2×.
- **Sleep-Timer**: 5–90 Minuten oder „Ende des Titels“, mit sanftem Ausblenden.
- **Radio**: Tausende Live-Sender über das freie Verzeichnis radio-browser.info, Genres, Suche und Lieblingssender.
- **Sperrbildschirm & Kopfhörer**: Steuerung über Media Session (Sperrbildschirm, Bluetooth, Smartwatch, Auto).
- **Persönlich**: Dunkel/Hell/System-Design, 10 Akzentfarben, Statistiken.
- **Merkt sich alles**: Warteschlange und Position bleiben nach dem Schließen erhalten.
- **Tastenkürzel**: Leertaste, ←/→ (10 s), Umschalt + ←/→ (Titel), ↑/↓ (Lautstärke), F (Favorit).

## 🚀 Starten

Melody braucht keinen Build-Schritt und keine Abhängigkeiten. Es reicht ein einfacher Webserver:

```bash
# Variante 1 (Node.js)
npx serve .

# Variante 2 (Python)
python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen.

> Hinweis: Installation als App und Offline-Modus brauchen **HTTPS** (auf `localhost` geht es auch ohne).

## 🌍 Online stellen (kostenlos)

**GitHub Pages:** Repository → *Settings* → *Pages* → *Source: Deploy from a branch* → Branch `main`, Ordner `/ (root)` → *Save*. Nach ca. 1 Minute ist Melody unter `https://<dein-name>.github.io/Melody/` erreichbar.

Alternativen: Netlify, Vercel oder Cloudflare Pages (einfach den Ordner hochladen, kostenlos).

## 📱 Auf Geräten installieren

- **iPhone/iPad**: Seite in Safari öffnen → *Teilen* → **„Zum Home-Bildschirm“**
- **Android**: In Chrome öffnen → Menü ⋮ → **„App installieren“**
- **Windows/Mac/Linux**: In Chrome/Edge auf das Installieren-Symbol in der Adressleiste klicken, oder in Melody unter *Einstellungen → Melody installieren*

Für die App Stores (Google Play / Apple App Store) kann die App später mit [Capacitor](https://capacitorjs.com/) verpackt werden – ohne neuen Code.

## 🗂 Aufbau

```
index.html            App-Gerüst
css/style.css         Design (Dunkel/Hell, Handy und Desktop)
js/app.js             Oberfläche, Ansichten, Import, Bedienung
js/player.js          Wiedergabe, Equalizer, Visualizer, Sleep-Timer, Radio, Sperrbildschirm
js/db.js              Lokale Datenbank (IndexedDB)
js/tags.js            Liest Titel/Künstler/Album/Cover aus Musikdateien
js/icons.js           Symbole
sw.js                 Offline-Modus (Service Worker)
manifest.webmanifest  Installierbarkeit als App
```

## ⚖️ Wichtig: Musikrechte

Den Katalog von Spotify oder Apple Music (Universal, Sony, Warner …) kann niemand einfach anbieten. Dafür braucht man Lizenzverträge mit den Labels und Verwertungsgesellschaften (in Deutschland u. a. **GEMA**). Diese kosten Vorauszahlungen in Millionenhöhe plus rund 70 % der Einnahmen. Melody ist deshalb bewusst so aufgebaut, dass es **ohne diese Kosten legal** funktioniert:

1. **Eigene Musik** – Dateien, die du besitzt, bleiben auf deinem Gerät.
2. **Internetradio** – Sender streamen selbst und haben eigene Lizenzen.
3. **Nächster Schritt (Roadmap)** – freie Kataloge mit offenen Lizenzen anbinden: Jamendo (600.000+ Titel, Creative Commons), Audius, Free Music Archive. So entsteht ein echter Streaming-Katalog ohne Labelverträge.

## 🛣 Roadmap

- [ ] Streaming-Katalog: Jamendo / Audius (kostenlose, legale Musik)
- [ ] Liedtexte (.lrc) mit Karaoke-Ansicht
- [ ] Crossfade & lückenlose Wiedergabe
- [ ] Sync zwischen Geräten (eigener Server oder WebDAV/Nextcloud)
- [ ] Chromecast & AirPlay
- [ ] Podcasts (RSS)
- [ ] App-Store-Versionen mit Capacitor
- [ ] Optionales „Melody Plus“ für Cloud-Speicher (z. B. 1,99 €/Monat), immer werbefrei

## 🔒 Datenschutz

Melody hat kein Konto, keine Analyse und keine Werbung. Deine Musik, Playlists und Einstellungen liegen nur in deinem Browser auf deinem Gerät. Nur die Radio-Suche ruft die öffentliche API von radio-browser.info auf.
