'use strict';
const G = window.Gas;
const KEY = 'gas_app_v1';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = n => G.round(n, 2).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtD = ts => new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const localISO = ts => { const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const sgn = n => (n < -0.005 ? 'neg' : n > 0.005 ? 'pos' : '');

let S = load();
let R = 'home';
let PID = null;
let D = null;
let authState = 'unknown';   // unknown | out | in | local | blocked
let workersLoaded = false;
let syncText = '⚪ محلي';
let pendingRender = false;

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.entries) return s; } catch (e) { }
  return { v: 1, workers: [], entries: [], closes: [], me: null };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('تعذّر الحفظ على الجهاز'); } }
function toast(m) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 2200); }
const wname = id => (S.workers.find(w => w.id === id) || { name: '—' }).name;
const activeW = () => S.workers.filter(w => w.active !== false);

function derive() {
  const L = G.live(S.entries);
  const F = G.fifo(L);
  const P = G.periods(S.closes);
  D = { L, F, P, vset: G.voidedSet(S.entries), cur: P[P.length - 1] };
  D.curStats = G.stats(L, F, D.cur.from, D.cur.to);
  D.bal = G.balances(L);
  D.led = G.ledger(L);
}

/* ---------- المزامنة وتسجيل الدخول ---------- */
const syncBadge = () => `<span id="syncState" class="sst">${esc(authState === 'local' ? '⚪ محلي' : syncText)}</span>`;
function sy(fn, arg) { try { if (window.Sync && window.Sync.ready) window.Sync[fn](arg); } catch (e) { } }
window.getLocal = () => S;
window.onSyncStatus = t => { syncText = t; const el = $('syncState'); if (el && authState === 'in') el.textContent = t; };
window.onSyncError = c => toast(c === 'permission-denied' ? 'ارفض الخادم الطلب: راجع قواعد قاعدة البيانات' : 'خطأ مزامنة: ' + c);

function rerender() {
  if ($('modal').classList.contains('on')) { pendingRender = true; return; }
  render();
}
window.onAuth = state => {
  authState = state;
  if (state === 'in') {
    decideSyncMode();
    workersLoaded = S.workers.length > 0;
    setTimeout(() => { if (!workersLoaded) { workersLoaded = true; rerender(); } }, 8000);
    window.Sync.start();
  }
  render();
};
function decideSyncMode() {
  if (S.syncChoice) return;
  if (S.entries.length || S.workers.length) {
    const up = confirm('على هذا الجهاز بيانات (' + S.entries.length + ' عملية).\n\nموافق = رفعها ودمجها مع بيانات الفريق\nإلغاء = حذفها من هذا الجهاز والاعتماد على بيانات الفريق');
    if (!up) { S.entries = []; S.workers = []; S.closes = []; }
  }
  S.syncChoice = true; save();
}
window.onRemote = (kind, items, confirmed) => {
  let changed = false;
  if (kind === 'entries') {
    const ids = new Set(S.entries.map(e => e.id));
    for (const e of items) if (!ids.has(e.id)) { S.entries.push(e); ids.add(e.id); changed = true; }
  } else if (kind === 'workers') {
    for (const w of items) {
      const l = S.workers.find(x => x.id === w.id);
      if (!l) { S.workers.push(w); changed = true; continue; }
      for (const k of ['name', 'active', 'pct', 'deleted']) if (JSON.stringify(l[k]) !== JSON.stringify(w[k])) { if (w[k] === undefined) delete l[k]; else l[k] = w[k]; changed = true; }
    }
    if (confirmed || items.length) workersLoaded = true;
    if (confirmed && !S.workers.length) changed = true;
  } else if (kind === 'closes') {
    const cs = new Set(S.closes);
    for (const t of items) if (!cs.has(t)) { S.closes.push(t); cs.add(t); changed = true; }
    S.closes.sort((a, b) => a - b);
  }
  if (changed) { save(); rerender(); }
};
function renderLoading(m) {
  $('app').innerHTML = `<header><h1>نقطة الغاز</h1></header><main><div class="card mut" style="text-align:center;padding:30px">${esc(m)}</div></main>`;
}
function renderBlocked() {
  $('app').innerHTML = `<header><h1>نقطة الغاز</h1></header><main><div class="card"><b>تعذّر تحميل نظام المزامنة</b>
  <p class="mut">يلزم اتصال بالإنترنت في أول مرة. تأكد من الاتصال ثم أعد المحاولة.</p><button class="btn" onclick="location.reload()">إعادة المحاولة</button></div></main>`;
}
function renderLogin() {
  let em = ''; try { em = localStorage.getItem('gas_email') || ''; } catch (e) { }
  $('app').innerHTML = `<div class="login"><form class="lcard" onsubmit="doLogin(event)" autocomplete="on">
  <div class="logo"><img src="icon-192.png" alt=""></div>
  <h1>نقطة الغاز</h1>
  <p class="sub">إدارة النقل والشراء والبيع بدقة</p>
  <div class="fld"><span class="ic">✉️</span><input id="lg_e" type="email" dir="ltr" placeholder="البريد الإلكتروني" value="${esc(em)}" autocomplete="username" required></div>
  <div class="fld"><span class="ic">🔒</span><input id="lg_p" type="password" dir="ltr" placeholder="كلمة سر الفريق" autocomplete="current-password" required>
  <button type="button" class="eye" onclick="togglePw()" aria-label="إظهار كلمة السر">👁</button></div>
  <div id="lg_m" class="lerr" style="display:none"></div>
  <button class="lbtn" id="lg_b" type="submit">دخول</button>
  <p class="hint">يُطلب الدخول مرة واحدة على كل جهاز</p>
  ${isStandalone() ? '' : '<button type="button" class="linkb" onclick="installApp()">⬇️ تثبيت التطبيق على جهازك</button>'}
  </form></div>`;
}
function togglePw() { const p = $('lg_p'); p.type = p.type === 'password' ? 'text' : 'password'; }
function lgErr(m) { const el = $('lg_m'); if (el) { el.textContent = m; el.style.display = 'block'; } }
async function doLogin(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const e = $('lg_e').value.trim(), p = $('lg_p').value;
  if (!e || !p) return lgErr('اكتب البريد وكلمة السر');
  if (!window.Sync) return lgErr('يلزم اتصال بالإنترنت لتحميل نظام الدخول');
  $('lg_b').disabled = true; $('lg_b').textContent = 'جارٍ الدخول...';
  try {
    await window.Sync.login(e, p);
    try { localStorage.setItem('gas_email', e); } catch (_) { }
  } catch (err) {
    $('lg_b').disabled = false; $('lg_b').textContent = 'دخول';
    const c = (err && err.code) || '';
    lgErr(/invalid|wrong|not-found|credential/.test(c) ? 'البريد أو كلمة السر غير صحيحة' : /network/.test(c) ? 'تعذّر الاتصال بالإنترنت' : 'تعذّر الدخول: ' + c);
  }
}
function logout() { if (confirm('تسجيل الخروج؟ تبقى بياناتك محفوظة على هذا الجهاز.') && window.Sync) window.Sync.logout(); }

