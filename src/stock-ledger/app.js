(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const labels={funding:'投入資金',fx:'台幣換美元',buy:'買入',sell:'賣出',dividend:'現金股息',cash:'美元收支',adjustment:'補登股數'};
const seed=window.LedgerSeed || {id:'empty',entries:[],loans:[]};
const key='cash-ledger-v1-'+String(seed.id||'default');
const clone=x=>JSON.parse(JSON.stringify(x));
const nf=(x,min=0,max=2)=>Number(x).toLocaleString('en-US',{minimumFractionDigits:min,maximumFractionDigits:max});
const usd=(v,d=2)=>(v<0?'−':'')+'US$'+nf(Math.abs(v),2,d);
const exactUSD=v=>usd(v,6), twd=v=>(v<0?'−':'')+'NT$'+nf(Math.abs(v),0,4), qty=v=>nf(v,0,8);
const signed=(v,fn)=>v===0 ? fn(0) : (v>0?'+':'−')+fn(Math.abs(v));
const dateOk=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const missing=v=>v===''||v==null;
const moneyTone=v=>v>0?'positive':v<0?'negative':'';
const uid=()=>globalThis.crypto?.randomUUID?.() || 'r'+Date.now().toString(36)+Math.random().toString(36).slice(2);
const isoToday=()=>new Date().toLocaleDateString('sv-SE');
const schema={funding:['twd','usd'],fx:['twd','usd'],buy:['ticker','qty','price','fee','gross'],sell:['ticker','qty','price','fee','gross'],dividend:['ticker','amount','tax','fee'],cash:['usd'],adjustment:['ticker','qty','basis']};
const nonnegativeFields=['fee','basis','tax','repay','borrow'];
function validSymbol(s){
 return /^[A-Z][A-Z0-9]{0,5}([.-][A-Z0-9]{1,4})?$/.test(s)&&!(/\.(TW|TWO|HK|TO|V|T|L|AX|KS|KQ|SS|SZ|DE|PA|F|SW)$/.test(s));
}
const cleanName=s=>String(s||'').trim().slice(0,100);
let tab='invest', filter='money', exampleId='', saveFailed=false, timer;
function normalize(raw){
 if(!raw || !Array.isArray(raw.entries)||!Array.isArray(raw.loans)||raw.entries.length+raw.loans.length>20000)throw Error('請選擇資金手帳匯出的 JSON 檔。');
 const ids=new Set();
 function row(e,loan){
  if(!e||typeof e!=='object'||!dateOk(e.date))throw Error('紀錄的日期格式不正確。');
  if(!loan&&!Object.hasOwn(schema,e.type))throw Error('檔案包含未支援的交易類型。');
  const id=String(e.id??uid()); if(ids.has(id))throw Error('檔案中有重複的紀錄代碼。');ids.add(id);
  const out={id,date:e.date,note:String(e.note||'').slice(0,2000)};
  if(!loan){out.type=e.type;if(e.source)out.source=String(e.source).trim().slice(0,180);}
  if(!loan&&['buy','sell','dividend'].includes(e.type)){
   if((e.currency&&e.currency!=='USD')||(e.market&&e.market!=='US'))throw Error('美股買賣與股息請以美元登記。');
   out.market='US';out.currency='USD';
  }
  if(e.status==='pending')out.status='pending';
  const keys=loan?['borrow','repay']:schema[e.type];
  for(const name of keys){
   if(name==='ticker'){
    out.ticker=String(e.ticker||'').trim().toUpperCase();if(!validSymbol(out.ticker))throw Error('請輸入美國上市股票或 ETF 的美元交易代號。');
    const savedName=cleanName(e.stockName)||cleanName(Object.hasOwn(seed.stockNames||{},out.ticker)?seed.stockNames[out.ticker]:'');
    if(savedName)out.stockName=savedName;continue;
   }
   const opt=loan||e.type==='funding'||['fee','tax','gross','basis'].includes(name);
   if(missing(e[name])){if(!opt)throw Error('請填妥必要的金額和股數。');if(name==='basis')out.basis=null;continue;}
   const n=Number(e[name]); if(!Number.isFinite(n)|| (name==='usd'&&e.type==='cash'?n===0:e.type==='funding'||nonnegativeFields.includes(name)?n<0:n<=0))throw Error('請檢查金額與股數。');
   out[name]=n;
  }
  if(loan&&!(out.borrow>0||out.repay>0))throw Error('請填寫借款或還款金額。');
  if(out.type==='funding'&&!(out.usd>0||out.twd>0))throw Error('美元或台幣至少填入一筆大於零的投入金額。');
  if(out.type==='dividend'&&(out.tax||0)+(out.fee||0)>out.amount)throw Error('預扣稅與費用合計不可超過稅前股息。');
  return out;
 }
 const next={id:String(raw.id||seed.id||'default').slice(0,120),title:String(raw.title||'').slice(0,100),entries:raw.entries.map(e=>row(e,false)),loans:raw.loans.map(e=>row(e,true))};
 next.quotes=Object.create(null);
 for(const [ticker,q] of Object.entries(raw.quotes||{})){
  if(!validSymbol(ticker)||!q||missing(q.price)||!Number.isFinite(Number(q.price))||Number(q.price)<0||!dateOk(q.date))throw Error('請檢查現價的美股代號、金額和報價日期。');
  next.quotes[ticker]={price:Number(q.price),date:q.date};
  if(q.source){
   try{const url=new URL(q.source);if(url.protocol==='https:'&&!url.username&&!url.password)next.quotes[ticker].source=url.href;}catch{}
  }
 }
 if(raw.reconciliationNote)next.reconciliationNote=String(raw.reconciliationNote).slice(0,2000);
 if(!missing(raw.referenceCashUSD)&&Number.isFinite(Number(raw.referenceCashUSD))){
  next.referenceCashUSD=Number(raw.referenceCashUSD);
  if(dateOk(raw.referenceDate))next.referenceDate=raw.referenceDate;
 }
 return next;
}
function applySeedCorrection(book){
 const correction=seed.seedCorrection;
 if(!correction||book.id!==seed.id)return false;
 const {primaryId,previousEntries,previousReconciliationNote}=correction;
 const latest=new Map(seed.entries.map(e=>[e.id,e]));
 const fx=latest.get(primaryId);
 if(fx?.type!=='fx'||!Array.isArray(previousEntries))return false;
 const originals=previousEntries.filter(e=>e.id===primaryId);
 const sameTerms=(a,b)=>a.type===b.type&&a.date===b.date&&a.status===b.status&&
  schema[a.type].every(k=>(a[k]??null)===(b[k]??null));
 const unchanged=(a,b)=>a.id===b.id&&sameTerms(a,b)&&a.note===(b.note||'')&&(!a.source||a.source===b.source);
 const index=book.entries.findIndex(e=>e.id===primaryId);
 const local=book.entries[index];
 const needsUpdate=local&&originals.some(old=>unchanged(local,old));
 // An account holder may already have entered the missing credit in another row.
 const historic=new Map(latest);
 previousEntries.forEach(e=>historic.set(e.id,e));
 const existingCredit=book.entries.find(row=>{
  if(row.id===primaryId||row.status==='pending'||!['fx','cash'].includes(row.type))return false;
  if(seed.referenceDate&&row.date>seed.referenceDate)return false;
  const old=historic.get(row.id);
  const oldUSD=old&&old.status!=='pending'&&['fx','cash'].includes(old.type)?old.usd:0;
  return Math.abs(row.usd-oldUSD-fx.usd)<1e-8;
 });
 const wasFX=existingCredit&&historic.get(existingCredit.id);
 const oldTWD=wasFX?.type==='fx'&&wasFX.status!=='pending'?wasFX.twd:0;
 const alreadyExchanged=existingCredit?.type==='fx'&&Math.abs(existingCredit.twd-oldTWD-fx.twd)<1e-8;
 const hasCorrectFX=local?.type==='fx'&&local.status!=='pending'&&local.twd===fx.twd&&local.usd===fx.usd;
 const canReplace=needsUpdate&&!existingCredit;
 const useExisting=alreadyExchanged&&(!local||needsUpdate);
 const customNote=book.reconciliationNote&&book.reconciliationNote!==previousReconciliationNote&&book.reconciliationNote!==seed.reconciliationNote;
 if(!hasCorrectFX&&!canReplace&&!useExisting){
  if(customNote)return false;
  book.reconciliationNote='這台裝置的交易紀錄已修改，請核對已登記的換匯與美元入帳是否為同一筆。';
  return true;
 }
 if(needsUpdate){
  if(alreadyExchanged)book.entries.splice(index,1);
  else book.entries[index]=clone(fx);
 }
 for(const row of book.entries){
  if(row.id===primaryId)continue;
  const prior=previousEntries.find(e=>unchanged(row,e));
  const current=latest.get(row.id);
  if(prior&&current){row.note=current.note||'';if(current.source)row.source=current.source;}
 }
 if(!customNote)book.reconciliationNote=seed.reconciliationNote;
 return !!needsUpdate;
}
let state=normalize(seed), data;
try{const stored=localStorage.getItem(key);if(stored){
 const raw=JSON.parse(stored);
 if(raw.id===seed.id&&!Object.hasOwn(raw,'quotes')&&seed.quotes)raw.quotes=seed.quotes;
 const saved=normalize(raw);
 const revised=applySeedCorrection(saved);
 if (saved.id===seed.id && Array.isArray(saved.entries)) {
  if(!saved.reconciliationNote && seed.reconciliationNote)saved.reconciliationNote=seed.reconciliationNote;
  const initial=new Map(seed.entries.map(e=>[e.id,e]));
  for(const e of saved.entries){
   const original=initial.get(e.id);
   if(!Object.hasOwn(e,'source') && original?.source && e.type===original.type && e.date===original.date && e.ticker===original.ticker )e.source=original.source;
  }
 }
 state=normalize(saved);
 if(revised)save();
}}catch(e){saveFailed=true;}
function save(){try{localStorage.setItem(key,JSON.stringify(state));saveFailed=false;}catch(e){saveFailed=true;}}
function toast(s){$('toast').textContent=s;clearTimeout(timer);timer=setTimeout(()=>$('toast').textContent='',3600);}
function displayStatus(){$('save-status').textContent=saveFailed?'此瀏覽器未能儲存':'儲存在此裝置';}
function replaceState(raw){const next=normalize(raw);applySeedCorrection(next);state=normalize(next);save();tab='invest';filter='money';exampleId='';if($('panel').open)$('panel').close();render();}
window.LedgerUI={getState:()=>clone(state),importState:replaceState,hasLocalChanges:()=>JSON.stringify(state)!==JSON.stringify(normalize(seed))};
function badge(type){return '<span class="pill '+esc(type)+'">'+esc(labels[type]||type)+'</span>';}
function card(label,value,desc,sym,dark=false,extra=''){return '<article class="card'+(dark?' dark':'')+'"><div class="card-top"><span class="sym" aria-hidden="true">'+sym+'</span><h2>'+label+'</h2></div><div class="big">'+esc(value)+'</div><p>'+esc(desc)+'</p>'+extra+'</article>';}
function cell(v,label,cls=''){return '<span class="num '+cls+'"><span class="mobile-label">'+esc(label)+'</span>'+esc(v)+'</span>';}
function detailLines(pairs){return '<div class="detail-grid">'+pairs.map(([a,b])=>'<div><span>'+esc(a)+'</span><b>'+esc(b)+'</b></div>').join('')+'</div>';}
const noRows='<div class="empty">目前沒有紀錄。</div>';
function latestDate(rows){return rows.length?rows[rows.length-1].entry.date:'尚無紀錄';}
function stockName(ticker){
 if(!ticker)return '';
 const record=state.entries.findLast(e=>e.ticker===ticker&&e.stockName);
 return record?.stockName||'';
}
function stockCaption(e){return [e.ticker,e.stockName||stockName(e.ticker)].filter(Boolean).join(' · ');}
function cashRoute(e){
 const recorded=e.source?.trim();
 let route;
 switch(e.type){
  case 'funding': return recorded||e.note||'自外部投入資金，來源未填';
  case 'fx': route='台幣現金 → 換成美元現金'; break;
  case 'buy': route='美元現金 → 買入 '+e.ticker+' '+qty(e.qty)+' 股'; break;
  case 'sell': route='賣出 '+e.ticker+' '+qty(e.qty)+' 股 → 美元現金'; break;
  case 'dividend': route=e.ticker+' 發放現金股息 → 美元現金'; break;
  case 'adjustment': route='補登 '+e.ticker+' '+qty(e.qty)+' 股，只有股數變動'; break;
  case 'cash': return recorded||(e.status==='pending'?'美元差額，來源待查':e.note||(e.usd>0?'外部美元入帳，來源未填':'美元現金支出，去向未填'));
  default: return recorded||'';
 }
 return recorded||route;
}
function amounts(rows,type,currency){
 return rows.filter(r=>r.entry.type===type).reduce((total,r)=>total+r[currency],0);
}
function wallet(title,amount,items,format,dark){
 const parts=items.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+signed(value,format)+'</dd></div>').join('');
 return '<article class="wallet'+(dark?' wallet-us':'')+'"><h2>'+title+'</h2><b class="wallet-total">'+format(amount)+'</b><dl>'+parts+'</dl></article>';
}
function equation(prev,delta,total,fmt){
 return fmt(prev)+(delta<0?' − ':' + ')+fmt(Math.abs(delta))+' = '+fmt(total);
}
const isTrade=e=>e.type==='buy'||e.type==='sell';
const tradeGross=e=>e.gross??e.qty*e.price;
const tradeShares=n=>nf(n,0,20);
const tradePrice=n=>usd(n,12);
function tradeTerms(e){
 const terms=tradeShares(e.qty)+' 股，每股 '+tradePrice(e.price)+'，成交總額 '+exactUSD(tradeGross(e));
 return e.fee?terms+'，手續費 '+exactUSD(e.fee):terms;
}
function tradeHistoryRows(trades,ticker=''){
 return trades.filter(e=>!ticker||e.ticker===ticker).map(e=>
  '<tr><th scope="row"><b>'+esc(e.ticker)+'</b> '+badge(e.type)+'<small>'+esc(e.stockName||stockName(e.ticker))+'</small><small>'+esc(e.date)+'</small></th>'+
  '<td data-label="股數">'+tradeShares(e.qty)+'</td><td data-label="每股成交價">'+tradePrice(e.price)+'</td>'+
  '<td data-label="成交總額">'+exactUSD(tradeGross(e))+(e.fee?'<small>手續費 '+exactUSD(e.fee)+'</small>':'')+'</td></tr>'
 ).join('');
}
function confirmedTrades(){
 return data.trace.map(r=>r.entry).filter(e=>isTrade(e)&&e.status!=='pending').reverse();
}
function dividendsFor(ticker){
 const rows=data.trace.filter(r=>r.entry.type==='dividend'&&r.entry.status!=='pending'&&(!ticker||r.entry.ticker===ticker));
 return rows.length?'已登記實收股息 '+usd(amounts(rows,'dividend','deltaUSD'))+'（'+rows.length+' 筆）':'尚未登記'+(ticker?'這檔股票的':'')+'股息';
}
function stockPanel(){
 const trades=confirmedTrades();
 const lastBuys=new Map();
 for(const e of trades)if(e.type==='buy'&&!lastBuys.has(e.ticker))lastBuys.set(e.ticker,e);
 let h='<section class="box space stock-book"><div class="section-head"><h2>持股與買進成本</h2><small>金額單位為美元</small></div>';
 h+=data.holdings.length?data.holdings.map(p=>{
  const buy=lastBuys.get(p.ticker);
  return '<article class="stock-position"><div class="stock-name"><h3>'+esc(p.ticker)+'</h3><small>'+esc(stockName(p.ticker))+'</small><b>'+qty(p.qty)+' 股</b></div>'+
   '<dl><div><dt>平均每股成本</dt><dd>'+(p.averageCost==null?'待確認':exactUSD(p.averageCost))+'</dd></div>'+
   '<div><dt>最近買進單價</dt><dd>'+(buy?tradePrice(buy.price)+'<small>'+esc(buy.date)+'</small>':'尚無買入紀錄')+'</dd></div>'+
   '<div><dt>持股總成本</dt><dd>'+(p.basis==null?'待確認':exactUSD(p.basis))+'</dd></div></dl>'+
   '<div class="quote-line"><span>'+(p.quote?'每股參考價 '+esc(tradePrice(p.quote.price))+'（'+esc(p.quote.date)+'）':'尚未填寫每股現價')+
   (state.quotes[p.ticker]?.source?' <a href="'+esc(state.quotes[p.ticker].source)+'" target="_blank" rel="noopener noreferrer">報價來源</a>':'')+
   (p.unrealizedUSD!=null?'　未實現損益 '+esc(signed(p.unrealizedUSD,usd)):'')+'</span><button type="button" class="secondary" data-quote="'+esc(p.ticker)+'">'+(p.quote?'更新現價':'填寫現價')+'</button></div></article>';
 }).join(''):'<p class="fine">目前沒有持股。</p>';
 if(data.holdings.length)h+='<p class="fine">平均每股成本＝剩餘持股總成本 ÷ 股數，包含已登記的買入手續費。</p>';
 if(trades.length){
  const tickers=[...new Set(trades.map(e=>e.ticker))].sort();
  h+='<details class="trade-history"'+(trades.length<=12?' open':'')+'><summary>查每筆買賣的股數與價格 <small>'+trades.length+' 筆成交</small></summary>'+
   '<div class="trade-tools"><label>股票代號 <select id="trade-ticker"><option value="">全部股票</option>'+
   tickers.map(t=>'<option value="'+esc(t)+'">'+esc(stockCaption({ticker:t}))+'</option>').join('')+'</select></label><small>由新到舊，含已賣出的股票</small></div>'+
   '<table aria-label="買賣成交紀錄"><thead><tr><th scope="col">股票／日期</th><th scope="col">股數</th><th scope="col">每股成交價</th><th scope="col">成交總額</th></tr></thead>'+
   '<tbody id="trade-records">'+tradeHistoryRows(trades)+'</tbody></table><p class="fine" id="symbol-dividends">'+esc(dividendsFor(''))+'</p></details>';
 }
 return h+'</section>';
}
function saleTrial(r,price){
 const e=r.entry, proceeds=e.qty*price-(e.fee||0);
 const result=r.cashUSD-r.deltaUSD+proceeds;
 const profit=r.realized==null?'獲利等成本補齊後才能計算。':'這筆損益為 '+signed(proceeds-(r.deltaUSD-r.realized),exactUSD)+'。';
 return '賣出淨收款 '+exactUSD(proceeds)+'。當天賣完會剩 '+exactUSD(result)+'、'+twd(r.cashTWD)+'。'+profit;
}
function exampleCalculation(r){
 if(!r)return '';
 const e=r.entry, beforeUSD=r.cashUSD-r.deltaUSD, beforeTWD=r.cashTWD-r.deltaTWD;
 const text=[cashRoute(e)];
 if(isTrade(e))text.push(tradeTerms(e)+'。');
 if(e.status==='pending')text.push('尚待確認，這筆暫未計入現金。');
 else if(e.type==='sell'&&r.realized!=null){
  const cost=r.deltaUSD-r.realized;
  text.push('賣出淨收款 '+exactUSD(r.deltaUSD)+' ＝ 成本 '+exactUSD(cost)+(r.realized<0?' − 虧損 ':' ＋ 獲利 ')+exactUSD(Math.abs(r.realized))+'。全額回到美元現金。');
 }else if(e.type==='sell')text.push('賣出淨收款 '+exactUSD(r.deltaUSD)+' 全額回到美元現金。賣出的股數或成本還需補齊，這筆獲利待確認。');
 else if(e.type==='buy')text.push('這次買入用掉 '+exactUSD(-r.deltaUSD)+'，已含登記的費用。');
 else if(e.type==='fx')text.push('這次換出 '+twd(e.twd)+'，收到 '+exactUSD(e.usd)+'。');
 else if(e.type==='funding')text.push('這筆投入的 '+[r.deltaUSD?exactUSD(r.deltaUSD):'',r.deltaTWD?twd(r.deltaTWD):''].filter(Boolean).join('、')+' 直接存入各自的現金餘額。');
 else if(e.type==='dividend')text.push('稅前股息 '+exactUSD(e.amount)+' 減去預扣稅 '+exactUSD(e.tax||0)+'、費用 '+exactUSD(e.fee||0)+'，實收 '+exactUSD(r.deltaUSD)+'。');
 else if(e.type==='adjustment')text.push('這筆補記持股。如果當時另有付錢，請依成交單改登買入。');
 if(r.cashUSD<-.000001&&r.deltaUSD<0)text.push('扣款後少了 '+exactUSD(-r.cashUSD)+'。請核對更早的入金、換匯或交易金額。');
 const saleControl=e.type==='sell'&&e.status!=='pending'?'<details class="trial"><summary>換個賣價試算</summary><label>假設每股賣價（美元）<input type="number" min="0" step="any" inputmode="decimal" id="trial-price" placeholder="'+esc(qty(e.price))+'"></label><p id="trial-result" aria-live="polite">沿用 '+esc(qty(e.qty))+' 股與原手續費，只試算這筆交易。</p></details>':'';
 return '<div class="worked-copy">'+text.map(t=>'<p>'+esc(t)+'</p>').join('')+'</div><dl class="worked-math"><div><dt>台幣</dt><dd>'+esc(equation(beforeTWD,r.deltaTWD,r.cashTWD,twd))+'</dd></div><div><dt>美元</dt><dd>'+esc(equation(beforeUSD,r.deltaUSD,r.cashUSD,exactUSD))+'</dd></div></dl>'+saleControl;
}
function examplePanel(){
 if(!data.trace.length)return '';
 const r=data.trace.find(t=>t.entry.id===exampleId)||data.trace.find(t=>t.entry.type==='sell'&&t.realized!=null)||data.trace[0];
 const options=data.trace.map(t=>{
  const e=t.entry;
  return '<option value="'+esc(e.id)+'"'+(r===t?' selected':'')+'>'+esc(e.date+'　'+(labels[e.type]||'')+(e.ticker?' '+stockCaption(e):''))+'</option>';
 }).join('');
 return '<section class="worked"><div class="worked-top"><h2>挑一筆算給我看</h2><select id="example-transaction" aria-label="選一筆交易看計算">'+options+'</select></div><div id="example-result" aria-live="polite">'+exampleCalculation(r)+'</div></section>';
}
function trailRow(r){
 const e=r.entry;
 const change=(delta,fmt)=>delta===0?'無變動':signed(delta,fmt);
 const column=(unit,delta,total,fmt)=>'<span class="wallet-cell"><span>'+unit+'增減</span><b class="'+moneyTone(delta)+'">'+change(delta,fmt)+'</b><span>剩下</span><strong>'+fmt(total)+'</strong></span>';
 let extra='';
 if(e.status==='pending')extra='待核對 '+(e.type==='cash'?signed(e.usd,exactUSD):'')+'，暫未計入。';
 else if(r.cashUSD<-.000001&&r.deltaUSD<0)extra='這筆付款後短少 '+exactUSD(-r.cashUSD)+'。';
 else if(e.type==='sell')extra=r.realized==null?'賣出收款已計入，獲利待確認。':'收回成本 '+exactUSD(r.deltaUSD-r.realized)+'，'+(r.realized<0?'虧損 ':'獲利 ')+exactUSD(Math.abs(r.realized))+'。';
 const terms=isTrade(e)?'<b class="trade-terms">'+esc(tradeTerms(e))+'</b>':e.type==='dividend'?'<b class="trade-terms">稅前 '+exactUSD(e.amount)+'，預扣稅 '+exactUSD(e.tax||0)+'，費用 '+exactUSD(e.fee||0)+'</b>':'';
 return '<button class="cash-row" data-entry="'+esc(e.id)+'"><span class="flow-id"><small>'+esc(e.date)+'</small><span>'+badge(e.type)+(e.ticker?' <b>'+esc(e.ticker)+'</b>':'')+'</span></span><span class="flow-route">'+terms+esc(cashRoute(e))+(extra?'<small>'+esc(extra)+'</small>':'')+'</span>'+column('台幣',r.deltaTWD,r.cashTWD,twd)+column('美元',r.deltaUSD,r.cashUSD,exactUSD)+'</button>';
}
function contributionPanel(rows){
 const funding=rows.filter(r=>r.entry.type==='funding'&&(r.deltaTWD>0||r.deltaUSD>0));
 const first=funding[0]?.entry.date;
 const opening=funding.filter(r=>r.entry.date===first);
 const firstUSD=amounts(opening,'funding','deltaUSD'), firstTWD=amounts(opening,'funding','deltaTWD');
 const line=(title,u,t)=>'<div><dt>'+esc(title)+'</dt><dd>'+usd(u)+'<span>／</span>'+twd(t)+'</dd></div>';
 return '<section class="box contributions"><h2>投入本金</h2><dl>'+
  line('初始投入'+(first?'（'+first+'）':''),firstUSD,firstTWD)+
  line('後續加碼',data.fundingUSD-firstUSD,data.fundingTWD-firstTWD)+
  line('累計投入',data.fundingUSD,data.fundingTWD)+'</dl><p class="fine">換匯是兩種現金之間的轉換。這裡只加總從外部投入的本金。</p></section>';
}
function profitPanel(){
 const missingPrices=data.holdings.filter(p=>!p.quote);
 const priced=data.accountGainAtMarketUSD!=null;
 const dates=[...new Set(data.holdings.filter(p=>p.quote).map(p=>p.quote.date))].sort();
 const quoteDate=dates.length>1?dates[0]+' 至 '+dates.at(-1):dates[0];
 const caption=priced?(quoteDate?'依 '+quoteDate+' 的參考價估算':'依已登記的美元現金計算'):missingPrices.length?'請填寫 '+missingPrices.map(p=>p.ticker).join('、')+' 的現價':'請先核對持股數量';
 const measure=(label,value)=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>';
 const confirmedLabel=data.unknownSales?'已能核算的賣出損益':'已實現買賣損益';
 return '<section class="profit-box"><div class="profit-head"><div><h2>目前獲利共</h2><strong>'+esc(priced?signed(data.accountGainAtMarketUSD,usd):missingPrices.length?'等待持股現價':'持股待核對')+'</strong><p>'+esc(caption)+'</p></div>'+
  (data.holdings.length?'<button type="button" class="secondary" data-quote="'+esc(missingPrices[0]?.ticker||data.holdings[0].ticker)+'">填寫／更新現價</button>':'')+'</div>'+
  '<p class="profit-equation">美元現金 '+exactUSD(data.cashUSD)+' ＋ 持股市值 '+(data.marketValueUSD==null?'（待估值）':exactUSD(data.marketValueUSD))+' − 美元淨投入 '+exactUSD(data.netExternalUSD)+(priced?' ≈ '+signed(data.accountGainAtMarketUSD,usd):'')+'</p>'+
  '<p class="profit-label">已核算項目</p><dl class="profit-parts">'+measure(confirmedLabel,signed(data.realizedKnown,usd))+measure('已登記實收股息',usd(data.netDividendsUSD))+measure('持股未實現損益',data.unrealizedUSD==null?'待補齊現價或成本':signed(data.unrealizedUSD,usd))+'</dl>'+
  '<details class="profit-explain"><summary>計算說明</summary><p>美元淨投入包括直接投入、換得的美元及其他外部美元收支。實收股息已進入美元現金，只計一次。</p>'+
  (data.accountGainAtCostUSD!=null?'<p>若持股一律按成本估值，帳面差額為 '+signed(data.accountGainAtCostUSD,usd)+'。</p>':'')+'</details>'+
  (data.unknownSales||data.hasShareAdjustments?'<p class="profit-note">'+(data.unknownSales?data.unknownSales+' 筆賣出的零股成本待補。':'')+'總額依已登記的資金與股數估算。若補登的股票另有出資，請補記來源。</p>':'')+'</section>';
}
function portfolio(){
 const rows=data.trace;
 const usdItems=[['直接投入的美元',data.fundingUSD],['台幣換得的美元',amounts(rows,'fx','deltaUSD')],['賣股票收回（含本金）',amounts(rows,'sell','deltaUSD')],['買股票付出',amounts(rows,'buy','deltaUSD')],['實收現金股息',data.netDividendsUSD]];
 const cashRows=rows.filter(r=>r.entry.type==='cash');
 const inUSD=cashRows.reduce((sum,r)=>sum+Math.max(0,r.deltaUSD),0);
 const outUSD=cashRows.reduce((sum,r)=>sum+Math.min(0,r.deltaUSD),0);
 if(inUSD)usdItems.push(['其他美元收入',inUSD]);if(outUSD)usdItems.push(['其他美元支出',outUSD]);
 let h='<nav class="entry-shortcuts" aria-label="快速登記">'+[['funding','投入資金'],['buy','買入美股'],['sell','賣出美股'],['dividend','登記股息']].map(([type,name])=>'<button class="secondary" type="button" data-new="'+type+'">＋ '+name+'</button>').join('')+'</nav>';
 h+='<div class="wallets">'+wallet('結餘美元',data.cashUSD,usdItems,exactUSD,true)+wallet('結餘台幣',data.cashTWD,[['投入的台幣',data.fundingTWD],['換成美元用掉',amounts(rows,'fx','deltaTWD')]],twd,false)+'</div>';
 h+=profitPanel()+contributionPanel(rows)+stockPanel()+examplePanel();
 const hasRef=state.referenceCashUSD!=null;
 const cutoff=hasRef&&state.referenceDate?state.referenceDate:null;
 const asof=cutoff?data.trace.filter(r=>r.entry.date<=cutoff):data.trace;
 const actual=asof.length?asof[asof.length-1].cashUSD:0;
 const pending=asof.filter(r=>r.entry.type==='cash'&&r.entry.status==='pending');
 const traceIssues=data.trace.filter(r=>r.issues?.length);
 if(hasRef||traceIssues.length){
  h+='<section class="review" aria-label="帳目核對"><div class="review-head"><h2>帳目核對</h2>'+(cutoff?'<small>'+esc(cutoff)+'</small>':'')+'</div>';
  if(hasRef){
   const diff=+(state.referenceCashUSD-actual).toFixed(6);
   h+='<div class="compare"><div><span>原表美元餘額</span><b>'+usd(state.referenceCashUSD)+'</b></div><div><span>依流水帳重算</span><b>'+usd(actual)+'</b></div><div><span>'+(Math.abs(diff)<.005?'餘額相符':diff>0?'原表多出':'原表少了')+'</span><b>'+usd(Math.abs(diff))+'</b></div></div>';
  }
  if(state.reconciliationNote)h+='<p class="ref-note">'+esc(state.reconciliationNote)+'</p>';
  if(pending.length){
   h+='<div class="whatif">'+pending.map(r=>'<label><input type="checkbox" data-scenario="'+esc(r.entry.id)+'"> 假設這筆是額外美元入帳 <strong>'+signed(r.entry.usd,usd)+'</strong>'+(pending.length>1?'（'+esc(r.entry.date)+'）':'')+'</label>').join('')+'<p id="scenario-result" aria-live="polite">勾選可查看試算餘額，帳本會保留原值。</p></div>';
  }
  if(traceIssues.length)h+='<details class="reconcile"><summary>查看待核對的紀錄</summary><ul>'+traceIssues.map(r=>'<li>'+esc(r.entry.date+' '+(r.entry.ticker||labels[r.entry.type])+'：'+r.issues.join('；'))+'</li>').join('')+'</ul></details>';
  h+='</section>';
 }
 h+='<section class="box ledger space"><div class="ledger-tools"><div><h2>現金流水帳</h2><p>從第一筆開始，看每筆之後還有多少現金。點選可看金額與來源。</p></div><select id="filter" aria-label="篩選交易類型"><option value="money"'+(filter==='money'?' selected':'')+'>只看現金往來</option><option value="all"'+(filter==='all'?' selected':'')+'>全部紀錄（含待核對、股數調整）</option>'+Object.entries(labels).map(([v,t])=>'<option value="'+v+'"'+(filter===v?' selected':'')+'>'+t+'</option>').join('')+'</select></div>';
 const visible=rows.filter(r=>filter==='money'?r.deltaUSD!==0||r.deltaTWD!==0:filter==='all'||r.entry.type===filter);
 h+=(visible.map(trailRow).join('')||noRows)+'</section>';
 return h;
}
function loanView(){
 const borrowed=state.loans.reduce((a,e)=>a+(e.borrow||0),0),paid=state.loans.reduce((a,e)=>a+(e.repay||0),0);
 let h='<div class="cards">'+card('目前尚欠',twd(data.loanBalance),'截至最近一筆借還款','元',true)+card('累計借入',twd(borrowed),'所有借款的合計','入')+card('累計已還',twd(paid),'所有還款的合計','還')+'</div>';
 h+='<section class="box ledger space"><div class="ledger-tools"><div><h2>借還款紀錄</h2><p>這裡記錄家人之間的借債。若借款真的匯入投資帳戶，請在投資帳本另登台幣入金。</p></div></div><div class="ledger-cols loan-cols" aria-hidden="true"><span>日期</span><span class="right">借入</span><span class="right">已還</span><span class="right">尚欠</span><span></span></div>';
 h+=data.loanTrace.slice().reverse().map(r=>'<button class="ledger-row loan-row" data-loan="'+esc(r.entry.id)+'"><span class="row-date">'+esc(r.entry.date)+'</span>'+cell(twd(r.entry.borrow||0),'借入')+cell(twd(r.entry.repay||0),'已還')+cell(twd(r.balance),'尚欠',r.balance<0?'negative':'')+'<span class="chev" aria-hidden="true">›</span></button>').join('')||noRows;
 return h+'</section>';
}
function render(){
 data=LedgerEngine.calculate(state); const invest=tab==='invest';
 $('invest-tab').setAttribute('aria-pressed',String(invest));$('loans-tab').setAttribute('aria-pressed',String(!invest));$('invest-tab').classList.toggle('on',invest);$('loans-tab').classList.toggle('on',!invest);
 $('page-title').textContent=invest?'美股投資帳本':'家人借還款';
 $('intro-desc').textContent=(state.title?state.title+'　·　':'')+'記錄至 '+latestDate(invest?data.trace:data.loanTrace);
 $('add-label').textContent=invest?'新增交易':'新增借還款';displayStatus();
 $('view').innerHTML=invest?portfolio():loanView();
}
function modal(title,html){$('dialog-title').textContent=title;$('panel-body').innerHTML=html;if(!$('panel').open)$('panel').showModal();$('panel').scrollTop=0;}
function actions(id,loan){return '<div class="actions"><button class="danger" data-del="'+esc(id)+'">刪除這筆</button><button class="primary" data-edit="'+esc(id)+'">編輯'+(loan?'借還款':'交易')+'</button></div>';}
function detail(id,loan=false){
 const r=(loan?data.loanTrace:data.trace).find(r=>r.entry.id===id);if(!r)return;const e=r.entry;
 let h='<div class="detail-meta">'+esc(e.date)+(loan?'':badge(e.type))+'</div>';
 if(loan){
  h+=detailLines([['上一筆尚欠',twd(r.balance-(e.borrow||0)+(e.repay||0))],['本次借入',twd(e.borrow||0)],['本次還款',twd(e.repay||0)],['交易後尚欠',twd(r.balance)]]);
 }else{
  h+='<p class="route-detail">'+esc(cashRoute(e))+'</p>';
  if(e.type==='buy'||e.type==='sell'){
   h+=detailLines([['成交股數',tradeShares(e.qty)+' 股'],['每股成交價',tradePrice(e.price)],['成交總額',exactUSD(tradeGross(e))],['手續費',exactUSD(e.fee||0)]]);
  }
  if(e.type==='dividend')h+=detailLines([['稅前股息',exactUSD(e.amount)],['預扣稅',exactUSD(e.tax||0)],['費用',exactUSD(e.fee||0)],['稅後入帳',e.status==='pending'?'待入帳':exactUSD(r.deltaUSD)]]);
  if(e.type==='adjustment')h+=detailLines([['增加股數',qty(e.qty)+' 股'],['新增持股成本',e.basis==null?'待確認':usd(e.basis,6)]]);
  h+=detailLines([['原有台幣',twd(r.cashTWD-r.deltaTWD)],['台幣增減',signed(r.deltaTWD,twd)],['剩餘台幣',twd(r.cashTWD)]]);
  h+=detailLines([['原有美元',usd(r.cashUSD-r.deltaUSD,6)],['這筆美元增減',signed(r.deltaUSD,n=>usd(n,6))],['交易後美元餘額',usd(r.cashUSD,6)],...(e.ticker&&r.qtyAfter!=null?[['交易後持股',qty(r.qtyAfter)+' 股']]:[])]);
  if(e.type==='sell'){
   if(e.status==='pending')h+='<p class="fine">這筆交易暫未計入。</p>';
   else if(r.realized==null)h+='<p class="fine">賣出款已計入現金。請補齊額外股數的取得紀錄與成本，再確認這筆獲利。</p>';
   else h+=detailLines([['賣出淨收款',usd(r.deltaUSD,6)],['賣出股數的平均成本合計',usd(r.deltaUSD-r.realized,6)],['本筆已實現損益',signed(r.realized,n=>usd(n,6))]]);
  }
 }
 if(r.issues?.length)h+='<div class="reconcile">'+r.issues.map(s=>'<p>'+esc(s)+'</p>').join('')+'</div>';
 if(e.note)h+='<p class="note">'+esc(e.note)+'</p>';
 modal(loan?'借還款明細':(e.ticker?stockCaption(e)+' ':'')+labels[e.type],h+actions(id,loan));
}
function editQuotes(symbol){
 const positions=data.holdings;
 if(!positions.length)return;
 modal('更新持股參考價','<form id="quote-form"><p class="form-hint">輸入券商報價和報價日期，即可重算未實現損益與總獲利。現金與成交紀錄維持原值。</p><div class="form-grid"><label class="fld wide">持股<select name="symbol">'+positions.map(p=>'<option value="'+esc(p.ticker)+'"'+(p.ticker===symbol?' selected':'')+'>'+esc(stockCaption(p))+'</option>').join('')+'</select></label><label class="fld">參考價（美元／股）<input name="price" required type="number" min="0" step="any" inputmode="decimal"></label><label class="fld">報價日期<input name="date" required type="date"></label></div><div id="form-error" role="alert"></div><div class="actions"><button type="button" class="danger" id="remove-quote">清除此檔報價</button><button class="primary" type="submit">儲存參考價</button></div></form>');
 const f=$('quote-form'),sym=f.elements.symbol;
 function show(){const q=state.quotes[sym.value];f.elements.price.value=q?.price??'';f.elements.date.value=q?.date||isoToday();$('remove-quote').disabled=!q;}
 sym.onchange=show;show();
 function finish(){save();$('panel').close();render();toast(saveFailed?'已更新，請匯出帳本以保存。':'已更新報價與獲利');}
 $('remove-quote').onclick=()=>{delete state.quotes[sym.value];finish();};
 f.onsubmit=ev=>{ev.preventDefault();const price=f.elements.price.valueAsNumber,date=f.elements.date.value;
  if(!Number.isFinite(price)||price<0||!dateOk(date)){$('form-error').textContent='請填妥有效的報價和日期。';return;}
  state.quotes[sym.value]={price,date};finish();};
}
const fieldLabels={twd:'投入台幣（NT$）',usd:'美元金額（US$）',ticker:'美股代號',stockName:'股票／ETF 名稱',qty:'股數',price:'每股成交價（美元）',fee:'費用（美元，選填）',gross:'實際成交總額（美元，選填）',amount:'稅前股息（美元）',tax:'預扣稅（美元，選填）',basis:'新增股數的總成本（美元）',borrow:'借入台幣',repay:'償還台幣'};
function field(name,value,type){
 const opt=type==='funding'||['fee','gross','tax','basis','repay','borrow'].includes(name);
 let label=fieldLabels[name];if(type==='fx'&&name==='twd')label='換出的台幣';if(type==='fx'&&name==='usd')label='換得的美元';if(type==='funding'&&name==='usd')label='直接投入美元（US$）';
 const textAttr=name==='ticker'?'type="text" maxlength="24" autocomplete="off" autocapitalize="characters"':name==='stockName'?'type="text" maxlength="100" autocomplete="off"':null;
 return '<label class="fld">'+esc(label)+'<input name="'+name+'" '+(textAttr||'type="number" step="any" inputmode="decimal"'+(type==='cash'?'':' min="0"'))+(opt?'':' required')+' value="'+esc(value??'')+'"'+(name==='basis'?' placeholder="未知可留空"':name==='gross'?' placeholder="預設為股數 × 單價"':'')+'></label>';
}
function edit(id=null,loan=false,initialType='buy'){
 const current=(loan?state.loans:state.entries).find(e=>e.id===id);
 const e=current||{date:isoToday(),type:initialType,fee:0};
 modal((current?'編輯':'新增')+(loan?'借還款':'交易'),'<form id="edit-form"><div class="form-grid"><label class="fld'+(loan?' wide':'')+'">日期<input required type="date" name="date" value="'+esc(e.date)+'"></label>'+
 (!loan?'<label class="fld">交易類型<select name="type">'+Object.entries(labels).map(([v,t])=>'<option value="'+v+'"'+(e.type===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label>':'')+'</div><div id="fields" class="form-grid tight"></div>'+(!loan?'<label class="fld wide tight">資金來源或去向（選填）<input type="text" name="source" maxlength="180" value="'+esc(e.source||'')+'"></label>':'')+'<label class="fld wide tight">備註（選填）<textarea name="note" rows="2" maxlength="2000">'+esc(e.note)+'</textarea></label>'+
 (!loan?'<label class="tight" style="display:block"><input type="checkbox" name="pending"'+(e.status==='pending'?' checked':'')+'> 待確認，暫不計入金額及持股</label>':'')+
 '<div id="form-error" role="alert"></div><div class="actions"><button class="secondary" type="button" id="cancel-edit">取消</button><button class="primary" type="submit">儲存這筆</button></div></form>');
 const form=$('edit-form');
 function refreshSellReference(){
  const output=$('sell-reference');
  if(!output)return;
  const date=form.elements.date.value, symbol=form.elements.ticker.value.trim().toUpperCase();
  const saleIndex=current?state.entries.indexOf(current):state.entries.length;
  const prior=state.entries.filter((item,i)=>item.ticker&&item!==current&&item.status!=='pending'&&
   (item.date<date||(item.date===date&&i<saleIndex)));
  if(!dateOk(date)||!symbol){output.textContent='選好日期並輸入股票代號，就能查看賣出前的股數和買價。';return;}
  const history=LedgerEngine.calculate({entries:prior.filter(item=>item.ticker===symbol)});
  const lot=history.holdings[0], lastBuy=history.trace.findLast(r=>r.entry.type==='buy'&&r.deltaUSD<0)?.entry;
  const previousQty=history.trace.findLast(r=>r.qtyAfter!=null)?.qtyAfter??0;
  output.innerHTML=detailLines([
   ['賣出前持股',qty(previousQty)+' 股'+(previousQty<0?'（股數待核對）':'')],
   ['每股平均成本（含買入費用）',lot?(lot.averageCost==null?'成本待確認':exactUSD(lot.averageCost)):'—'],
   ['最近一次買進',lastBuy?lastBuy.date+'　'+qty(lastBuy.qty)+' 股，每股 '+exactUSD(lastBuy.price):'截至這筆交易前，沒有買進紀錄']
  ]);
 }
 function fields(type){
  const keys=loan?['borrow','repay']:schema[type];
  const inputs=keys.map(n=>field(n,e[n],type));
  if(keys.includes('ticker')){
   inputs.splice(1,0,field('stockName',e.stockName||stockName(e.ticker),type));
   const tickers=[...new Set(state.entries.filter(r=>r.ticker).map(r=>r.ticker))].sort();
   inputs.push('<datalist id="stock-symbols">'+tickers.map(t=>'<option value="'+esc(t)+'">'+esc(stockName(t))+'</option>').join('')+'</datalist>');
  }
  if(type==='sell')inputs.splice(2,0,'<div class="fld wide" id="sell-reference" aria-live="polite"></div>');
  const hints={funding:'第一次記初始投入，之後加碼請另新增一筆。美元、台幣可擇一填寫或同時填入。',buy:'僅登記美國市場的美元股票或 ETF。買款和費用從美元現金扣除。',sell:'成交款扣除費用後回到美元現金。股息請按實際入帳日選「現金股息」。',dividend:'依券商的入帳日登記。股息扣掉預扣稅和費用後，實收額會加進美元現金。',cash:'外部美元收支，收入填正數、支出填負數。實收股息請選「現金股息」，才能列入獲利。',adjustment:'適用於帳上多出的股數。成本未知可留白，相關賣出的獲利會標成待確認。這筆紀錄不會扣現金。'};
  $('fields').innerHTML=inputs.join('')+(hints[type]?'<p class="fld wide form-hint">'+esc(hints[type])+'</p>':'')+
   (type==='dividend'?'<output id="dividend-preview" class="fld wide" aria-live="polite"></output>':'');
  if(type==='dividend'){
   const preview=()=>{const amount=form.elements.amount.valueAsNumber,tax=form.elements.tax.valueAsNumber||0,fee=form.elements.fee.valueAsNumber||0;
    $('dividend-preview').textContent=Number.isFinite(amount)&&amount>=tax+fee?'預計實收 '+exactUSD(amount-tax-fee):'';};
   for(const n of ['amount','tax','fee'])form.elements[n].oninput=preview;
   preview();
  }
  if(keys.includes('ticker')){
   const t=form.elements.ticker, name=form.elements.stockName;
   t.setAttribute('list','stock-symbols');
   let lastSuggested=name.value;
   t.oninput=()=>{const found=stockName(t.value.trim().toUpperCase());if(!name.value||name.value===lastSuggested){name.value=found;lastSuggested=found;}refreshSellReference();};
   refreshSellReference();
  }
 }
 form.elements.date.onchange=refreshSellReference;
 fields(loan?'loan':e.type);if(!loan)form.elements.type.addEventListener('change',()=>fields(form.elements.type.value));
 $('cancel-edit').onclick=()=>current?detail(current.id,loan):$('panel').close();
 form.onsubmit=ev=>{ev.preventDefault();try{
  const f=new FormData(form),type=loan?'loan':f.get('type');const r={id:id||uid(),date:f.get('date'),note:f.get('note')};
  if(!loan){r.type=type;r.source=f.get('source');if(f.has('stockName'))r.stockName=f.get('stockName');}if(f.has('pending'))r.status='pending';
  for(const n of loan?['borrow','repay']:schema[type])r[n]=f.get(n);
  const target=loan?'loans':'entries',next=clone(state);if(current)next[target][next[target].findIndex(x=>x.id===id)]=r;else next[target].push(r);
  state=normalize(next);save();$('panel').close();render();toast(saveFailed?'已更新，請匯出檔案以保存。':'已儲存這筆紀錄');
 }catch(err){$('form-error').textContent=err.message;}};
}
function manager(){
 modal('資料管理','<p class="fine">編輯會保存在目前瀏覽器。你可以匯出備份，也可以在其他裝置匯入繼續使用。</p><div class="manager">'+(seed.githubUrl?'<button class="primary" id="open-github">用 GitHub Pages 開啟</button>':'')+'<button class="secondary" id="export">匯出帳本<p>下載含交易與借還款的 JSON 檔案</p></button><button class="secondary" id="import">匯入帳本<p>選擇 JSON 檔案取代目前這個帳本</p></button><button class="danger" id="reset">還原初始資料</button></div>');
 $('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='資金手帳-'+isoToday()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);};
 $('import').onclick=()=>$('import-file').click();
 $('reset').onclick=()=>{if(confirm('還原後，這個瀏覽器內的編輯會被初始資料取代。確定還原？')){replaceState(seed);toast('已還原初始資料');}};
}
$('import-file').onchange=async ev=>{const f=ev.target.files[0];ev.target.value='';if(!f)return;try{if(f.size>5e6)throw Error('檔案太大，請選擇 5 MB 以下的帳本。');const next=normalize(JSON.parse(await f.text()));if(confirm('匯入 '+next.entries.length+' 筆投資紀錄及 '+next.loans.length+' 筆借還款，取代目前帳本？')){replaceState(next);toast('已匯入帳本');}}catch(err){alert('匯入失敗。'+err.message);}};
$('invest-tab').onclick=()=>{tab='invest';render();};$('loans-tab').onclick=()=>{tab='loans';render();};
$('view').oninput=ev=>{
 if(ev.target.id!=='trial-price')return;
 const r=data.trace.find(t=>t.entry.id===$('example-transaction').value),price=ev.target.valueAsNumber;
 $('trial-result').textContent=Number.isFinite(price)&&price>=0?saleTrial(r,price):'請輸入有效的每股賣價。';
};
$('view').onchange=ev=>{
 if(ev.target.id==='trade-ticker'){$('trade-records').innerHTML=tradeHistoryRows(confirmedTrades(),ev.target.value);$('symbol-dividends').textContent=dividendsFor(ev.target.value);return;}
 if(ev.target.id==='example-transaction'){exampleId=ev.target.value;const row=data.trace.find(t=>t.entry.id===exampleId);$('example-result').innerHTML=exampleCalculation(row);return;}
 if(ev.target.id==='filter'){filter=ev.target.value;render();$('filter').focus();return;}
 if(ev.target.hasAttribute('data-scenario')){
  const picked=new Set(Array.from($('view').querySelectorAll('[data-scenario]:checked'),el=>el.dataset.scenario));
  const fstate=clone(state);for(const e of fstate.entries)if(picked.has(e.id))delete e.status;
  const rows=LedgerEngine.calculate(fstate).trace.filter(r=>!state.referenceDate||r.entry.date<=state.referenceDate);
  const last=rows[rows.length-1], result=last?.cashUSD||0;
  $('scenario-result').textContent=picked.size?'試算後現金為 '+exactUSD(result)+'、'+twd(last?.cashTWD||0)+'。'+(state.referenceCashUSD!=null&&Math.abs(result-state.referenceCashUSD)<.005?'美元與原表相符。':''):'勾選可查看試算餘額，帳本會保留原值。';
 }
};
$('view').onclick=ev=>{const btn=ev.target.closest('[data-entry],[data-loan],[data-quote],[data-new]');if(!btn)return;
 if(btn.hasAttribute('data-quote'))editQuotes(btn.dataset.quote);
 else if(btn.hasAttribute('data-new'))edit(null,false,btn.dataset.new);
 else detail(btn.dataset.entry??btn.dataset.loan,btn.hasAttribute('data-loan'));};
$('add').onclick=()=>edit(null,tab==='loans');$('manage').onclick=manager;
$('close').onclick=()=>$('panel').close();
$('panel').onclick=ev=>{if(ev.target===$('panel')){const b=$('panel').getBoundingClientRect();if(ev.clientX<b.left||ev.clientX>b.right||ev.clientY<b.top||ev.clientY>b.bottom)$('panel').close();}};
$('panel-body').addEventListener('click',ev=>{const btn=ev.target.closest('[data-edit],[data-del]');if(!btn)return;const loan=tab==='loans';if(btn.hasAttribute('data-edit')){edit(btn.dataset.edit,loan);return;}
 if(confirm('確定刪除這筆紀錄？後續餘額會重新計算。')){const target=loan?'loans':'entries';state[target]=state[target].filter(e=>e.id!==btn.dataset.del);save();$('panel').close();render();toast('已刪除這筆紀錄');}});
render();
})();
