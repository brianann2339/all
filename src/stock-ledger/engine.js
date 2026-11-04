(function () {
  'use strict';

  const epsilon = 1e-9;
  const zeroDust = value => Math.abs(value) < epsilon ? 0 : value;
  const provided = value => value !== null && value !== undefined && value !== '';
  const numeric = value => provided(value) && typeof value !== 'boolean' && Number.isFinite(Number(value));
  const positive = value => numeric(value) && Number(value) > 0;
  const nonnegative = value => numeric(value) && Number(value) >= 0;

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }

  function chronological(entries) {
    // Modern JavaScript's stable sort preserves entry order within a date.
    return entries.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function calculate(state = {}) {
    const trace = [], issues = [], positions = new Map();
    let cashUSD = 0, cashTWD = 0, realizedKnown = 0, unknownSales = 0;

    for (const entry of chronological(state.entries || [])) {
      const rowIssues = [];
      let deltaUSD = 0, deltaTWD = 0, realized = null;
      const ticker = String(entry.ticker || '').trim().toUpperCase();
      const position = positions.get(ticker) || { qty: 0, basis: 0 };
      const affectsShares = ['buy', 'sell', 'adjustment'].includes(entry.type);

      if (!validDate(entry.date)) {
        rowIssues.push('日期無效，請填入完整的年月日。');
      } else if (entry.status === 'pending') {
        rowIssues.push('這筆尚待確認，暫不計入餘額。');
      } else if (entry.type === 'funding') {
        if (positive(entry.twd)) deltaTWD = Number(entry.twd);
        else rowIssues.push('入金的新台幣金額須大於零。');
      } else if (entry.type === 'fx') {
        if (positive(entry.twd) && positive(entry.usd)) {
          deltaTWD = -Number(entry.twd);
          deltaUSD = Number(entry.usd);
        } else rowIssues.push('換匯請填入實際扣除的台幣與收到的美元，兩者都須大於零。');
      } else if (entry.type === 'cash') {
        if (numeric(entry.usd) && Number(entry.usd) !== 0) deltaUSD = Number(entry.usd);
        else rowIssues.push('美元現金異動須填非零金額。');
      } else if (affectsShares) {
        const isTrade = entry.type !== 'adjustment';
        const qty = Number(entry.qty);
        const fee = provided(entry.fee) ? Number(entry.fee) : 0;
        const gross = provided(entry.gross) ? Number(entry.gross) : qty * Number(entry.price);
        if (!ticker || !positive(entry.qty)) {
          rowIssues.push('請填入股票代號及大於零的股數。');
        } else if (isTrade && (!positive(entry.price) || !positive(gross) || !Number.isFinite(fee) || fee < 0)) {
          rowIssues.push('請確認成交價、成交總額與手續費。');
        } else if (!isTrade && provided(entry.basis) && !nonnegative(entry.basis)) {
          rowIssues.push('零股的總成本須為零或正數，尚未確認時可留白。');
        } else if (entry.type === 'sell') {
          deltaUSD = gross - fee;
          const oversold = qty > position.qty + epsilon;
          if (oversold) rowIssues.push('賣出股數超過已登記的持股，請補上股數來源。');
          if (!oversold && position.basis === null) rowIssues.push('這次賣出的持股成本尚未補齊。');
          if (oversold || position.basis === null || position.qty <= 0) {
            unknownSales++;
          } else {
            const soldBasis = position.basis * Math.min(1, qty / position.qty);
            realized = zeroDust(deltaUSD - soldBasis);
            realizedKnown += realized;
            position.basis = zeroDust(position.basis - soldBasis);
          }
          position.qty = zeroDust(position.qty - qty);
          if (position.qty <= 0) position.basis = 0;
          positions.set(ticker, position);
        } else {
          const cost = isTrade ? gross + fee : provided(entry.basis) ? Number(entry.basis) : null;
          if (isTrade) deltaUSD = -cost;
          else if (cost === null) rowIssues.push('這筆補登股數的成本尚待確認。');
          const newQty = zeroDust(position.qty + qty);
          // A buy following an unmatched sale first covers that share deficit.
          const availableQty = Math.max(0, newQty) - Math.max(0, position.qty);
          if (newQty <= 0) position.basis = 0;
          else if (position.basis === null || cost === null) position.basis = null;
          else position.basis += cost * (availableQty / qty);
          position.qty = newQty;
          positions.set(ticker, position);
        }
      } else rowIssues.push('這筆的交易類型無法辨識。');

      cashUSD = zeroDust(cashUSD + deltaUSD);
      cashTWD = zeroDust(cashTWD + deltaTWD);
      if (deltaUSD < 0 && cashUSD < 0) rowIssues.push('這筆扣款後美元不足，請核對先前的現金異動。');
      if (deltaTWD < 0 && cashTWD < 0) rowIssues.push('這筆換匯後台幣不足，請核對先前的入金。');
      for (const message of rowIssues) issues.push({ id: entry.id, date: entry.date, message });
      trace.push({ entry, deltaUSD, deltaTWD, cashUSD, cashTWD, realized, realizedKnown,
        qtyAfter: affectsShares ? position.qty : null, issues: rowIssues });
    }

    const holdings = [];
    for (const [ticker, { qty, basis }] of positions) {
      if (qty > 0) holdings.push({ ticker, qty, basis, averageCost: basis === null ? null : basis / qty });
    }
    holdings.sort((a, b) => a.ticker.localeCompare(b.ticker));

    let loanBalance = 0;
    const loanTrace = [];
    for (const entry of chronological(state.loans || [])) {
      const rowIssues = [];
      const borrow = provided(entry.borrow) ? entry.borrow : 0;
      const repay = provided(entry.repay) ? entry.repay : 0;
      if (!validDate(entry.date) || !nonnegative(borrow) || !nonnegative(repay)) {
        rowIssues.push('請確認借還款日期與金額，金額須為零或正數。');
      } else {
        loanBalance = zeroDust(loanBalance + Number(borrow) - Number(repay));
        if (Number(repay) > 0 && loanBalance < 0) rowIssues.push('還款累計已超過借款，請核對借還紀錄。');
      }
      for (const message of rowIssues) issues.push({ id: entry.id, date: entry.date, message });
      loanTrace.push({ entry, balance: loanBalance, issues: rowIssues });
    }
    return { trace, cashUSD, cashTWD, holdings, realized: unknownSales ? null : realizedKnown,
      realizedKnown, unknownSales, issues, loanTrace, loanBalance };
  }

  const api = { calculate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.LedgerEngine = api;
})();
