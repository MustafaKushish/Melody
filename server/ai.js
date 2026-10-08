import Anthropic from '@anthropic-ai/sdk';
import { db } from './db.js';
import { HttpError } from './auth.js';
import { AI_MODEL, AI_DAILY_LIMIT } from './config.js';

// The SDK resolves credentials from the environment (ANTHROPIC_API_KEY, …).
const enabled = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = enabled ? new Anthropic() : null;

export const MELODY_PRESETS = ['Melody Signature', 'Melody Bass', 'Melody Klar', 'Melody Party', 'Melody Chill', 'Melody Live'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'message', 'trackIndexes', 'preset', 'radioTags', 'discover'],
  properties: {
    title: { type: 'string', description: 'Kurzer, kreativer Name für den Mix (max. 40 Zeichen)' },
    message: { type: 'string', description: 'Ein bis zwei warme Sätze an den Hörer, warum dieser Mix passt' },
    trackIndexes: { type: 'array', items: { type: 'integer' }, description: 'Indizes aus der Bibliothek in sinnvoller Reihenfolge' },
    preset: { type: 'string', enum: MELODY_PRESETS },
    radioTags: { type: 'array', items: { type: 'string' }, description: '1–3 englische Genre-Tags für passende Radiosender' },
    discover: {
      type: 'array',
      description: '3–5 Künstler/Songs, die NICHT in der Bibliothek sind und gut passen',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['artist', 'song', 'why'],
        properties: { artist: { type: 'string' }, song: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
};

const SYSTEM = `Du bist der Musik-Kurator der App „Melody“. Du stellst aus der persönlichen Bibliothek des Hörers einen Mix zusammen, der zu seiner Stimmung oder seinem Wunsch passt.

So arbeitest du:
- Wähle nur Titel aus der mitgelieferten Bibliothek, angegeben über ihren Index „i“. Erfinde keine Indizes.
- Ziel sind 12–30 Titel (oder alle passenden, wenn die Bibliothek klein ist). Ordne sie mit Dramaturgie: sanfter Einstieg, Höhepunkt, passender Ausklang.
- Berücksichtige Genre, Jahr, Lieblingssongs (f=1) und Wiedergaben (p), mische aber auch selten Gehörtes unter, damit der Mix frisch wirkt.
- Wenn der Wunsch zum Mitsingen ist, bevorzuge bekannte, eingängige Titel.
- Wähle das passende Melody-Klangprofil (preset).
- Schlage unter „discover“ Musik vor, die nicht in der Bibliothek ist, damit der Hörer Neues entdeckt.
- Antworte auf Deutsch, freundlich und motivierend, ohne Übertreibung.`;

function checkLimit(userId) {
  const day = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(userId, day);
  if ((row?.count || 0) >= AI_DAILY_LIMIT) {
    throw new HttpError(429, `Du hast heute schon ${AI_DAILY_LIMIT} KI-Mixe erstellt. Morgen geht's weiter!`);
  }
  db.prepare(`INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1)
              ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`).run(userId, day);
}

function cleanLibrary(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 800).map((t, i) => ({
    i,
    t: String(t.t || '').slice(0, 80),
    a: String(t.a || '').slice(0, 60),
    g: String(t.g || '').slice(0, 30),
    y: String(t.y || '').slice(0, 4),
    p: Number(t.p) || 0,
    f: t.f ? 1 : 0,
  }));
}

export async function recommend(user, body) {
  if (!client) throw new HttpError(503, 'KI ist nicht eingerichtet.');
  const library = cleanLibrary(body.library);
  if (!library.length) throw new HttpError(400, 'Deine Bibliothek ist leer.');
  const wish = String(body.prompt || '').trim().slice(0, 300) || 'Überrasch mich mit einem Mix, der zu mir passt.';
  checkLimit(user.id);

  const hour = Number.isInteger(body.hour) ? body.hour : new Date().getHours();
  const recent = (Array.isArray(body.recent) ? body.recent : []).filter(Number.isInteger).slice(0, 30);
  const userText = `Wunsch des Hörers: ${wish}
Uhrzeit beim Hörer: ${hour} Uhr
Zuletzt gehört (Indizes): ${recent.join(', ') || 'keine'}

Bibliothek (JSON, ein Objekt pro Titel – i=Index, t=Titel, a=Künstler, g=Genre, y=Jahr, p=Wiedergaben, f=Favorit):
${JSON.stringify(library)}`;

  let response;
  try {
    response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, 'Die KI ist gerade ausgelastet. Bitte versuche es gleich noch einmal.');
    if (e instanceof Anthropic.APIError) {
      console.error('KI-Fehler', e.status, e.message);
      throw new HttpError(502, 'Die KI ist gerade nicht erreichbar.');
    }
    throw e;
  }

  if (response.stop_reason === 'refusal') throw new HttpError(422, 'Dazu kann die KI keinen Mix erstellen. Formuliere den Wunsch bitte anders.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new HttpError(502, 'Die KI-Antwort war unvollständig. Bitte versuche es erneut.');
  }
  const valid = new Set(library.map((t) => t.i));
  return {
    title: String(out.title || 'Dein KI-Mix').slice(0, 60),
    message: String(out.message || '').slice(0, 400),
    trackIndexes: [...new Set((out.trackIndexes || []).filter((i) => valid.has(i)))],
    preset: MELODY_PRESETS.includes(out.preset) ? out.preset : 'Melody Signature',
    radioTags: (out.radioTags || []).map(String).slice(0, 3),
    discover: (out.discover || []).slice(0, 6).map((d) => ({ artist: String(d.artist), song: String(d.song), why: String(d.why) })),
    source: 'ki',
  };
}

export const aiEnabled = () => enabled;
