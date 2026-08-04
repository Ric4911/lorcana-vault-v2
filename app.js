const $ = id => document.getElementById(id);
let cards = JSON.parse(localStorage.getItem('lorcana_cards_v2') || '[]');
let editId = null;
let deferredPrompt = null;
let cameraStream = null;
let scannedCard = null;

const fields = ['name','set','number','rarity','ink','type','qty','foilQty','price','condition','storage','location','trade'];
function save(){ localStorage.setItem('lorcana_cards_v2', JSON.stringify(cards)); render(); }
function money(n){ return '£' + Number(n||0).toFixed(2); }
function key(c){ return [c.name,c.set,c.number,c.condition,c.storage,c.location].join('|').toLowerCase(); }

function formData(){
  const c = {};
  fields.forEach(f => c[f] = $(f).type === 'checkbox' ? $(f).checked : $(f).value.trim());
  c.qty = Math.max(1, parseInt(c.qty || '1',10));
  c.foilQty = Math.max(0, parseInt(c.foilQty || '0',10));
  c.price = Math.max(0, parseFloat(c.price || '0'));
  c.id = editId || crypto.randomUUID();
  c.updated = new Date().toISOString();
  return c;
}
function fillForm(c){
  editId = c.id;
  fields.forEach(f => { if($(f).type === 'checkbox') $(f).checked = !!c[f]; else $(f).value = c[f] ?? ''; });
  showTab('add');
}
function clearForm(){ editId=null; $('cardForm').reset(); $('qty').value=1; $('foilQty').value=0; $('price').value=0; }

$('cardForm').addEventListener('submit', e => {
  e.preventDefault();
  const c = formData();
  const idx = cards.findIndex(x => x.id === c.id);
  if(idx >= 0) cards[idx] = c;
  else {
    const same = cards.find(x => key(x) === key(c));
    if(same){ same.qty += c.qty; same.foilQty += c.foilQty; same.price = c.price || same.price; same.updated = c.updated; }
    else cards.push(c);
  }
  clearForm(); save(); showTab('collection');
});

function render(){
  const total = cards.reduce((a,c)=>a+Number(c.qty||0),0);
  const value = cards.reduce((a,c)=>a+(Number(c.qty||0)*Number(c.price||0)),0);
  $('totalCards').textContent = total;
  $('uniqueCards').textContent = cards.length;
  $('totalValue').textContent = money(value);
  renderCards(); renderAnalytics();
}
function renderCards(){
  const q = ($('search')?.value || '').toLowerCase();
  const list = cards.filter(c => JSON.stringify(c).toLowerCase().includes(q)).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  $('cards').innerHTML = list.map(c => `<article class="card">
    <div class="cardTop"><div><h3>${esc(c.name)}</h3><div class="meta">${esc(c.set||'No set')} · ${esc(c.number||'No no.')} · ${esc(c.rarity||'')}</div></div><span class="pill">x${c.qty}</span></div>
    <div class="meta">${esc(c.ink||'')} ${esc(c.type||'')} · ${esc(c.condition||'')} · ${esc(c.storage||'')} · ${esc(c.location||'')}</div>
    <div class="meta">Foils: ${c.foilQty||0} · Each: ${money(c.price)} · Total: ${money((c.qty||0)*(c.price||0))} ${c.trade?'· Trade':''}</div>
    <div class="cardBtns"><button onclick='editCard("${c.id}")'>Edit</button><button class="ghost" onclick='dupeCard("${c.id}")'>+1</button><button class="danger" onclick='deleteCard("${c.id}")'>Delete</button></div>
  </article>`).join('') || '<p class="muted">No cards yet. Add your first card or import CSV.</p>';
}
function renderAnalytics(){
  const totalValue = cards.reduce((a,c)=>a+(c.qty*c.price),0);
  const bySet = group('set');
  const byStorage = group('storage');
  const high = [...cards].sort((a,b)=>(b.qty*b.price)-(a.qty*a.price)).slice(0,10);
  $('analyticsContent').innerHTML = `
    <h3>Storage split</h3>${bars(byStorage)}
    <h3>Value by set</h3>${bars(bySet,totalValue)}
    <h3>Top value cards</h3><table><tr><th>Card</th><th>Qty</th><th>Value</th></tr>${high.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.qty}</td><td>${money(c.qty*c.price)}</td></tr>`).join('')}</table>
    <h3>Useful lists</h3>
    <p class="muted">Duplicates: ${cards.filter(c=>c.qty>4).length} cards above playset. Trade list: ${cards.filter(c=>c.trade).length} cards marked.</p>`;
}
function group(field){ const out={}; cards.forEach(c=>{ const k=c[field]||'Unknown'; out[k]=(out[k]||0)+(c.qty*c.price || c.qty || 0); }); return out; }
function bars(obj,total=null){ const max=Math.max(1,...Object.values(obj)); return Object.entries(obj).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<p>${esc(k)} <b>${total?money(v):v}</b></p><div class="bar"><span style="width:${Math.min(100,(v/max)*100)}%"></span></div>`).join('') || '<p class="muted">No data yet.</p>'; }
function esc(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
window.editCard = id => fillForm(cards.find(c=>c.id===id));
window.dupeCard = id => { const c=cards.find(c=>c.id===id); if(c){c.qty++; save();} };
window.deleteCard = id => { if(confirm('Delete this card?')){ cards=cards.filter(c=>c.id!==id); save(); } };
$('search').addEventListener('input', renderCards);

function showTab(id){ document.querySelectorAll('.panel,.tabs button').forEach(el=>el.classList.remove('active')); $(id).classList.add('active'); document.querySelector(`[data-tab="${id}"]`).classList.add('active'); }
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));