/* ---------- تثبيت التطبيق ---------- */
let deferredInstall = null;
const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
const instBtn = () => isStandalone() ? '' : '<button id="instBtn" onclick="installApp()">⬇️ تثبيت التطبيق</button>';
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
window.addEventListener('appinstalled', () => { deferredInstall = null; const b = $('instBtn'); if (b) b.remove(); toast('تم تثبيت التطبيق'); });
function installApp() {
  if (deferredInstall) {
    const p = deferredInstall; deferredInstall = null;
    p.prompt();
    if (p.userChoice) p.userChoice.then(r => { if (r.outcome === 'accepted') toast('جارٍ التثبيت...'); });
    return;
  }
  $('sheet').innerHTML = `<h2 style="margin-top:0">تثبيت التطبيق</h2>
  <div class="card"><b>أندرويد (كروم)</b><p class="mut">اضغط القائمة ⋮ أعلى المتصفح ثم اختر <b>تثبيت التطبيق</b> أو <b>إضافة إلى الشاشة الرئيسية</b>.</p>
  <b>آيفون (سفاري)</b><p class="mut">اضغط زر المشاركة ثم <b>إضافة إلى الشاشة الرئيسية</b>.</p>
  <b>الكمبيوتر (كروم)</b><p class="mut">اضغط رمز التثبيت في شريط العنوان، أو القائمة ⋮ ثم حفظ ومشاركة ثم تثبيت الصفحة كتطبيق.</p>
  <p class="mut">إن لم يظهر الخيار فأغلق الصفحة وافتحها مرتين وأنت متصل بالإنترنت، وتأكد أنك في كروم وليس داخل تطبيق آخر.</p></div>
  <button class="btn" onclick="closeForm()">حسناً</button>`;
  $('modal').classList.add('on');
}

