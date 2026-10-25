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
let D = null;

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
}

const TITLES = { home: 'نقطة الغاز', transfer: 'النقل', buy: 'الشراء', sell: 'البيع', more: 'المزيد', expense: 'المصاريف', money: 'أين المال', profits: 'الأرباح والسحب', periods: 'الفترات', people: 'العمال', backup: 'نسخ ومزامنة يدوية' };
const SUB = ['expense', 'money', 'profits', 'periods', 'people', 'backup'];

function go(r) {
  if (r === 'whoami') { renderWho(); return; }
  R = r; render(); window.scrollTo(0, 0);
}

function render() {
  if (!S.workers.length) return renderSetup();
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
  else if (R === 'profits') body = pageProfits();
  else if (R === 'periods') body = pagePeriods();
  else if (R === 'people') body = pagePeople();
  else if (R === 'backup') body = pageBackup();
  const fab = ['transfer', 'buy', 'sell', 'expense'].includes(R) ? `<button class="fab" onclick="openForm('${R}')">+</button>` : '';
  $('app').innerHTML = `<header>${sub ? '<button onclick="go(\'more\')">→ رجوع</button>' : ''}<h1>${TITLES[R]}</h1><button onclick="go('whoami')">👤 ${esc(wname(S.me))}</button></header>
  <main>${body}</main>${fab}
  <nav>${tabs.map(t => `<button class="${t[0] === active ? 'on' : ''}" onclick="go('${t[0]}')"><span class="i">${t[2]}</span>${t[1]}</button>`).join('')}</nav>`;
}

function renderSetup() {
  $('app').innerHTML = `<header><h1>نقطة الغاز</h1></header><main>
  <div class="card"><b>أهلاً بك 👋</b><p class="mut">اكتب أسماء الشباب الذين يعملون في النقطة، اسماً في كل سطر.</p>
  <textarea id="names" rows="6" placeholder="محمد&#10;فادي"></textarea>
  <div style="height:10px"></div><button class="btn" onclick="setupSave()">حفظ والمتابعة</button></div></main>`;
}
function setupSave() {
  const names = $('names').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!names.length) return toast('اكتب اسماً واحداً على الأقل');
  S.workers = names.map(n => ({ id: uid(), name: n, active: true }));
  S.me = null; save(); render();
}
function renderWho() {
  $('app').innerHTML = `<header><h1>من أنت؟</h1></header><main><p class="mut">اختر اسمك ليُسجَّل باسمك كل ما تُدخله على هذا الجهاز.</p>
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
  <h2>الدفعات المفتوحة</h2>
  <div class="card">${F.open.length ? `<table><thead><tr><th>التاريخ</th><th class="n">المتبقي كغ</th><th class="n">سعر الكيلو</th></tr></thead><tbody>${F.open.map(b => `<tr><td>${fmtD(b.ts)}</td><td class="n">${fmt(b.left)} / ${fmt(b.kg)}</td><td class="n">${fmt(b.ppk)}</td></tr>`).join('')}</tbody></table>` : '<span class="mut">لا يوجد مخزون</span>'}</div>`;
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
    const b = D.F.batches[e.id];
    title = `دفع: ${esc(wname(e.person))}`;
    det = `${fmt(e.kg)} كغ × ${fmt(e.amount / e.kg)} · المتبقي من الدفعة ${b && !v ? fmt(b.left) : '—'} كغ`;
  } else if (e.t === 'sell') {
    const sl = D.F.sales[e.id];
    title = `استلم: ${esc(wname(e.person))}`;
    det = `${fmt(e.kg)} كغ × ${fmt(e.amount / e.kg)}` + (sl && !v ? ` · الربح <b class="${sgn(sl.profit)}">${fmt(sl.profit)}</b>${sl.short > 0 ? ' <span class="neg">(تجاوز المخزون)</span>' : ''}` : '');
  } else if (e.t === 'expense') { title = `دفع: ${esc(wname(e.person))}`; }
  else if (e.t === 'withdraw') { title = `سحب: ${esc(wname(e.to))}`; det = `سلّم المبلغ: ${esc(wname(e.person))}`; }
  return `<div class="card entry ${v ? 'void' : ''}"><div class="top"><span>${title}${m}</span><span>${fmt(e.amount)} ₪</span></div>
  ${det ? `<div class="mut">${det}</div>` : ''}${e.note ? `<div class="mut">${esc(e.note)}</div>` : ''}
  <div class="row mut" style="margin-top:6px"><span>${fmtD(e.ts)} · أدخله ${esc(wname(e.by))}</span>${v ? '<span>ملغاة</span>' : `<button class="btn sec sm" onclick="voidEntry('${e.id}')">إلغاء</button>`}</div></div>`;
}
function voidEntry(id) {
  if (!confirm('إلغاء هذه العملية؟ تبقى في السجل مشطوبة ولا تُحسب.')) return;
  S.entries.push({ id: uid(), t: 'void', ts: Date.now(), ref: id, by: S.me });
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
  <label>${label}</label><select id="f_person">${opts(S.me)}</select>
  ${t === 'withdraw' ? `<label>من سحب</label><select id="f_to">${opts(S.me)}</select>` : ''}
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
function closeForm() { $('modal').classList.remove('on'); }
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
  p.innerHTML = s.short > 0 ? `<div class="prev warn">المخزون الحالي ${fmt(D.F.stock)} كغ فقط، والكمية أكبر منه.</div>` : `<div class="prev">ربح هذا البيع: <b>${fmt(s.profit)} ₪</b> · التكلفة ${fmt(s.cost)} · المخزون بعده ${fmt(F2.stock)} كغ</div>`;
}
function saveForm(t) {
  const person = $('f_person').value;
  const amount = G.num($('f_amount').value);
  const e = { id: uid(), t, ts: new Date($('f_ts').value).getTime() || Date.now(), by: S.me, person, method: $('f_method').value, amount: G.round(amount, 2), note: $('f_note').value.trim() };
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
  S.entries.push(e); save(); closeForm(); render(); toast('تم الحفظ');
}