$('startCamera').onclick = async () => {
  try {
    if(cameraStream) cameraStream.getTracks().forEach(track=>track.stop());
    cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    $('video').srcObject=cameraStream;
    await $('video').play();
    $('capture').disabled=false;
    setScanStatus('Camera ready. Hold the card steady inside the gold guide.');
  } catch(e){ setScanStatus('Camera unavailable. Allow camera access or choose a card photo below.',true); }
};
$('capture').onclick = () => {
  const v=$('video');
  if(!v.videoWidth) return setScanStatus('Wait for the camera picture, then try again.',true);
  const c=$('snapshot'); c.width=v.videoWidth; c.height=v.videoHeight; c.getContext('2d').drawImage(v,0,0);
  scanImage(c);
};
$('cardPhoto').onchange = e => {
  const file=e.target.files?.[0]; if(!file)return;
  const img=new Image();
  img.onload=()=>{ scanImage(img); URL.revokeObjectURL(img.src); };
  img.onerror=()=>setScanStatus('That photo could not be opened.',true);
  img.src=URL.createObjectURL(file);
};

async function scanImage(source){
  scannedCard=null; showMatch(null); $('ocrText').value='';
  if(!window.Tesseract) return setScanStatus('The scanner could not load. Check your internet connection and reload the app.',true);
  const prepared=prepareScan(source);
  $('snapshot').width=prepared.width; $('snapshot').height=prepared.height;
  $('snapshot').getContext('2d').drawImage(prepared,0,0);
  $('scanProgress').classList.remove('hidden'); $('scanProgress').value=0;
  setScanStatus('Reading the card… first scan can take a little longer.');
  try{
    const result=await Tesseract.recognize(prepared,'eng',{logger:m=>{
      if(m.status==='recognizing text') $('scanProgress').value=m.progress||0;
      if(m.status) setScanStatus(m.status==='recognizing text'?`Reading card… ${Math.round((m.progress||0)*100)}%`:'Preparing scanner…');
    }});
    const text=result.data.text.trim(); $('ocrText').value=text;
    setScanStatus('Text read. Looking for the exact card…');
    const card=await identifyCard(text);
    if(card){scannedCard=card;showMatch(card);setScanStatus('Match found. Check it, then tap “Use result in Add form”.');}
    else setScanStatus('No exact database match. You can correct the recognised text or enter the card manually.',true);
  }catch(e){setScanStatus('Scan failed. Try a closer, sharper photo in even light.',true);}
  finally{$('scanProgress').classList.add('hidden');}
}

function prepareScan(source){
  const max=1600, sw=source.videoWidth||source.naturalWidth||source.width, sh=source.videoHeight||source.naturalHeight||source.height;
  const scale=Math.min(1,max/Math.max(sw,sh)), c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(sw*scale)); c.height=Math.max(1,Math.round(sh*scale));
  const ctx=c.getContext('2d'); ctx.drawImage(source,0,0,c.width,c.height);
  const image=ctx.getImageData(0,0,c.width,c.height), d=image.data;
  for(let i=0;i<d.length;i+=4){const grey=.299*d[i]+.587*d[i+1]+.114*d[i+2];const boosted=grey<145?Math.max(0,grey*.72):Math.min(255,grey*1.12);d[i]=d[i+1]=d[i+2]=boosted;}
  ctx.putImageData(image,0,0); return c;
}