const TITLES = { home: 'نقطة الغاز', transfer: 'النقل', buy: 'الشراء', sell: 'البيع', more: 'المزيد', expense: 'المصاريف', money: 'أين المال', person: 'تفاصيل الشخص', profits: 'الأرباح والسحب', periods: 'الفترات', people: 'العمال', backup: 'نسخ ومزامنة يدوية' };
const SUB = ['person', 'expense', 'money', 'profits', 'periods', 'people', 'backup'];

function go(r) {
  if (r === 'whoami') { renderWho(); return; }
  R = r; render(); window.scrollTo(0, 0);
}

function render() {
  if (authState === 'unknown') return renderLoading('جارٍ التحميل...');
  if (authState === 'blocked') return renderBlocked();
  if (authState === 'out') return renderLogin();
  if (!S.workers.length) {
    if (authState === 'in' && !workersLoaded) return renderLoading('جارٍ جلب بيانات الفريق...');
    return renderSetup();
  }
  if (!S.me || !S.workers.find(w => w.id === S.me)) return renderWho();
  derive();
  const sub = SUB.includes(R);
  const tabs = [['home', 'الرئيسية', '🏠'], ['transfer', 'النقل', '🔁'], ['buy', 'الشراء', '⛽'], ['sell', 'البيع', '💰'], ['more', 'المزيد', '☰']];
  const active = sub ? 'more' : R;
  let body = '';
  if (R === 'home') body = pageHome();
  else if (['transfer', 'buy', 'sell', 'expense'].includes(R)) body = pageLedger(R);
  else if (R === 'more') body = pageMore();
  else if (R === 'money') body = pageMoney();
  else if (R === 'person') body = pagePerson();
  else if (R === 'profits') body = pageProfits();
  else if (R === 'periods') body = pagePeriods();
  else if (R === 'people') body = pagePeople();
  else if (R === 'backup') body = pageBackup();
  const fab = ['transfer', 'buy', 'sell', 'expense'].includes(R) ? `<button class="fab" onclick="openForm('${R}')">+</button>` : '';
  $('app').innerHTML = `<header>${sub ? `<button onclick="go('${R === 'person' ? 'money' : 'more'}')">→ رجوع</button>` : ''}<h1>${TITLES[R]}</h1>${syncBadge()}${instBtn()}<button onclick="go('whoami')">👤 ${esc(wname(S.me))}</button></header>
  <main>${body}</main>${fab}
  <nav>${tabs.map(t => `<button class="${t[0] === active ? 'on' : ''}" onclick="go('${t[0]}')"><span class="i">${t[2]}</span>${t[1]}</button>`).join('')}</nav>`;
}

function renderSetup() {
  $('app').innerHTML = `<header><h1>نقطة الغاز</h1>${instBtn()}</header><main>
  <div class="card"><b>أهلاً بك 👋</b><p class="mut">اكتب أسماء الشباب الذين يعملون في النقطة، اسماً في كل سطر.</p>
  <textarea id="names" rows="6" placeholder="محمد&#10;فادي"></textarea>
  <div style="height:10px"></div><button class="btn" onclick="setupSave()">حفظ والمتابعة</button></div></main>`;
}
function setupSave() {
  const names = $('names').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!names.length) return toast('اكتب اسماً واحداً على الأقل');
  S.workers = names.map(n => ({ id: uid(), name: n, active: true }));
  S.me = null; save(); S.workers.forEach(w => sy('pushWorker', w)); render();
}
function renderWho() {
  $('app').innerHTML = `<header><h1>من أنت؟</h1>${instBtn()}</header><main><p class="mut">اختر اسمك ليُسجَّل باسمك كل ما تُدخله على هذا الجهاز.</p>
  ${activeW().map(w => `<div class="menu"><button onclick="setMe('${w.id}')">👤 ${esc(w.name)}</button></div>`).join('')}</main>`;
}
function setMe(id) { S.me = id; save(); R = 'home'; render(); }

