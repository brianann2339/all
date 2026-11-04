(() => {
  'use strict';
  const channel = 'stock-ledger-local-v1';
  const hash = new URLSearchParams(location.hash.slice(1));
  const transferKey = hash.get('handoff');
  const dashboardURL = window.LedgerSeed.githubUrl;
  // Cross-origin windows can exchange this ledger locally after an explicit click.
  // Only a random session ID goes in the URL.
  if (dashboardURL) {
    let child, nonce, expires, timer;
    function done() { clearTimeout(timer); child = null; }
    function launch(event) {
      if (!event.target.closest('#open-github')) return;
      done();
      const dest = new URL(dashboardURL);
      nonce = crypto.randomUUID();
      expires = Date.now() + 60000;
      dest.hash = new URLSearchParams({handoff:nonce, from:location.origin}).toString();
      child = window.open(dest.href, '_blank');
      const note = document.createElement('span');
      note.setAttribute('role','status');
      note.id = 'github-transfer-info';
      document.getElementById(note.id)?.remove();
      event.target.closest('#open-github').insertAdjacentElement('afterend',note);
      note.textContent = ' 正在開啟 GitHub Pages…';
      timer = setTimeout(() => {
        note.textContent = ' 若新分頁只顯示範例，可在這裡匯出 JSON，再到 GitHub Pages 匯入。';
      },5500);
    }
    document.addEventListener('click', launch);
    window.addEventListener('message',event => {
      const m = event.data;
      if (!child || event.source !== child || event.origin !== new URL(dashboardURL).origin ||
          !m || m.channel !== channel || m.nonce !== nonce || Date.now() > expires) return;
      if (m.action === 'ready') {
        const {entries, loans, referenceCashUSD, referenceDate, title, id} = window.LedgerUI.getState();
        child.postMessage({channel, nonce, action:'import', book:{entries,loans,referenceCashUSD,referenceDate,title,id}},event.origin);
      } else if (m.action === 'complete' || m.action === 'cancel') {
        const note = document.querySelector('#github-transfer-info');
        if (note) note.textContent = m.action === 'complete' ? ' 已在 GitHub Pages 載入。' : ' 已保留 GitHub Pages 目前的帳本。';
        done();
      }
    });
  } else if (transferKey && window.opener) {
    const from = hash.get('from');
    history.replaceState(null,'',location.pathname + location.search);
    let trusted;
    try { trusted = new URL(from); } catch { return; }
    if (trusted.protocol !== 'https:' || trusted.origin !== window.LedgerSeed.trustedImportOrigin ||
        trusted.origin !== from || !/^[a-f0-9-]{36}$/i.test(transferKey)) return;
    const parentWindow = window.opener;
    const send = action => parentWindow.postMessage({channel, nonce:transferKey, action}, trusted.origin);
    function accept(event) {
      const m = event.data;
      if (event.origin !== trusted.origin || event.source !== parentWindow || !m ||
          m.channel !== channel || m.nonce !== transferKey || m.action !== 'import') return;
      window.removeEventListener('message',accept);
      const changed = window.LedgerUI.hasLocalChanges();
      if (changed && !confirm('此裝置的 GitHub 帳本已有紀錄。要用剛開啟的帳本取代嗎？')) { send('cancel'); return; }
      try { window.LedgerUI.importState(m.book); send('complete'); }
      catch { alert('匯入未完成。請在私人帳本匯出 JSON，再於本頁匯入。'); }
    }
    window.addEventListener('message',accept);
    send('ready');
  } else if (transferKey) {
    history.replaceState(null,'',location.pathname + location.search);
    alert('瀏覽器隔離了兩個分頁。請從私人帳本匯出 JSON，再用本頁的匯入功能載入。');
  }
})();