async function identifyCard(text){
  const normalized=text.replace(/[|Il]/g,'1');
  const numberMatch=normalized.match(/(\d{1,3}[A-Za-z]?)\s*[\/]\s*(\d{2,3})/);
  const setMatch=normalized.match(/(?:EN|FR|DE|IT)\s*[-:]?\s*(\d{1,2})\b/i) || normalized.match(/\b(\d{1,2})\s*(?:EN|FR|DE|IT)\b/i);
  if(numberMatch && setMatch){
    const direct=await fetchCard(`${setMatch[1]}/${numberMatch[1]}`); if(direct)return direct;
  }
  const lines=text.split(/\n+/).map(x=>x.replace(/[^A-Za-z0-9 '\-&]/g,' ').replace(/\s+/g,' ').trim()).filter(x=>x.length>2);
  const candidates=lines.filter(x=>/[A-Za-z]{3}/.test(x) && x.length<55).slice(0,5);
  for(const phrase of candidates){
    try{
      const response=await fetch(`https://api.lorcast.com/v0/cards/search?q=${encodeURIComponent(phrase)}&unique=prints`);
      if(!response.ok)continue; const data=await response.json(); const results=data.results||[];
      const exactNumber=numberMatch && results.find(c=>String(c.collector_number).toLowerCase()===numberMatch[1].toLowerCase());
      if(exactNumber)return exactNumber;
      if(results.length===1)return results[0];
    }catch(e){return null;}
  }
  return null;
}
async function fetchCard(path){try{const r=await fetch(`https://api.lorcast.com/v0/cards/${path}`);return r.ok?await r.json():null;}catch(e){return null;}}
function setScanStatus(message,error=false){$('scanStatus').textContent=message;$('scanStatus').style.color=error?'var(--danger)':'';}
function showMatch(card){
  $('scanMatch').classList.toggle('hidden',!card); if(!card)return;
  $('matchImage').src=card.image_uris?.digital?.small||'';
  $('matchName').textContent=[card.name,card.version].filter(Boolean).join(' — ');
  $('matchMeta').textContent=`${card.set?.name||''} · ${card.collector_number||''} · ${String(card.rarity||'').replace('_',' ')}`;
}

$('parseText').onclick = () => {
  if(scannedCard){
    $('name').value=[scannedCard.name,scannedCard.version].filter(Boolean).join(' - ');
    $('set').value=scannedCard.set?.name||''; $('number').value=scannedCard.collector_number||'';
    const rarity=String(scannedCard.rarity||'').replace('_',' '); $('rarity').value=[...$('rarity').options].map(o=>o.value).find(v=>v.toLowerCase()===rarity.toLowerCase())||'';
    $('ink').value=scannedCard.ink||''; $('type').value=(scannedCard.type||[]).join(', ');
  } else {
    const lines=$('ocrText').value.split(/\n+/).map(x=>x.trim()).filter(Boolean);
    if(lines[0])$('name').value=lines[0];
    const number=lines.find(x=>/\d+\s*\/\s*\d+/.test(x)); if(number)$('number').value=number.match(/\d+\s*\/\s*\d+/)[0];
  }
  showTab('add');
};

function toCsv(){ const headers=fields; const rows=cards.map(c=>headers.map(h=>`"${String(c[h]??'').replace(/"/g,'""')}"`).join(',')); return headers.join(',')+'\n'+rows.join('\n'); }
function download(name, text, type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); }
$('exportCsv').onclick=()=>download('lorcana-vault.csv',toCsv(),'text/csv');
$('downloadBackup').onclick=()=>download('lorcana-vault-backup.json',JSON.stringify(cards,null,2),'application/json');
$('importCsv').onchange=e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{ importCsv(r.result); save(); }; r.readAsText(f); };
$('restoreJson').onchange=e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{ cards=JSON.parse(r.result); save(); }; r.readAsText(f); };
$('clearAll').onclick=()=>{ if(confirm('Clear your full collection on this device? Export backup first.')){cards=[]; save();} };
function importCsv(text){ const [head,...lines]=text.split(/\r?\n/).filter(Boolean); const headers=head.split(',').map(x=>x.replace(/"/g,'').trim()); lines.forEach(line=>{ const vals=parseCsvLine(line); const c={id:crypto.randomUUID(),updated:new Date().toISOString()}; headers.forEach((h,i)=>c[h]=vals[i]||''); c.qty=parseInt(c.qty||1,10); c.foilQty=parseInt(c.foilQty||0,10); c.price=parseFloat(c.price||0); c.trade=String(c.trade).toLowerCase()==='true'; cards.push(c); }); }
function parseCsvLine(line){ const out=[]; let cur='', q=false; for(let i=0;i<line.length;i++){ const ch=line[i]; if(ch==='"' && line[i+1]==='"'){cur+='"'; i++;} else if(ch==='"')q=!q; else if(ch===','&&!q){out.push(cur);cur='';} else cur+=ch;} out.push(cur); return out; }

window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredPrompt=e; $('installBtn').classList.remove('hidden'); });
$('installBtn').onclick=async()=>{ if(deferredPrompt){ deferredPrompt.prompt(); deferredPrompt=null; } };
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
render();