/* ---------- الرئيسية ---------- */
function pageHome() {
  const s = D.curStats, F = D.F;
  const per = Object.keys(s.byWorker).map(id => `<tr><td>${esc(wname(id))}</td><td class="n">${fmt(s.byWorker[id])} ₪</td></tr>`).join('');
  return `<div class="grid">
  <div class="stat hi"><small>الغاز المتبقي (كغ)</small><b>${fmt(F.stock)}</b></div>
  <div class="stat hi"><small>صافي ربح الفترة</small><b>${fmt(s.net)} ₪</b></div>
  <div class="stat"><small>مباع في الفترة (كغ)</small><b>${fmt(s.sellKg)}</b></div>
  <div class="stat"><small>ربح البيع</small><b>${fmt(s.sellProfit)} ₪</b></div>
  <div class="stat"><small>إجمالي النقل</small><b>${fmt(s.transfer)} ₪</b></div>
  <div class="stat"><small>المصاريف</small><b>${fmt(s.expense)} ₪</b></div>
  <div class="stat"><small>نسبة ربح البيع (من الإيراد)</small><b>${fmt(s.margin)}%</b></div>
  <div class="stat"><small>مشتريات الفترة (كغ)</small><b>${fmt(s.buyKg)}</b></div></div>
  ${F.short > 0 ? `<div class="prev warn">تنبيه: بِيع ما يزيد عن المخزون بمقدار ${fmt(F.short)} كغ، راجع الشراء.</div>` : ''}
  <h2>النقل حسب العامل (الفترة الحالية)</h2>
  <div class="card">${per ? `<table><tbody>${per}</tbody></table>` : '<span class="mut">لا توجد عمليات نقل بعد</span>'}</div>
  <h2>تكلفة المخزون (المتوسط)</h2>
  <div class="card"><table><tbody>
  <tr><td>الكيلوات المتبقية</td><td class="n">${fmt(F.stock)} كغ</td></tr>
  <tr><td>متوسط تكلفة الكيلو</td><td class="n">${fmt(F.avg)} ₪</td></tr>
  <tr><td>قيمة المخزون</td><td class="n">${fmt(F.value)} ₪</td></tr></tbody></table>
  <p class="mut">متوسط التكلفة = قيمة كل الغاز في الخزان ÷ كيلواته، ويتحدّث بعد كل شراء. وربح كل بيع = سعر البيع − (كيلوات البيع × هذا المتوسط).</p></div>`;
}

/* ---------- السجلات ---------- */
const LTITLE = { transfer: 'أجور النقل', buy: 'المشتريات', sell: 'المبيعات', expense: 'المصاريف' };
function pageLedger(t) {
  const items = S.entries.filter(e => e.t === t).sort((a, b) => b.ts - a.ts);
  const s = D.curStats;
  const sum = t === 'transfer' ? `<div class="stat hi"><small>إجمالي النقل (الفترة)</small><b>${fmt(s.transfer)} ₪</b></div><div class="stat"><small>عدد العمليات</small><b>${s.transferCount}</b></div>`
    : t === 'buy' ? `<div class="stat hi"><small>مشتريات الفترة (كغ)</small><b>${fmt(s.buyKg)}</b></div><div class="stat"><small>التكلفة</small><b>${fmt(s.buyCost)} ₪</b></div>`
      : t === 'sell' ? `<div class="stat hi"><small>مباع (كغ)</small><b>${fmt(s.sellKg)}</b></div><div class="stat"><small>الإيراد / الربح</small><b>${fmt(s.sellRev)} / ${fmt(s.sellProfit)}</b></div>`
        : `<div class="stat hi"><small>مصاريف الفترة</small><b>${fmt(s.expense)} ₪</b></div><div class="stat"><small>الغاز المتبقي (كغ)</small><b>${fmt(D.F.stock)}</b></div>`;
  return `<div class="grid">${sum}</div>${items.length ? items.map(card).join('') : '<div class="card mut">لا توجد عمليات بعد. اضغط + للإضافة.</div>'}`;
}
function card(e) {
  const v = D.vset.has(e.id);
  const m = `<span class="badge ${e.method === 'app' ? 'app' : ''}">${e.method === 'app' ? 'تطبيق' : 'كاش'}</span>`;
  let title = '', det = '';
  if (e.t === 'transfer') { title = `استلم: ${esc(wname(e.person))}`; det = ''; }
  else if (e.t === 'buy') {
    title = `دفع: ${esc(wname(e.person))}`;
    det = `${fmt(e.kg)} كغ × ${fmt(e.amount / e.kg)}`;
  } else if (e.t === 'sell') {
    const sl = D.F.sales[e.id];
    title = `استلم: ${esc(wname(e.person))}`;
    det = `${fmt(e.kg)} كغ × ${fmt(e.amount / e.kg)}` + (sl && !v ? ` · تكلفة الكيلو ${fmt(sl.avg)} · الربح <b class="${sgn(sl.profit)}">${fmt(sl.profit)}</b>${sl.short > 0 ? ' <span class="neg">(تجاوز المخزون)</span>' : ''}` : '');
  } else if (e.t === 'expense') { title = `دفع: ${esc(wname(e.person))}`; }
  else if (e.t === 'withdraw') { title = `سحب: ${esc(wname(e.to))}`; det = e.person ? `سلّم المبلغ: ${esc(wname(e.person))}` : 'من الصندوق العام'; }
  return `<div class="card entry ${v ? 'void' : ''}"><div class="top"><span>${title}${m}</span><span>${fmt(e.amount)} ₪</span></div>
  ${det ? `<div class="mut">${det}</div>` : ''}${e.note ? `<div class="mut">${esc(e.note)}</div>` : ''}
  <div class="row mut" style="margin-top:6px"><span>${fmtD(e.ts)} · أدخله ${esc(wname(e.by))}</span>${v ? '<span>ملغاة</span>' : `<button class="btn sec sm" onclick="voidEntry('${e.id}')">إلغاء</button>`}</div></div>`;
}
function voidEntry(id) {
  if (!confirm('إلغاء هذه العملية؟ تبقى في السجل مشطوبة ولا تُحسب.')) return;
  const v = { id: uid(), t: 'void', ts: Date.now(), ref: id, by: S.me };
  S.entries.push(v); sy('pushEntry', v);
  save(); render(); toast('تم الإلغاء');
}

