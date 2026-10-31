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

  // خزان واحد يختلط فيه الغاز: المتوسط المرجّح المتحرك.
  // بعد كل شراء: سعر الكيلو = قيمة المخزون كلها ÷ كيلوات المخزون كلها، وكل بيع يُحسب به.
  function fifo(L) {
    const ev = L.filter(e => e.t === 'buy' || e.t === 'sell').sort(cmp);
    const sales = {};
    let stock = 0, value = 0, short = 0;
    for (const e of ev) {
      if (e.t === 'buy') {
        stock += e.kg; value += e.amount;
      } else {
        const avg = stock > EPS ? value / stock : 0;
        const take = Math.min(e.kg, Math.max(stock, 0));
        const cost = take * avg;
        const miss = e.kg - take > EPS ? e.kg - take : 0;
        stock -= take; value -= cost;
        if (stock <= EPS) { stock = 0; value = 0; }
        short += miss;
        sales[e.id] = { cost, profit: e.amount - cost, avg, short: miss };
      }
    }
    return { sales, stock, value, avg: stock > EPS ? value / stock : 0, short, batches: {}, open: [] };
  }

  // تفصيل كل شخص: ما استلمه (نقل + بيع) وما دفعه (شراء + مصاريف + سحب) والتسويات (رد رأس المال)
  // الصافي = استلم − دفع + (ما استرده − ما سلّمه). والتسويات مجموعها صفر دائماً لأنها انتقال داخلي.
  function ledger(L) {
    const o = {};
    const g = p => o[p] || (o[p] = { transfer: 0, sell: 0, buy: 0, expense: 0, withdraw: 0, repayIn: 0, repayOut: 0, cash: 0, app: 0 });
    for (const e of L) {
      const m = e.method === 'app' ? 'app' : 'cash';
      if (e.t === 'repay') {
        if (e.to) { const r = g(e.to); r.repayIn += e.amount; r[m] += e.amount; }
        const r2 = g(e.person || '_pool'); r2.repayOut += e.amount; r2[m] -= e.amount;
        continue;
      }
      const p = e.person || (e.t === 'withdraw' ? '_pool' : null);
      if (!p) continue;
      const r = g(p);
      if (e.t === 'transfer' || e.t === 'sell') { r[e.t] += e.amount; r[m] += e.amount; }
      else if (e.t === 'buy' || e.t === 'expense' || e.t === 'withdraw') { r[e.t] += e.amount; r[m] -= e.amount; }
    }
    for (const k in o) {
      const r = o[k];
      r.recv = r.transfer + r.sell; r.paid = r.buy + r.expense + r.withdraw;
      r.settle = r.repayIn - r.repayOut; r.net = r.recv - r.paid + r.settle;
    }
    return o;
  }

  // أين المال: رصيد كل شخص كاش/تطبيق
  function balances(L) {
    const led = ledger(L), b = {};
    for (const k in led) b[k] = { cash: led[k].cash, app: led[k].app };
    return b;
  }

  // رأس المال والربح: من الشراء إلى الربح المتبقي أو العجز
  //   صافي الربح = ربح البيع + النقل − المصاريف
  //   الربح المتبقي (أو العجز) = صافي الربح − ما سُحب
  //   وهو يساوي: الصندوق الآن + قيمة الغاز في الخزان  (للتحقق من سلامة الحساب)
  function capital(L, F) {
    const r = { buy: 0, buyKg: 0, sell: 0, sellKg: 0, transfer: 0, expense: 0, withdraw: 0, repay: 0 };
    for (const e of L) {
      if (e.t === 'buy') { r.buy += e.amount; r.buyKg += e.kg; }
      else if (e.t === 'sell') { r.sell += e.amount; r.sellKg += e.kg; }
      else if (e.t === 'transfer') r.transfer += e.amount;
      else if (e.t === 'expense') r.expense += e.amount;
      else if (e.t === 'withdraw') r.withdraw += e.amount;
      else if (e.t === 'repay') r.repay += e.amount;
    }
    r.cogs = Object.keys(F.sales).reduce((s, k) => s + F.sales[k].cost, 0);
    r.sellProfit = r.sell - r.cogs;
    r.profit = r.transfer + r.sellProfit - r.expense;
    r.stockKg = F.stock; r.stockValue = F.value;
    r.left = r.profit - r.withdraw;
    const led = ledger(L);
    r.cashNet = Object.keys(led).reduce((s, k) => s + led[k].net, 0);
    r.equity = r.cashNet + F.value;
    r.diff = r.equity - r.left;
    // ما يستحقه أصحاب رأس المال (من دفع ولم يُسترد له)
    r.owed = Object.keys(led).filter(k => k !== '_pool' && led[k].net < -0.005).map(k => ({ id: k, amount: -led[k].net }));
    return r;
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

  const api = { num, round, live, voidedSet, fifo, balances, ledger, capital, periods, stats, shares, merge };
  g.Gas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
