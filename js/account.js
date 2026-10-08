// Account, subscription and voucher screens.
import { api, euro } from './api.js';
import { icon, hydrateIcons } from './icons.js';
import { $, esc, fmtDate, toast, state, go, openSheet, closeSheet, hooks } from './core.js';

const CACHE_KEY = 'melody.account';
const DAY = 86400000;

function cacheAccount(account) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ account, checkedAt: Date.now() })); } catch { /* ignore */ }
}

// Offline use is allowed for 14 days after the last successful check, while access is paid up.
function offlineAccount() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!c || c.checkedAt < Date.now() - 14 * DAY) return null;
    const a = c.account;
    const t = Date.now();
    const ok = a.premiumUntil > t || a.trialEnds > t || ['active', 'trialing'].includes(a.subscription?.status);
    return ok ? { ...a, access: true, offline: true } : null;
  } catch {
    return null;
  }
}

function setAccount(account) {
  state.account = account;
  if (account) cacheAccount(account);
  else localStorage.removeItem(CACHE_KEY);
  renderAccountChip();
}

export async function loadAccount() {
  try {
    const { account } = await api('/me');
    setAccount(account);
    return account;
  } catch (e) {
    if (e.status === 401) {
      setAccount(null);
      return null;
    }
    const cached = offlineAccount();
    if (cached) {
      state.account = cached;
      renderAccountChip();
      return cached;
    }
    throw e;
  }
}

export async function loadPricing() {
  if (state.pricing) return state.pricing;
  try {
    state.pricing = await api('/pricing');
  } catch {
    state.pricing = null;
  }
  return state.pricing;
}

const daysLeft = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / DAY));

export function renderAccountChip() {
  const el = $('#account-chip');
  if (!el) return;
  const a = state.account;
  if (!a) { el.innerHTML = ''; return; }
  const label = a.status === 'premium' ? 'Premium' : a.status === 'trial' ? `Test · noch ${daysLeft(a.trialEnds)} Tage` : 'Abgelaufen';
  el.innerHTML = `<button class="account-chip" data-action="nav" data-view="account">
    <span class="avatar">${esc(a.name.slice(0, 1).toUpperCase())}</span>
    <span class="meta"><b>${esc(a.name)}</b><small class="${a.status}">${label}</small></span></button>`;
}

// ---------- Gate (login / paywall before the app opens) ----------
let gateResolve = null;
let authTab = 'register';

export function requireAccess(kind) {
  showGate(kind);
  return new Promise((res) => { gateResolve = res; });
}

function showGate(kind) {
  const gate = $('#gate');
  gate.hidden = false;
  gate.dataset.kind = kind;
  gate.innerHTML = kind === 'auth' ? authHTML() : kind === 'offline' ? offlineHTML() : paywallHTML();
  hydrateIcons(gate);
}

function openApp() {
  $('#gate').hidden = true;
  $('#gate').innerHTML = '';
  if (gateResolve) {
    const r = gateResolve;
    gateResolve = null;
    r();
  } else {
    hooks.render();
  }
}

function afterAccountChange(account) {
  if (account?.access) {
    if (!$('#gate').hidden) openApp();
    else hooks.render();
  } else if (account) {
    showGate('paywall');
  } else {
    showGate('auth');
  }
}

const BRAND = '<div class="brand big"><img src="icons/icon.svg" alt=""><span>Melody</span></div>';