/* ---------- النماذج ---------- */
function openForm(t) {
  const ws = activeW();
  const opts = sel => ws.map(w => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
  const label = { transfer: 'من استلم الأجرة', buy: 'من دفع الثمن', sell: 'من استلم الثمن', expense: 'من دفع المصروف', withdraw: 'من سلّم المبلغ' }[t];
  const head = { transfer: 'نقل جديد', buy: 'شراء غاز', sell: 'بيع غاز', expense: 'مصروف', withdraw: 'سحب من الأرباح' }[t];
  const kgf = (t === 'buy' || t === 'sell');
  $('sheet').innerHTML = `<h2 style="margin-top:0">${head}</h2>
  ${t === 'withdraw' ? `<label>من سحب نصيبه</label><select id="f_to">${opts(S.me)}</select>` : `<label>${label}</label><select id="f_person">${opts(S.me)}</select>`}
  ${kgf ? `<div class="two"><div><label>عدد الكيلوات</label><input id="f_kg" type="number" inputmode="decimal" step="any" oninput="calc('kg')"></div>
  <div><label>سعر الكيلو</label><input id="f_ppk" type="number" inputmode="decimal" step="any" oninput="calc('ppk')"></div></div>` : ''}
  <label>${kgf ? 'الإجمالي' : 'المبلغ'}</label><input id="f_amount" type="number" inputmode="decimal" step="any" oninput="calc('amount')">
  <label>طريقة الدفع</label><select id="f_method"><option value="cash">كاش</option><option value="app">تطبيق</option></select>
  <label>ملاحظة (اختياري)</label><input id="f_note" type="text">
  <label>الوقت</label><input id="f_ts" type="datetime-local" value="${localISO(Date.now())}">
  <div id="prev"></div>
  <div style="height:12px"></div>
  <div class="two"><button class="btn" id="f_save" onclick="saveForm('${t}')">حفظ</button><button class="btn sec" onclick="closeForm()">إلغاء</button></div>`;
  $('modal').classList.add('on');
}
function closeForm() { $('modal').classList.remove('on'); if (pendingRender) { pendingRender = false; render(); } }
function calc(src) {
  const kg = $('f_kg'), ppk = $('f_ppk'), am = $('f_amount');
  if (kg) {
    const k = G.num(kg.value);
    if (src === 'kg' || src === 'ppk') { if (k > 0 && G.num(ppk.value) > 0) am.value = G.round(k * G.num(ppk.value), 2); }
    else if (src === 'amount') { if (k > 0 && G.num(am.value) > 0) ppk.value = G.round(G.num(am.value) / k, 4); }
  }
  preview();
}
function preview() {
  const p = $('prev'); if (!p) return;
  const kg = $('f_kg'), am = $('f_amount');
  if (!kg || !$('f_ppk') || !(G.num(kg.value) > 0) || !(G.num(am.value) > 0)) { p.innerHTML = ''; return; }
  const isSell = document.querySelector('#sheet h2').textContent.indexOf('بيع') >= 0;
  if (!isSell) { p.innerHTML = `<div class="prev">المخزون بعد الشراء: ${fmt(D.F.stock + G.num(kg.value))} كغ</div>`; return; }
  const tmp = { id: '~', t: 'sell', ts: Date.now() + 1, kg: G.num(kg.value), amount: G.num(am.value) };
  const F2 = G.fifo(D.L.concat([tmp]));
  const s = F2.sales['~'];
  p.innerHTML = s.short > 0 ? `<div class="prev warn">المخزون الحالي ${fmt(D.F.stock)} كغ فقط، والكمية أكبر منه.</div>` : `<div class="prev">ربح هذا البيع: <b>${fmt(s.profit)} ₪</b> · تكلفة الكيلو ${fmt(s.avg)} · التكلفة ${fmt(s.cost)} · المخزون بعده ${fmt(F2.stock)} كغ</div>`;
}
function saveForm(t) {
  const person = $('f_person') ? $('f_person').value : undefined;
  const amount = G.num($('f_amount').value);
  const e = { id: uid(), t, ts: new Date($('f_ts').value).getTime() || Date.now(), by: S.me, method: $('f_method').value, amount: G.round(amount, 2), note: $('f_note').value.trim() };
  if (person) e.person = person;
  if (!(amount > 0)) return toast('اكتب مبلغاً صحيحاً');
  if (t === 'buy' || t === 'sell') {
    e.kg = G.num($('f_kg').value);
    if (!(e.kg > 0)) return toast('اكتب عدد الكيلوات');
    if (t === 'sell') {
      const F2 = G.fifo(D.L.concat([e]));
      if (F2.sales[e.id].short > 0 && !confirm('الكمية أكبر من المخزون الحالي. تسجيل البيع رغم ذلك؟')) return;
    }
  }
  if (t === 'withdraw') e.to = $('f_to').value;
  $('f_save').disabled = true;
  S.entries.push(e); sy('pushEntry', e); save(); closeForm(); render(); toast('تم الحفظ');
}

/* ---------- المزيد ---------- */
function pageMore() {
  const items = [['expense', '🧾', 'المصاريف'], ['money', '👛', 'أين المال'], ['profits', '📈', 'الأرباح والسحب'], ['periods', '🗓️', 'الفترات والتسوية'], ['people', '👥', 'العمال'], ['backup', '💾', 'نسخ ومزامنة يدوية']];
  const out = authState === 'in' ? '<button onclick="logout()"><span>🚪</span>تسجيل الخروج من المزامنة</button>' : '';
  return `<div class="menu">${items.map(i => `<button onclick="go('${i[0]}')"><span>${i[1]}</span>${i[2]}</button>`).join('')}${out}</div>`;
}

function openPerson(id) { PID = id; go('person'); }
function pageMoney() {
  const led = D.led;
  const z = { recv: 0, paid: 0, net: 0 };
  const visible = S.workers.filter(w => w.active !== false || (led[w.id] && (Math.abs(led[w.id].recv) + Math.abs(led[w.id].paid)) > 0.005));
  let tr = 0, tp = 0;
  const rows = visible.map(w => {
    const r = led[w.id] || z;
    tr += r.recv; tp += r.paid;
    return `<tr onclick="openPerson('${w.id}')" style="cursor:pointer"><td>${esc(w.name || '(بلا اسم)')} ›</td><td class="n pos">${fmt(r.recv)}</td><td class="n neg">${fmt(r.paid)}</td><td class="n ${sgn(r.net)}"><b>${fmt(r.net)}</b></td></tr>`;
  }).join('');
  const pool = led._pool;
  let poolRow = '';
  if (pool) { tp += pool.paid; poolRow = `<tr><td>سحوبات الأرباح</td><td class="n">0</td><td class="n neg">${fmt(pool.paid)}</td><td class="n neg"><b>${fmt(-pool.paid)}</b></td></tr>`; }
  const tn = tr - tp;
  return `<div class="card"><table><thead><tr><th>الاسم</th><th class="n">استلم</th><th class="n">دفع</th><th class="n">الصافي</th></tr></thead><tbody>${rows}${poolRow}
  <tr><td><b>الصندوق الآن</b></td><td class="n">${fmt(tr)}</td><td class="n">${fmt(tp)}</td><td class="n ${sgn(tn)}"><b>${fmt(tn)}</b></td></tr></tbody></table></div>
  <p class="mut">اضغط على أي اسم لترى تفاصيل ما استلمه وما دفعه. الصافي = ما استلمه − ما دفعه: الموجب معه مال للصندوق، والسالب له دين على الصندوق. وسحوبات الأرباح تُخصم من الصندوق العام ولا تُنسب لأحد.</p>`;
}
function pagePerson() {
  const w = S.workers.find(x => x.id === PID);
  if (!w) return '<div class="card mut">لا يوجد</div>';
  const r = D.led[PID] || { transfer: 0, sell: 0, buy: 0, expense: 0, recv: 0, paid: 0, net: 0, cash: 0, app: 0 };
  const items = S.entries.filter(e => e.person === PID && ['transfer', 'sell', 'buy', 'expense'].includes(e.t)).sort((x, y) => y.ts - x.ts);
  return `<div class="card"><b style="font-size:18px">${esc(w.name || '(بلا اسم)')}</b>
  <div class="mut">${r.net >= 0 ? 'معه من مال الصندوق' : 'له على الصندوق'}</div>
  <div class="stat hi" style="margin-top:8px"><small>الصافي</small><b>${fmt(r.net)} ₪</b></div></div>
  <div class="grid">
  <div class="stat"><small>إجمالي ما استلمه</small><b class="pos">${fmt(r.recv)}</b><small>نقل ${fmt(r.transfer)} · بيع ${fmt(r.sell)}</small></div>
  <div class="stat"><small>إجمالي ما دفعه</small><b class="neg">${fmt(r.paid)}</b><small>شراء ${fmt(r.buy)} · مصاريف ${fmt(r.expense)}</small></div>
  <div class="stat"><small>الصافي كاش</small><b class="${sgn(r.cash)}">${fmt(r.cash)}</b></div>
  <div class="stat"><small>الصافي تطبيق</small><b class="${sgn(r.app)}">${fmt(r.app)}</b></div></div>
  <h2>عملياته</h2>${items.length ? items.map(card).join('') : '<div class="card mut">لا توجد عمليات</div>'}`;
}

function pageProfits() {
  const sh = G.shares(S.workers, D.L, D.F);
  const wds = S.entries.filter(e => e.t === 'withdraw').sort((a, b) => b.ts - a.ts);
  return `<div class="stat hi" style="margin-bottom:10px"><small>صافي الأرباح منذ البداية</small><b>${fmt(sh.total)} ₪</b></div>
  <div class="card"><table><thead><tr><th>الاسم</th><th class="n">نصيبه</th><th class="n">سحب</th><th class="n">المتبقي</th></tr></thead><tbody>
  ${sh.rows.filter(r => r.ratio > 0 || r.withdrawn > 0).map(r => `<tr><td>${esc(wname(r.id))}<div class="mut">${fmt(r.ratio * 100)}%</div></td><td class="n">${fmt(r.share)}</td><td class="n">${fmt(r.withdrawn)}</td><td class="n ${sgn(r.remaining)}"><b>${fmt(r.remaining)}</b></td></tr>`).join('')}</tbody></table></div>
  <button class="btn" onclick="openForm('withdraw')">+ تسجيل سحب</button>
  <h2>سجل السحوبات</h2>${wds.length ? wds.map(card).join('') : '<div class="card mut">لا توجد سحوبات</div>'}`;
}

function pagePeriods() {
  const P = D.P;
  const past = P.slice(0, -1).reverse().map((p, i) => {
    const s = G.stats(D.L, D.F, p.from, p.to);
    return `<div class="card"><div class="row"><b>${fmtD(p.from || S.entries[0] && S.entries[0].ts || p.to)} ← ${fmtD(p.to)}</b><b class="${sgn(s.net)}">${fmt(s.net)} ₪</b></div>
    <div class="mut">نقل ${fmt(s.transfer)} · ربح بيع ${fmt(s.sellProfit)} · مصاريف ${fmt(s.expense)} · مباع ${fmt(s.sellKg)} كغ</div></div>`;
  }).join('');
  const sh = G.shares(S.workers, D.L, D.F);
  const sett = sh.rows.filter(r => r.ratio > 0).map(r => {
    const b = D.bal[r.id] || { cash: 0, app: 0 };
    return `<tr><td>${esc(wname(r.id))}</td><td class="n ${sgn(b.cash + b.app)}">${fmt(b.cash + b.app)}</td><td class="n">${fmt(r.remaining)}</td></tr>`;
  }).join('');
  const s = D.curStats;
  return `<div class="card"><b>الفترة الحالية</b><div class="mut">بدأت: ${D.cur.from ? fmtD(D.cur.from) : 'من أول عملية'}</div>
  <div class="mut">نقل ${fmt(s.transfer)} · ربح بيع ${fmt(s.sellProfit)} · مصاريف ${fmt(s.expense)} · الصافي <b>${fmt(s.net)}</b></div>
  <div style="height:10px"></div><button class="btn red" onclick="closePeriod()">إغلاق الفترة</button>
  <p class="mut">عند الإغلاق يبقى المخزون والأرصدة والأرباح غير المسحوبة كما هي وتبدأ فترة جديدة.</p></div>
  <h2>كشف التسوية الحالي</h2><div class="card"><table><thead><tr><th>الاسم</th><th class="n">ما معه</th><th class="n">باقي ربحه</th></tr></thead><tbody>${sett}</tbody></table>
  <p class="mut">"ما معه" هو رصيده من صفحة أين المال، و"باقي ربحه" نصيبه من الأرباح بعد ما سحبه.</p></div>
  <h2>الفترات المغلقة</h2>${past || '<div class="card mut">لا توجد فترات مغلقة</div>'}`;
}
function closePeriod() {
  if (!confirm('إغلاق الفترة الحالية وبدء فترة جديدة؟')) return;
  const ct = Date.now(); S.closes.push(ct); sy('pushClose', ct); save(); render(); toast('تم إغلاق الفترة');
}

function pagePeople() {
  return `${S.workers.filter(w => !w.deleted).map(w => `<div class="card" style="${w.active === false ? 'opacity:.6' : ''}"><div class="row"><b>${esc(w.name || '(بلا اسم)')}${w.active === false ? ' <span class="badge">موقوف</span>' : ''}</b>
  <span><button class="btn sec sm" onclick="toggleW('${w.id}')">${w.active === false ? 'تفعيل' : 'إيقاف'}</button> <button class="btn red sm" onclick="removeW('${w.id}')">حذف</button></span></div>
  <label>نسبة من الأرباح % (فارغ = بالتساوي)</label><input type="number" inputmode="decimal" value="${w.pct || ''}" onchange="setPct('${w.id}',this.value)"></div>`).join('')}
  <div class="card"><label>إضافة عامل</label><input id="nw" type="text" placeholder="الاسم"><div style="height:8px"></div><button class="btn" onclick="addW()">إضافة</button></div>`;
}
function removeW(id) {
  const w = S.workers.find(x => x.id === id); if (!w) return;
  const used = S.entries.some(e => e.person === id || e.to === id || e.by === id);
  if (used) return alert('لا يمكن حذف «' + w.name + '» لأن له عمليات مسجّلة، حتى لا تضيع سجلاتك.\nاستخدم «إيقاف» ليختفي من القوائم ويبقى في السجل.');
  if (!confirm('حذف «' + w.name + '» نهائياً؟')) return;
  w.deleted = true; w.active = false; sy('pushWorker', w); save(); render(); toast('تم الحذف');
}
function toggleW(id) { const w = S.workers.find(x => x.id === id); w.active = w.active === false; sy('pushWorker', w); save(); render(); }
function setPct(id, v) { const w = S.workers.find(x => x.id === id); w.pct = G.num(v) || 0; sy('pushWorker', w); save(); toast('تم'); }
function addW() { const n = $('nw').value.trim(); if (!n) return; const nw = { id: uid(), name: n, active: true }; S.workers.push(nw); sy('pushWorker', nw); save(); render(); }

/* ---------- نسخ احتياطي ومزامنة يدوية ---------- */
function pageBackup() {
  return `<div class="card"><p class="mut">إلى أن نربط التطبيق بالخادم، يمكنك تصدير بيانات هذا الجهاز وإرسالها لزميلك، فيستوردها فتُدمج مع بياناته دون تكرار ودون ضياع.</p>
  <button class="btn" onclick="exportData()">تصدير البيانات</button><div style="height:10px"></div>
  <label>استيراد ودمج ملف</label><input type="file" accept="application/json,.json" onchange="importData(this)"></div>`;
}
function exportData() {
  const b = new Blob([JSON.stringify(S)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'gas-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
}
function importData(inp) {
  const f = inp.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const o = JSON.parse(r.result);
      if (!o || !Array.isArray(o.entries) || !Array.isArray(o.workers)) throw 0;
      const me = S.me, before = new Set(S.entries.map(e => e.id)), choice = S.syncChoice;
      S = G.merge(S, o); S.me = me; S.syncChoice = choice;
      S.entries.filter(e => !before.has(e.id)).forEach(e => sy('pushEntry', e));
      S.workers.forEach(w => sy('pushWorker', w)); S.closes.forEach(t => sy('pushClose', t));
      save(); render(); toast('تم الدمج');
    } catch (e) { toast('الملف غير صالح'); }
  };
  r.readAsText(f);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
// إن لم يُحمَّل نظام المزامنة (دون إنترنت): نعمل محلياً إن كانت هناك بيانات
setTimeout(() => {
  if (authState === 'unknown') { authState = S.workers.length ? 'local' : 'blocked'; render(); }
}, 4000);
render();
