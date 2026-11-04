(() => {
  'use strict';

  const sheets = window.LedgerOriginal?.sheets;
  const view = document.getElementById('view');
  if (!sheets?.length || !view || document.getElementById('ledger-original')) return;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function address(col, row) {
    if (Number.isInteger(col) && col > 0) {
      let letters = '';
      while (col > 0) {
        col--;
        letters = String.fromCharCode(65 + col % 26) + letters;
        col = Math.floor(col / 26);
      }
      return letters + row;
    }
    const label = String(col || '').toUpperCase();
    return /^[A-Z]+\d+$/.test(label) ? label : label + row;
  }

  const css = el('style', `
    #ledger-original{margin-top:20px;border:1px solid var(--line);border-radius:12px;background:var(--white);padding:0 16px}
    #ledger-original summary{cursor:pointer;padding:12px 0;font-weight:650}
    #ledger-original .original-note{margin-bottom:12px;color:var(--mut);font-size:14px}
    #ledger-original label{display:inline-flex;align-items:center;gap:8px;margin-bottom:12px;font-weight:650}
    #ledger-original select{max-width:65vw;min-height:40px;padding:4px 8px;background:var(--white);border:1px solid var(--line);border-radius:6px}
    #ledger-original .original-count{font-size:13px;color:var(--mut);margin:0 0 8px}
    #ledger-original .original-row{border-top:1px solid var(--line)}
    #ledger-original .original-row summary{font-size:14px;font-weight:550;overflow-wrap:anywhere}
    #ledger-original dl{margin:0 0 12px}
    #ledger-original .original-cell{display:grid;grid-template-columns:minmax(100px,0.8fr) minmax(0,2fr);gap:12px;padding:7px 0;border-top:1px dotted var(--line);overflow-wrap:anywhere}
    #ledger-original dt,#ledger-original dd{margin:0;min-width:0;font-size:14px;white-space:pre-wrap}
    #ledger-original dt{color:var(--mut)}
    #ledger-original code{font-size:12px}
    #ledger-original dt code{margin-right:6px;color:var(--pine)}
    #ledger-original dd small{display:block;color:var(--mut);margin-top:3px}
    @media(max-width:520px){#ledger-original{padding:0 12px}#ledger-original .original-cell{grid-template-columns:minmax(80px,2fr) minmax(0,3fr);gap:8px}}
  `);
  document.head.append(css);

  const source = el('details');
  source.id = 'ledger-original';
  source.append(el('summary', '查看原始試算表紀錄'));
  source.append(el('p', '這裡保留匯入時原表的資料與公式。網頁上的試算與後續編輯只會更新帳本。', 'original-note'));
  const label = el('label', '原表分頁');
  const select = el('select');
  sheets.forEach((sheet, index) => {
    const option = el('option', sheet.title);
    option.value = String(index);
    select.append(option);
  });
  label.append(select);
  const rows = el('div');
  source.append(label, rows);
  view.after(source);

  function showSheet() {
    const sheet = sheets[select.selectedIndex];
    const content = document.createDocumentFragment();
    content.append(el('p', '共 ' + sheet.rows.length + ' 列有內容。點選一列可查看原始儲存格。', 'original-count'));
    for (const row of sheet.rows) {
      const item = el('details', null, 'original-row');
      const firstValue = row.cells[0]?.value;
      const preview = firstValue == null ? '' : String(firstValue).slice(0, 60);
      item.append(el('summary', '第 ' + row.row + ' 列' + (preview ? '　' + preview : '')));
      const list = el('dl');
      for (const cell of row.cells) {
        const line = el('div', null, 'original-cell');
        const key = el('dt');
        key.append(el('code', address(cell.col, row.row)), document.createTextNode(cell.label ?? ''));
        const value = el('dd', cell.value);
        if (cell.formula) {
          const formula = el('small', '公式　');
          formula.append(el('code', cell.formula));
          value.append(formula);
        }
        line.append(key, value);
        list.append(line);
      }
      item.append(list);
      content.append(item);
    }
    rows.replaceChildren(content);
  }

  showSheet();
  select.addEventListener('change', showSheet);
})();