function authHTML() {
  const p = state.pricing;
  const trial = p?.trialDays ? `${p.trialDays} Tage kostenlos testen` : 'Jetzt starten';
  const from = p ? euro(Math.min(...p.plans.filter((x) => !x.student).map((x) => x.priceCents / x.months))) : '';
  return `<div class="gate-card">${BRAND}
    <h1>Musik, die dich mitnimmt.</h1>
    <p class="sub">Werbefrei · Mitsingen mit Lyrics · KI-Empfehlungen · Sound-Studio wie ein DJ</p>
    <div class="tabs">
      <button class="chip${authTab === 'register' ? ' on' : ''}" data-action="auth-tab" data-tab="register">Konto erstellen</button>
      <button class="chip${authTab === 'login' ? ' on' : ''}" data-action="auth-tab" data-tab="login">Anmelden</button>
    </div>
    ${authTab === 'login' ? `
    <form class="stack" data-form="login">
      <label>E-Mail<input class="input" name="email" type="email" autocomplete="email" required></label>
      <label>Passwort<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary block">Anmelden</button>
    </form>` : `
    <form class="stack" data-form="register">
      <label>Name<input class="input" name="name" autocomplete="name" maxlength="60" required></label>
      <label>E-Mail<input class="input" name="email" type="email" autocomplete="email" required></label>
      <label>Passwort (mind. 8 Zeichen)<input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <label class="check"><input type="checkbox" name="acceptTerms" required>
        <span>Ich akzeptiere die <a href="legal/agb.html" target="_blank">AGB</a> und habe die <a href="legal/datenschutz.html" target="_blank">Datenschutzerklärung</a> gelesen.</span></label>
      <button class="btn btn-primary block">${trial}</button>
    </form>`}
    ${from ? `<p class="muted center">${p.trialDays ? `${p.trialDays} Tage gratis, danach ` : ''}ab ${from} pro Monat · jederzeit kündbar${p.plans.some((x) => x.student) ? '<br>Schüler, Azubis & Studierende: halber Preis 🎓' : ''}</p>` : ''}
    <p class="muted center small"><a href="legal/impressum.html" target="_blank">Impressum</a> · <a href="legal/datenschutz.html" target="_blank">Datenschutz</a> · <a href="legal/agb.html" target="_blank">AGB</a></p>
  </div>`;
}

function offlineHTML() {
  return `<div class="gate-card">${BRAND}
    <h1>Keine Verbindung</h1>
    <p class="sub">Melody braucht einmalig Internet, um dein Konto zu prüfen. Danach funktioniert die App auch offline.</p>
    <button class="btn btn-primary block" data-action="gate-retry">Erneut versuchen</button></div>`;
}

function paywallHTML() {
  const a = state.account;
  return `<div class="gate-card wide">${BRAND}
    <h1>${a?.trialEnds && a.trialEnds < Date.now() ? 'Deine Testphase ist vorbei' : 'Wähle dein Melody'}</h1>
    <p class="sub">Hallo ${esc(a?.name || '')}! Schalte Melody frei – für weniger als die Hälfte der großen Anbieter.</p>
    ${plansHTML()}
    ${redeemHTML()}
    <p class="center"><button class="btn" data-action="logout">Abmelden</button></p>
  </div>`;
}

// ---------- Shared fragments ----------
const FEATURES = [
  ['heartOutline', 'Keine Werbung. Niemals.'],
  ['mic', 'Mitsingen mit Lyrics & Karaoke-Modus'],
  ['sparkle', 'KI-Empfehlungen, die dich kennen'],
  ['eq', 'Sound-Studio mit DJ-Effekten'],
  ['radio', '30.000+ Radiosender weltweit'],
  ['download', 'Offline hören, auf allen Geräten'],
];

function plansHTML() {
  const p = state.pricing;
  if (!p) return '<p class="muted">Preise konnten nicht geladen werden.</p>';
  const cur = state.account?.plan?.id;
  const renewing = state.account?.subscription && !state.account.subscription.cancelAtPeriodEnd &&
    ['active', 'trialing', 'past_due'].includes(state.account.subscription.status);
  return `${p.demo ? '<div class="demo-note">Testmodus: Zahlungen werden nur simuliert, es wird nichts abgebucht.</div>' : ''}
  <div class="plans">${p.plans.filter((pl) => !pl.student).map((pl) => {
    const perMonth = pl.priceCents / pl.months;
    const active = renewing && cur === pl.id;
    return `<div class="plan${pl.badge ? ' featured' : ''}">
      ${pl.badge ? `<span class="badge">${esc(pl.badge)}</span>` : ''}
      <div class="plan-name">${pl.interval === 'year' ? 'Jährlich' : 'Monatlich'}</div>
      <div class="price">${euro(pl.priceCents)}<span>/${pl.interval === 'year' ? 'Jahr' : 'Monat'}</span></div>
      <div class="plan-note">${pl.months > 1 ? `entspricht ${euro(perMonth)} pro Monat · ` : ''}${esc(pl.note)}</div>
      <button class="btn ${pl.badge ? 'btn-primary' : ''} block" data-action="buy" data-kind="plan" data-id="${pl.id}" ${active || !p.payments ? 'disabled' : ''}>
        ${active ? 'Dein aktuelles Abo' : pl.interval === 'year' ? 'Jährlich wählen' : 'Monatlich wählen'}</button>
    </div>`;
  }).join('')}</div>
  ${studentHTML()}
  <ul class="features-list">${FEATURES.map(([i, t]) => `<li>${icon(i)}${t}</li>`).join('')}</ul>
  <p class="muted small center">Preise inkl. 19 % MwSt. Abos verlängern sich automatisch und sind jederzeit zum Ende der Laufzeit kündbar.</p>`;
}

