(() => {
  'use strict';
  const gate = document.getElementById('book-gate');
  const message = document.getElementById('gate-message');
  const payload = JSON.parse(document.getElementById('sealed-book').textContent);
  const storageKey = 'stock-ledger-session-' + payload.iv;
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('k');
  let secret = fromHash;
  if (!secret) {
    try { secret = sessionStorage.getItem(storageKey); } catch {}
  }
  if (!secret) {
    message.textContent = '請從對話開啟完整的專屬連結，即可載入這本帳。';
    return;
  }
  const bytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.body.append(script);
  });
  async function open() {
    let book;
    try {
      if (!/^[a-zA-Z0-9_-]{43}$/.test(secret)) throw Error();
      const key = await crypto.subtle.importKey('raw', bytes(secret), 'AES-GCM', false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:bytes(payload.iv)}, key, bytes(payload.data));
      book = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      message.textContent = '這個連結無法解鎖帳本。請重新點開對話中的完整連結。';
      return;
    }
    try { sessionStorage.setItem(storageKey, secret); } catch {}
    window.LedgerSeed = book.ledger;
    window.LedgerOriginal = book.original;
    const layout = document.getElementById('book-layout');
    document.body.insertBefore(layout.content.cloneNode(true), gate);
    try {
      await load('./app.js?v=cash2');
      await load('./source-view.js');
      gate.remove();
    } catch {
      message.textContent = '網頁有部分內容未能載入。請重新整理。';
    }
  }
  open();
})();
