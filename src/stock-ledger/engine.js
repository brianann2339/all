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
    let fundingUSD = 0, fundingTWD = 0, netExternalUSD = 0, netDividendsUSD = 0;
    let hasShareAdjustments = false;

    for (const entry of chronological(state.entries || [])) {
      const rowIssues = [];
      let deltaUSD = 0, deltaTWD = 0, realized = null;
      const ticker = String(entry.ticker || '').trim().toUpperCase();
      const position = positions.get(ticker) || { qty: 0, basis: 0 };
      const affectsShares = ['buy', 'sell', 'adjustment'].includes(entry.type);
      const isUSD = (entry.currency ?? 'USD') === 'USD';

      if (!validDate(entry.date)) {
        rowIssues.push('日期無效，請填入完整的年月日。');
      } else if (entry.status === 'pending') {
        rowIssues.push('這筆尚待確認，暫不計入餘額。');
      } else if (entry.type === 'funding') {
        const twd = provided(entry.twd) ? entry.twd : 0;
        const usd = provided(entry.usd) ? entry.usd : 0;
        if (nonnegative(twd) && nonnegative(usd) && (Number(twd) > 0 || Number(usd) > 0)) {
          deltaTWD = Number(twd);
          deltaUSD = Number(usd);
          fundingTWD += deltaTWD;
          fundingUSD += deltaUSD;
        } else rowIssues.push('投入金額不能是負數，請至少填一筆大於零的美元或台幣。');
      } else if (entry.type === 'fx') {
        if (positive(entry.twd) && positive(entry.usd)) {
          deltaTWD = -Number(entry.twd);
          deltaUSD = Number(entry.usd);
        } else rowIssues.push('換匯請填入實際扣除的台幣與收到的美元，兩者都須大於零。');
      } else if (entry.type === 'cash') {
        if (numeric(entry.usd) && Number(entry.usd) !== 0) deltaUSD = Number(entry.usd);
        else rowIssues.push('美元現金異動須填非零金額。');
      } else if (entry.type === 'dividend') {
        const tax = provided(entry.tax) ? entry.tax : 0;
        const fee = provided(entry.fee) ? entry.fee : 0;
        if (!isUSD) rowIssues.push('本帳本的現金股息以美元登記。');
        else if (!ticker || !positive(entry.amount) || !nonnegative(tax) || !nonnegative(fee)) {
          rowIssues.push('現金股息須填股票代號及稅前金額，預扣稅與費用不能是負數。');
        } else {
          const net = zeroDust(Number(entry.amount) - Number(tax) - Number(fee));
          if (net < 0) rowIssues.push('預扣稅和費用合計超過這筆稅前股息。');
          else {
            deltaUSD = net;
            netDividendsUSD += net;
          }
        }
      } else if (affectsShares) {
        const isTrade = entry.type !== 'adjustment';
        const qty = Number(entry.qty);
        const fee = provided(entry.fee) ? Number(entry.fee) : 0;
        const gross = provided(entry.gross) ? Number(entry.gross) : qty * Number(entry.price);
        if (isTrade && !isUSD) {
          rowIssues.push('本帳本的股票成交金額以美元登記。');
        } else if (!ticker || !positive(entry.qty)) {
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
          else {
            hasShareAdjustments = true;
            if (cost === null) rowIssues.push('這筆補登股數的成本尚待確認。');
          }
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
      if (['funding', 'fx', 'cash'].includes(entry.type)) netExternalUSD += deltaUSD;
      if (deltaUSD < 0 && cashUSD < 0) rowIssues.push('這筆扣款後美元不足，請核對先前的現金異動。');
      if (deltaTWD < 0 && cashTWD < 0) rowIssues.push('這筆換匯後台幣不足，請核對先前的入金。');
      for (const message of rowIssues) issues.push({ id: entry.id, date: entry.date, message });
      trace.push({ entry, deltaUSD, deltaTWD, cashUSD, cashTWD, realized, realizedKnown,
        qtyAfter: affectsShares ? position.qty : null, issues: rowIssues });
    }

    const holdings = [];
    let holdingsCostUSD = 0, marketValueUSD = 0;
    for (const [ticker, { qty, basis }] of positions) {
      if (qty < 0) {
        // An unmatched sale leaves unknown shares and cost outside the recorded holdings.
        holdingsCostUSD = marketValueUSD = null;
        continue;
      }
      if (qty === 0) continue;
      const rawQuote = state.quotes?.[ticker];
      const quote = rawQuote && nonnegative(rawQuote.price) && validDate(rawQuote.date)
        ? { price: Number(rawQuote.price), date: rawQuote.date } : null;
      const positionValue = quote ? qty * quote.price : null;
      holdings.push({ ticker, qty, basis, averageCost: basis === null ? null : basis / qty,
        quote, marketValueUSD: positionValue,
        unrealizedUSD: positionValue !== null && basis !== null ? zeroDust(positionValue - basis) : null });
      holdingsCostUSD = holdingsCostUSD === null || basis === null ? null : holdingsCostUSD + basis;
      marketValueUSD = marketValueUSD === null || positionValue === null ? null : marketValueUSD + positionValue;
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
    // Each account estimate uses the closing wallet, which already includes every net dividend.
    const accountGain = holdingsValue => holdingsValue === null ? null : zeroDust(cashUSD + holdingsValue - netExternalUSD);
    return { trace, cashUSD, cashTWD, holdings, fundingUSD, fundingTWD, netExternalUSD, netDividendsUSD,
      hasShareAdjustments, holdingsCostUSD, marketValueUSD, accountGainAtCostUSD: accountGain(holdingsCostUSD),
      accountGainAtMarketUSD: accountGain(marketValueUSD),
      unrealizedUSD: marketValueUSD === null || holdingsCostUSD === null ? null : zeroDust(marketValueUSD - holdingsCostUSD),
      realized: unknownSales ? null : realizedKnown,
      realizedKnown, unknownSales, issues, loanTrace, loanBalance };
  }

  const api = { calculate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.LedgerEngine = api;
})();