function studentHTML() {
  const p = state.pricing;
  const plans = p?.plans.filter((pl) => pl.student) || [];
  if (!plans.length) return '';
  const st = state.account?.student || { status: 'none' };
  const verified = st.status === 'approved' && st.validUntil > Date.now();
  const cur = state.account?.plan?.id;
  const head = `<div class="student-head">${icon('school')}<div><h3>Schüler, Azubis & Studierende: halber Preis</h3>
    <p>Ab <b>${euro(plans[0].priceCents)}</b> im Monat – weil Musik keine Frage des Taschengelds sein sollte.</p></div></div>`;
  if (verified) {
    return `<div class="panel student">${head}
      <p class="ok small">${icon('check')} Bestätigt: ${esc(st.school || '')} · gültig bis ${fmtDate(st.validUntil)}</p>
      <div class="plans compact">${plans.map((pl) => `<div class="plan">
        <div class="plan-name">${pl.interval === 'year' ? 'Jährlich' : 'Monatlich'}</div>
        <div class="price">${euro(pl.priceCents)}<span>/${pl.interval === 'year' ? 'Jahr' : 'Monat'}</span></div>
        <div class="plan-note">${pl.months > 1 ? `entspricht ${euro(pl.priceCents / pl.months)} pro Monat · ` : ''}${esc(pl.note)}</div>
        <button class="btn btn-primary block" data-action="buy" data-kind="plan" data-id="${pl.id}" ${cur === pl.id ? 'disabled' : ''}>${cur === pl.id ? 'Dein aktuelles Abo' : 'Schüler-Abo wählen'}</button></div>`).join('')}</div></div>`;
  }
  if (st.status === 'pending') {
    return `<div class="panel student">${head}<p>${icon('timer')} Deine Anfrage wird geprüft. Du bekommst Bescheid, sobald sie bestätigt ist.</p></div>`;
  }
  const y = new Date().getFullYear();
  return `<div class="panel student">${head}
    ${st.status === 'expired' ? '<p class="small">Dein Nachweis ist abgelaufen – bitte kurz neu bestätigen.</p>' : ''}
    ${st.status === 'rejected' ? '<p class="small">Deine letzte Anfrage wurde nicht bestätigt. Bitte prüfe deine Angaben.</p>' : ''}
    <form class="stack" data-form="student">
      <div class="seg">${[['schule', 'Schule'], ['ausbildung', 'Ausbildung'], ['studium', 'Studium']].map(([v, l], i) =>
        `<label><input type="radio" name="type" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <label>Name der Schule, Uni oder des Betriebs<input class="input plain" name="school" maxlength="120" required placeholder="z. B. Goethe-Gymnasium Frankfurt"></label>
      <label>Voraussichtlich bis (Monat/Jahr)<input class="input plain" name="validUntil" type="month" min="${y}-01" value="${y + 1}-07"></label>
      <label class="check"><input type="checkbox" name="confirm" required><span>Ich bin zurzeit Schüler/in, Azubi oder Student/in. Melody darf einen Nachweis (z. B. Schülerausweis) stichprobenartig anfragen.</span></label>
      <label class="check"><input type="checkbox" name="guardian" required><span>Ich bin mindestens 16 Jahre alt – oder meine Eltern sind mit dem Abo einverstanden.</span></label>
      <button class="btn btn-primary">Status bestätigen</button>
    </form></div>`;
}

function redeemHTML() {
  return `<div class="panel"><h3>Gutschein einlösen</h3>
    <form class="row nowrap" data-form="redeem">
      <input class="input plain" name="code" placeholder="MELO-XXXX-XXXX" autocomplete="off" required style="text-transform:uppercase">
      <button class="btn btn-primary">Einlösen</button>
    </form></div>`;
}

function vouchersShopHTML() {
  const p = state.pricing;
  if (!p) return '';
  return `<div class="panel"><h3>${icon('gift')} Gutscheine kaufen & verschenken</h3>
    <p>Einmalig bezahlen, kein Abo. Du bekommst sofort einen Code, den du verschenken oder selbst einlösen kannst.</p>
    <div class="voucher-grid">${p.vouchers.map((v) => `
      <button class="voucher" data-action="buy" data-kind="voucher" data-id="${v.id}" ${p.payments ? '' : 'disabled'}>
        <b>${v.months} ${v.months === 1 ? 'Monat' : 'Monate'}</b>
        <span class="price-sm">${euro(v.priceCents)}</span>
        <small>${euro(v.priceCents / v.months)} / Monat</small>
      </button>`).join('')}</div></div>`;
}

// ---------- Views ----------
export function viewPremium() {
  return `<h1>Melody Premium</h1><p class="sub">Alles drin. Keine Werbung. Kein Kleingedrucktes.</p>
    ${plansHTML()}${redeemHTML()}${vouchersShopHTML()}`;
}

export function viewAccount() {
  const a = state.account;
  if (!a) return '<div class="empty">Nicht angemeldet.</div>';
  let status;
  if (a.status === 'premium') {
    const sub = a.subscription;
    const until = a.premiumUntil ? fmtDate(a.premiumUntil) : '';
    status = sub && ['active', 'trialing', 'past_due'].includes(sub.status)
      ? (sub.cancelAtPeriodEnd ? `Gekündigt · läuft bis ${until}` : `Verlängert sich am ${until}`)
      : `Freigeschaltet bis ${until}`;
    if (sub?.status === 'past_due') status = 'Zahlung fehlgeschlagen – bitte Zahlungsmethode aktualisieren';
  } else if (a.status === 'trial') {
    status = `Testphase · noch ${daysLeft(a.trialEnds)} Tage (bis ${fmtDate(a.trialEnds)})`;
  } else {
    status = 'Kein aktives Abo';
  }
  const demo = state.pricing?.demo;
  return `<h1>Konto & Abo</h1>
    <div class="panel account-card">
      <div class="row"><span class="avatar lg">${esc(a.name.slice(0, 1).toUpperCase())}</span>
        <div><h3>${esc(a.name)}</h3><div class="muted">${esc(a.email)}</div></div></div>
      <div class="status-box ${a.status}">
        <b>${a.status === 'premium' ? (a.plan ? esc(a.plan.name) : 'Melody Premium') : a.status === 'trial' ? 'Kostenlose Testphase' : 'Abgelaufen'}</b>
        <span>${status}</span>${a.offline ? '<span class="muted">(offline – zuletzt geprüft)</span>' : ''}
      </div>
      <div class="row">
        ${a.subscription && !demo ? `<button class="btn" data-action="portal">${icon('settings')}Abo verwalten / kündigen</button>` : ''}
        ${demo && a.plan ? `<button class="btn" data-action="cancel-demo">Abo beenden (Test)</button>` : ''}
        ${a.status !== 'premium' || !a.subscription ? `<button class="btn btn-primary" data-action="nav" data-view="premium">${icon('sparkle')}Abo wählen</button>` : ''}
        <button class="btn" data-action="logout">Abmelden</button>
      </div>
    </div>
    ${redeemHTML()}
    ${vouchersShopHTML()}
    <div class="panel"><h3>Meine gekauften Gutscheine</h3><div id="my-vouchers" class="muted">Wird geladen …</div></div>
    <div class="panel"><h3>Konto löschen</h3><p>Löscht dein Konto und alle Daten auf dem Server. Deine Musik auf diesem Gerät bleibt erhalten.</p>
      <button class="btn btn-danger" data-action="delete-account">${icon('delete')}Konto löschen</button></div>
    <p class="muted small"><a href="legal/impressum.html" target="_blank">Impressum</a> · <a href="legal/datenschutz.html" target="_blank">Datenschutz</a> · <a href="legal/agb.html" target="_blank">AGB</a> · <a href="legal/widerruf.html" target="_blank">Widerruf</a></p>`;
}

export async function afterAccountRender() {
  const q = state.route.query;
  const sessionId = q.get('voucher_session');
  if (q.get('checkout') === 'success') {
    history.replaceState(null, '', '#/account');
    toast('Danke! Dein Abo wird aktiviert …');
    // The Stripe webhook may arrive a moment after the redirect.
    for (let i = 0; i < 8; i++) {
      const a = await loadAccount().catch(() => null);
      if (a?.status === 'premium') break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (state.route.view === 'account') hooks.render();
    return;
  }
  if (sessionId) {
    history.replaceState(null, '', '#/account');
    toast('Gutschein wird erstellt …', true);
    for (let i = 0; i < 10; i++) {
      const { voucher } = await api('/vouchers/session?id=' + encodeURIComponent(sessionId)).catch(() => ({}));
      if (voucher) {
        showVoucherCode(voucher.code, voucher.months);
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  loadMyVouchers();
}

async function loadMyVouchers() {
  const el = $('#my-vouchers');
  if (!el) return;
  try {
    const { vouchers } = await api('/vouchers');
    if (!$('#my-vouchers')) return;
    el.innerHTML = vouchers.length ? `<div class="voucher-list">${vouchers.map((v) => `
      <div class="voucher-row"><code>${esc(v.code)}</code><span>${v.months} ${v.months === 1 ? 'Monat' : 'Monate'}</span>
        <span class="${v.redeemedAt ? 'muted' : 'ok'}">${v.redeemedAt ? 'eingelöst' : 'offen'}</span>
        ${v.redeemedAt ? '' : `<button class="icon-btn" data-action="copy-code" data-code="${esc(v.code)}" aria-label="Kopieren">${icon('copy')}</button>`}
      </div>`).join('')}</div>` : 'Noch keine Gutscheine gekauft.';
  } catch {
    el.textContent = 'Konnte nicht geladen werden.';
  }
}

function showVoucherCode(code, months) {
  openSheet(`<div class="voucher-reveal">${icon('gift')}
    <h3>Dein Melody-Gutschein</h3>
    <p class="muted">${months} ${months === 1 ? 'Monat' : 'Monate'} Melody Premium</p>
    <code class="big-code">${esc(code)}</code>
    <div class="row" style="justify-content:center">
      <button class="btn btn-primary" data-action="copy-code" data-code="${esc(code)}">${icon('copy')}Code kopieren</button>
      ${navigator.share ? `<button class="btn" data-action="share-code" data-code="${esc(code)}" data-months="${months}">Verschenken</button>` : ''}
    </div>
    <p class="muted small">Einlösen unter Konto → Gutschein einlösen. Der Code ist auch unter „Meine gekauften Gutscheine“ gespeichert.</p></div>`);
  loadMyVouchers();
}

// ---------- Actions & forms ----------
async function refreshAndContinue(msg) {
  const a = await loadAccount();
  if (msg) toast(msg);
  afterAccountChange(a);
}

export const accountActions = {
  'auth-tab': (el) => { authTab = el.dataset.tab; showGate('auth'); },
  'gate-retry': async () => {
    try {
      const a = await loadAccount();
      afterAccountChange(a);
    } catch {
      toast('Immer noch keine Verbindung.');
    }
  },
  buy: async (el) => {
    el.disabled = true;
    try {
      const r = await api('/billing/checkout', { method: 'POST', body: { kind: el.dataset.kind, id: el.dataset.id } });
      if (r.url) {
        location.href = r.url;
        return;
      }
      if (r.code) showVoucherCode(r.code, state.pricing.vouchers.find((v) => v.id === el.dataset.id)?.months || 1);
      else await refreshAndContinue('Willkommen bei Melody Premium! (Testmodus)');
    } catch (e) {
      toast(e.message);
    } finally {
      el.disabled = false;
    }
  },
  portal: async () => {
    try {
      const { url } = await api('/billing/portal', { method: 'POST', body: {} });
      location.href = url;
    } catch (e) { toast(e.message); }
  },
  'cancel-demo': async () => {
    await api('/billing/cancel-demo', { method: 'POST', body: {} }).catch((e) => toast(e.message));
    await refreshAndContinue('Abo beendet (Testmodus). Dein Zugang läuft bis zum Ende der Laufzeit.');
  },
  logout: async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setAccount(null);
    authTab = 'login';
    showGate('auth');
  },
  'delete-account': () => {
    openSheet(`<h3>Konto wirklich löschen?</h3><form class="stack" data-form="delete-account" style="padding:10px">
      <p class="muted">Bitte bestätige mit deinem Passwort. Das kann nicht rückgängig gemacht werden.</p>
      <input class="input plain" name="password" type="password" autocomplete="current-password" required>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
      <button class="btn btn-primary" style="background:var(--danger)">Endgültig löschen</button></div></form>`);
  },
  'copy-code': async (el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.code);
      toast('Code kopiert');
    } catch {
      toast(el.dataset.code);
    }
  },
  'share-code': (el) => {
    navigator.share({
      title: 'Ein Geschenk für dich: Melody Premium',
      text: `Ich schenke dir ${el.dataset.months} ${el.dataset.months === '1' ? 'Monat' : 'Monate'} Melody Premium – werbefreie Musik, Mitsingen & mehr. Dein Code: ${el.dataset.code}`,
    }).catch(() => {});
  },
};

export const accountForms = {
  student: async (form) => {
    try {
      const { account } = await api('/student/apply', {
        method: 'POST',
        body: {
          type: form.querySelector('[name=type]:checked')?.value, school: form.school.value,
          validUntil: form.validUntil.value, confirm: form.confirm.checked, guardian: form.guardian.checked,
        },
      });
      setAccount(account);
      toast(account.student.status === 'approved' ? 'Bestätigt! Du kannst jetzt das Schüler-Abo wählen.' : 'Danke! Wir prüfen deine Anfrage.');
      if ($('#gate').hidden) hooks.render(); else showGate('paywall');
    } catch (e) { toast(e.message); }
  },
  login: async (form) => {
    try {
      const { account } = await api('/auth/login', { method: 'POST', body: { email: form.email.value, password: form.password.value } });
      setAccount(account);
      toast(`Willkommen zurück, ${account.name}!`);
      afterAccountChange(account);
    } catch (e) { toast(e.message); }
  },
  register: async (form) => {
    try {
      const { account } = await api('/auth/register', {
        method: 'POST',
        body: { name: form.name.value, email: form.email.value, password: form.password.value, acceptTerms: form.acceptTerms.checked },
      });
      setAccount(account);
      toast(`Willkommen bei Melody, ${account.name}!`);
      afterAccountChange(account);
    } catch (e) { toast(e.message); }
  },
  redeem: async (form) => {
    try {
      const r = await api('/vouchers/redeem', { method: 'POST', body: { code: form.code.value } });
      setAccount(r.account);
      toast(`Gutschein eingelöst: ${r.months} ${r.months === 1 ? 'Monat' : 'Monate'} Premium!`);
      form.reset();
      afterAccountChange(r.account);
    } catch (e) { toast(e.message); }
  },
  'delete-account': async (form) => {
    try {
      await api('/account/delete', { method: 'POST', body: { password: form.password.value } });
      closeSheet();
      setAccount(null);
      toast('Dein Konto wurde gelöscht.');
      authTab = 'register';
      showGate('auth');
    } catch (e) { toast(e.message); }
  },
};

// Called on boot: resolves once the user may use the app.
export async function ensureAccess() {
  await loadPricing();
  let account;
  try {
    account = await loadAccount();
  } catch {
    await requireAccess('offline');
    return;
  }
  if (!account) return requireAccess('auth');
  if (!account.access) return requireAccess('paywall');
}

export { go };