/* ---------- المزيد ---------- */
function pageMore() {
  const items = [['expense', '🧾', 'المصاريف'], ['money', '👛', 'أين المال'], ['profits', '📈', 'الأرباح والسحب'], ['periods', '🗓️', 'الفترات والتسوية'], ['people', '👥', 'العمال'], ['backup', '💾', 'نسخ ومزامنة يدوية']];
  return `<div class="menu">${items.map(i => `<button onclick="go('${i[0]}')"><span>${i[1]}</span>${i[2]}</button>`).join('')}</div>`;
}

function pageMoney() {
  let tc = 0, ta = 0;
  const rows = S.workers.map(w => {
    const b = D.bal[w.id] || { cash: 0, app: 0 };
    tc += b.cash; ta += b.app;
    const tot = b.cash + b.app;
    return `<tr><td>${esc(w.name)}</td><td class="n ${sgn(b.cash)}">${fmt(b.cash)}</td><td class="n ${sgn(b.app)}">${fmt(b.app)}</td><td class="n ${sgn(tot)}"><b>${fmt(tot)}</b></td></tr>`;
  }).join('');
  return `<div class="card"><table><thead><tr><th>الاسم</th><th class="n">كاش</th><th class="n">تطبيق</th><th class="n">المجموع</th></tr></thead><tbody>${rows}
  <tr><td><b>الإجمالي</b></td><td class="n">${fmt(tc)}</td><td class="n">${fmt(ta)}</td><td class="n"><b>${fmt(tc + ta)}</b></td></tr></tbody></table></div>
  <p class="mut">الرصيد = ما استلمه الشخص − ما دفعه. الموجب معه مال للصندوق، والسالب له دين على الصندوق.</p>`;
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
  S.closes.push(Date.now()); save(); render(); toast('تم إغلاق الفترة');
}

function pagePeople() {
  return `${S.workers.map(w => `<div class="card"><div class="row"><b>${esc(w.name)}</b>
  <button class="btn sec sm" onclick="toggleW('${w.id}')">${w.active === false ? 'تفعيل' : 'إيقاف'}</button></div>
  <label>نسبة من الأرباح % (فارغ = بالتساوي)</label><input type="number" inputmode="decimal" value="${w.pct || ''}" onchange="setPct('${w.id}',this.value)"></div>`).join('')}
  <div class="card"><label>إضافة عامل</label><input id="nw" type="text" placeholder="الاسم"><div style="height:8px"></div><button class="btn" onclick="addW()">إضافة</button></div>`;
}
function toggleW(id) { const w = S.workers.find(x => x.id === id); w.active = w.active === false; save(); render(); }
function setPct(id, v) { const w = S.workers.find(x => x.id === id); w.pct = G.num(v) || 0; save(); toast('تم'); }
function addW() { const n = $('nw').value.trim(); if (!n) return; S.workers.push({ id: uid(), name: n, active: true }); save(); render(); }

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
      const me = S.me;
      S = G.merge(S, o); S.me = me;
      save(); render(); toast('تم الدمج');
    } catch (e) { toast('الملف غير صالح'); }
  };
  r.readAsText(f);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
render();
