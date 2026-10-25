/* منطق الحساب: دفعات FIFO، الأرصدة، الأرباح، الفترات، الدمج */
(function (g) {
  'use strict';
  const EPS = 1e-9;
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const round = (v, d = 2) => Math.round((v + Number.EPSILON) * Math.pow(10, d)) / Math.pow(10, d);
  const cmp = (a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  // العمليات السارية = كل ما ليس إلغاءً وليس ملغىً
  function live(entries) {
    const voided = new Set(entries.filter(e => e.t === 'void').map(e => e.ref));
    return entries.filter(e => e.t !== 'void' && !voided.has(e.id));
  }
  function voidedSet(entries) {
    return new Set(entries.filter(e => e.t === 'void').map(e => e.ref));
  }

  // كل شراء = دفعة بسعرها، وكل بيع يُخصم من أقدم دفعة أولاً (FIFO) فيُحسب ربحه بدقة
  function fifo(L) {
    const ev = L.filter(e => e.t === 'buy' || e.t === 'sell').sort(cmp);
    const queue = [], all = {}, sales = {};
    let short = 0;
    for (const e of ev) {
      if (e.t === 'buy') {
        const b = { id: e.id, kg: e.kg, left: e.kg, ppk: e.amount / e.kg, ts: e.ts };
        queue.push(b); all[e.id] = b;
      } else {
        let need = e.kg, cost = 0;
        const parts = [];
        while (need > EPS && queue.length) {
          const b = queue[0];
          const take = Math.min(b.left, need);
          cost += take * b.ppk;
          parts.push({ batch: b.id, kg: take, ppk: b.ppk });
          b.left -= take; need -= take;
          if (b.left <= EPS) { b.left = 0; queue.shift(); }
        }
        const miss = need > EPS ? need : 0;
        short += miss;
        sales[e.id] = { cost, profit: e.amount - cost, parts, short: miss };
      }
    }
    const stock = queue.reduce((s, b) => s + b.left, 0);
    return { sales, batches: all, open: queue, stock, short };
  }

  // أين المال: رصيد كل شخص = ما استلمه − ما دفعه (كاش/تطبيق)
  function balances(L) {
    const b = {};
    const add = (p, m, x) => {
      if (!p) return;
      const o = b[p] || (b[p] = { cash: 0, app: 0 });
      o[m === 'app' ? 'app' : 'cash'] += x;
    };
    for (const e of L) {
      if (e.t === 'transfer' || e.t === 'sell') add(e.person, e.method, e.amount);
      else if (e.t === 'buy' || e.t === 'expense') add(e.person, e.method, -e.amount);
      else if (e.t === 'withdraw') add(e.person || '_pool', e.method, -e.amount); // السحب من الصندوق العام
    }
    return b;
  }

  // فترات: closes = أوقات الإغلاق. آخر فترة مفتوحة.
  function periods(closes) {
    const cs = closes.slice().sort((a, b) => a - b);
    const bounds = [0].concat(cs);
    return bounds.map((from, i) => ({ from, to: i < cs.length ? cs[i] : Infinity, open: i === cs.length }));
  }

  function stats(L, F, from, to) {
    const r = { transfer: 0, transferCount: 0, buyKg: 0, buyCost: 0, sellKg: 0, sellRev: 0, sellProfit: 0, expense: 0, withdrawn: 0 };
    const byWorker = {};
    for (const e of L) {
      if (e.ts < from || e.ts >= to) continue;
      if (e.t === 'transfer') {
        r.transfer += e.amount; r.transferCount++;
        byWorker[e.person] = (byWorker[e.person] || 0) + e.amount;
      } else if (e.t === 'buy') { r.buyKg += e.kg; r.buyCost += e.amount; }
      else if (e.t === 'sell') {
        r.sellKg += e.kg; r.sellRev += e.amount;
        r.sellProfit += F.sales[e.id] ? F.sales[e.id].profit : 0;
      } else if (e.t === 'expense') r.expense += e.amount;
      else if (e.t === 'withdraw') r.withdrawn += e.amount;
    }
    r.net = r.transfer + r.sellProfit - r.expense;
    r.margin = r.sellRev > 0 ? r.sellProfit / r.sellRev * 100 : 0;
    r.byWorker = byWorker;
    return r;
  }

  // توزيع الأرباح: نسب العمال إن وُجدت وإلا بالتساوي بين النشطين
  function shares(workers, L, F) {
    const act = workers.filter(w => w.active !== false);
    const total = stats(L, F, 0, Infinity).net;
    const pcts = act.map(w => num(w.pct));
    const sum = pcts.reduce((a, b) => a + b, 0);
    const wd = {};
    for (const e of L) if (e.t === 'withdraw') wd[e.to] = (wd[e.to] || 0) + e.amount;
    const rows = workers.map(w => {
      const isAct = w.active !== false;
      let ratio = 0;
      if (isAct) ratio = sum > 0 ? num(w.pct) / sum : 1 / (act.length || 1);
      const share = total * ratio;
      const withdrawn = wd[w.id] || 0;
      return { id: w.id, ratio, share, withdrawn, remaining: share - withdrawn };
    });
    return { total, rows };
  }

  // دمج بيانات جهازين: اتحاد حسب المعرّف (لا يضيع شيء ولا يتكرر)
  function merge(a, b) {
    const out = JSON.parse(JSON.stringify(a));
    const ids = new Set(out.entries.map(e => e.id));
    for (const e of (b.entries || [])) if (!ids.has(e.id)) { out.entries.push(e); ids.add(e.id); }
    const wids = new Set(out.workers.map(w => w.id));
    for (const w of (b.workers || [])) if (!wids.has(w.id)) { out.workers.push(w); wids.add(w.id); }
    const cs = new Set(out.closes);
    for (const c of (b.closes || [])) cs.add(c);
    out.closes = Array.from(cs).sort((x, y) => x - y);
    return out;
  }

  const api = { num, round, live, voidedSet, fifo, balances, periods, stats, shares, merge };
  g.Gas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
