/* =========================================================
   Bóveda: datos sensibles cifrados con una clave maestra.
   - Se cifra en el navegador (AES-GCM 256, clave derivada con PBKDF2-SHA256).
   - En la base solo se guarda el bloque cifrado (boveda/datos).
   - La clave maestra nunca se guarda ni se envía.
   ========================================================= */
(function(){
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(t){const e=$('#toast');if(!e)return;e.textContent=t;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2200)}
const ITER=600000, PATH='boveda/datos', AUTOLOCK_MS=10*60*1000;

const SECS={
  gmails:{l:'Gmails',add:'Agregar Gmail',fields:[
    {k:'email',l:'Gmail',main:true},{k:'clave',l:'Contraseña',secret:true},{k:'recuperacion',l:'Mail de recuperación'},
    {k:'telefono',l:'Teléfono'},{k:'uso',l:'Se usa en'},{k:'nota',l:'Nota',wide:true}]},
  cuentas:{l:'Cuentas y claves',add:'Agregar cuenta',fields:[
    {k:'servicio',l:'Servicio / sitio',main:true},{k:'usuario',l:'Usuario'},{k:'clave',l:'Contraseña',secret:true},
    {k:'link',l:'Link'},{k:'nota',l:'Nota',wide:true}]},
  celus:{l:'Celulares y comunidades',add:'Agregar celular',fields:[
    {k:'celu',l:'Celu',main:true},{k:'tipo',l:'Tipo'},{k:'numero',l:'Número'},{k:'credito',l:'Nro crédito'},
    {k:'com2',l:'Comunidad 2'},{k:'com1',l:'Comunidad 1'},{k:'canal',l:'Canal'},{k:'nombre',l:'Nombre'},
    {k:'titular',l:'Datos de titular'},{k:'fecha',l:'Fecha'},{k:'monto',l:'Monto'},{k:'gmail',l:'Gmail'},{k:'nota',l:'Nota',wide:true}]}
};

/* ---------- Cripto ---------- */
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function derivar(pass,salt,iter){const base=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function cifrar(key,obj){const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(obj)));return {iv:b64(iv),ct:b64(ct)}}
async function descifrar(key,doc){const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(doc.iv)},key,unb64(doc.ct));return JSON.parse(dec.decode(pt))}
function genClave(n=16){const a='abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%*-_';const v=new Uint32Array(n);crypto.getRandomValues(v);return Array.from(v,x=>a[x%a.length]).join('')}
const rid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

/* ---------- Estado ---------- */
let db=null,KEY=null,SALT=null,ITERS=ITER,DATA=null,remoto=null,vista='gmails',editId=null,agregando=false,visibles=new Set(),filtro='',ultimoUso=Date.now(),guardando=false;

window.TC.ready.then(({db:d,perfil})=>{
  if(perfil.rol!=='admin')return;
  db=d;
  db.doc(PATH).onSnapshot(s=>{remoto=s.exists?s.data():null;
    if(KEY&&remoto&&!guardando&&!editId&&!agregando){descifrar(KEY,remoto).then(o=>{DATA=normal(o);render()}).catch(()=>{})}
    if(!KEY)renderLock()});
  setInterval(()=>{if(KEY&&Date.now()-ultimoUso>AUTOLOCK_MS){bloquear();toast('Bóveda bloqueada por inactividad')}},30000);
  ['click','keydown'].forEach(ev=>$('#tab-boveda').addEventListener(ev,()=>ultimoUso=Date.now()));
  renderLock();
});
function normal(o){o=o||{};Object.keys(SECS).forEach(k=>{if(!Array.isArray(o[k]))o[k]=[]});return o}

/* ---------- Bloqueo ---------- */
function renderLock(){
  $('#bvOpen').hidden=true;$('#bvLock').hidden=false;
  const nueva=!remoto;
  $('#bvLockTitle').textContent=nueva?'Crear la bóveda':'Bóveda bloqueada';
  $('#bvLockText').textContent=nueva?'Elegí una clave maestra. Con ella se cifra todo lo que guardes acá. Si la perdés, nadie puede recuperar los datos (ni vos, ni nosotros).':'Ingresá tu clave maestra para ver y editar los datos.';
  $('#bvPass2Wrap').hidden=!nueva;$('#bvLockBtn').textContent=nueva?'Crear bóveda':'Desbloquear';$('#bvLockErr').textContent='';
}
function bloquear(){KEY=null;DATA=null;visibles.clear();editId=null;agregando=false;renderLock()}
$('#bvLockForm').addEventListener('submit',async e=>{e.preventDefault();const p1=$('#bvPass').value,p2=$('#bvPass2').value,btn=$('#bvLockBtn');$('#bvLockErr').textContent='';
  if(!remoto){if(p1.length<10){$('#bvLockErr').textContent='Usá al menos 10 caracteres.';return}if(p1!==p2){$('#bvLockErr').textContent='Las dos claves no coinciden.';return}}
  btn.disabled=true;const txt=btn.textContent;btn.textContent='Procesando…';
  try{
    if(!remoto){SALT=crypto.getRandomValues(new Uint8Array(16));ITERS=ITER;KEY=await derivar(p1,SALT,ITERS);DATA=normal({});await guardar('Bóveda creada')}
    else{SALT=unb64(remoto.salt);ITERS=remoto.iter||ITER;const k=await derivar(p1,SALT,ITERS);DATA=normal(await descifrar(k,remoto));KEY=k}
    $('#bvPass').value='';$('#bvPass2').value='';ultimoUso=Date.now();render();
  }catch(err){KEY=null;$('#bvLockErr').textContent=remoto?'Clave maestra incorrecta.':'No se pudo crear la bóveda.';console.error(err)}
  btn.disabled=false;btn.textContent=txt});
async function guardar(msg){guardando=true;try{const c=await cifrar(KEY,DATA);
  await db.doc(PATH).set({v:1,kdf:'PBKDF2-SHA256',iter:ITERS,salt:b64(SALT),iv:c.iv,ct:c.ct});if(msg)toast(msg)}
  catch(e){toast('No se pudo guardar la bóveda');console.error(e)}finally{guardando=false}}

/* ---------- Vista abierta ---------- */
function filas(){const q=filtro.trim().toLowerCase();const l=DATA[vista];if(!q)return l;return l.filter(r=>SECS[vista].fields.some(f=>!f.secret&&String(r[f.k]||'').toLowerCase().includes(q)))}
function celda(r,f){const v=r[f.k]||'';if(!v)return '<span class="bv-empty">—</span>';
  if(f.secret){const on=visibles.has(r.id+f.k);return `<span class="bv-secret">${on?esc(v):'••••••••'}</span><button type="button" class="ib" data-ver="${r.id}|${f.k}" title="${on?'Ocultar':'Mostrar'}" aria-label="${on?'Ocultar':'Mostrar'}">${on?'◉':'◎'}</button><button type="button" class="ib" data-copiar="${r.id}|${f.k}" title="Copiar" aria-label="Copiar">⧉</button>`}
  if(f.k==='link'&&/^https?:\/\//i.test(v))return `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\//,''))}</a>`;
  return `<span>${esc(v)}</span>${f.main||f.k==='usuario'||f.k==='email'?`<button type="button" class="ib" data-copiar="${r.id}|${f.k}" title="Copiar" aria-label="Copiar">⧉</button>`:''}`}
function filaEdicion(r,nueva){const S=SECS[vista];
  return `<tr class="bv-edit" data-id="${r.id||''}">${S.fields.map(f=>`<td><div class="bv-in">${f.secret?`<input type="text" class="bv-f" data-k="${f.k}" value="${esc(r[f.k])}" autocomplete="off" spellcheck="false"><button type="button" class="ib" data-gen="${f.k}" title="Generar clave" aria-label="Generar clave">⟳</button>`:`<input type="text" class="bv-f" data-k="${f.k}" value="${esc(r[f.k])}" aria-label="${esc(f.l)}" ${f.wide?'style="min-width:180px"':''}>`}</div></td>`).join('')}
    <td class="bv-act"><button type="button" class="btn pri sm" data-bvsave="1">${nueva?'Agregar':'Guardar'}</button> <button type="button" class="btn sm" data-bvcancel="1">Cancelar</button></td></tr>`}
function render(){
  if(!KEY||!DATA){renderLock();return}
  $('#bvLock').hidden=true;$('#bvOpen').hidden=false;
  document.querySelectorAll('#bvSeg button').forEach(b=>b.setAttribute('aria-selected',b.dataset.v===vista));
  Object.keys(SECS).forEach(k=>{const c=document.querySelector(`#bvSeg [data-v="${k}"] small`);if(c)c.textContent=DATA[k].length});
  const S=SECS[vista],rs=filas();$('#bvAdd').textContent='+ '+S.add;
  const a=document.activeElement;if(a&&$('#bvTable').contains(a)&&a.classList.contains('bv-f'))return;
  $('#bvTable').innerHTML=`<thead><tr>${S.fields.map(f=>`<th>${esc(f.l)}</th>`).join('')}<th></th></tr></thead><tbody>`+
    (agregando?filaEdicion({},true):'')+
    (rs.length?rs.map(r=>editId===r.id?filaEdicion(r,false):`<tr data-id="${r.id}">${S.fields.map(f=>`<td class="${f.wide?'bv-wide':''}"><div class="bv-cell">${celda(r,f)}</div></td>`).join('')}<td class="bv-act"><button type="button" class="ib" data-bvedit="${r.id}" title="Editar" aria-label="Editar">✎</button><button type="button" class="ib del" data-bvdel="${r.id}" title="Borrar" aria-label="Borrar">×</button></td></tr>`).join('')
      :`<tr><td colspan="${S.fields.length+1}" class="empty">${filtro?'Nada coincide con la búsqueda.':'Todavía no hay nada guardado acá. Usá "'+esc(S.add)+'" o "Importar desde Excel".'}</td></tr>`)+'</tbody>';
  $('#bvImpCols').textContent=S.fields.map(f=>f.l).join(' · ');
  if(agregando||editId){const i=$('#bvTable tr.bv-edit .bv-f');if(i)i.focus()}
}
document.querySelectorAll('#bvSeg button').forEach(b=>b.onclick=()=>{vista=b.dataset.v;editId=null;agregando=false;visibles.clear();$('#bvImport').hidden=true;render()});
$('#bvSearch').addEventListener('input',e=>{filtro=e.target.value;render()});
$('#bvLockNow').onclick=()=>{bloquear();toast('Bóveda bloqueada')};
$('#bvAdd').onclick=()=>{agregando=true;editId=null;render()};
$('#bvTable').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.ver){const [id,k]=b.dataset.ver.split('|');const key=id+k;visibles.has(key)?visibles.delete(key):visibles.add(key);render();return}
  if(b.dataset.copiar){const [id,k]=b.dataset.copiar.split('|');const r=DATA[vista].find(x=>x.id===id);try{await navigator.clipboard.writeText(r[k]||'');toast('Copiado')}catch(_){toast('No se pudo copiar')}return}
  if(b.dataset.gen){const i=b.parentElement.querySelector('.bv-f');i.value=genClave();return}
  if(b.dataset.bvedit){editId=b.dataset.bvedit;agregando=false;render();return}
  if(b.dataset.bvcancel){editId=null;agregando=false;b.blur();render();return}
  if(b.dataset.bvdel){if(!b.classList.contains('arm')){b.classList.add('arm');b.textContent='¿Borrar?';setTimeout(()=>{b.classList.remove('arm');b.textContent='×'},2500);return}
    DATA[vista]=DATA[vista].filter(x=>x.id!==b.dataset.bvdel);render();await guardar('Borrado');return}
  if(b.dataset.bvsave){const tr=b.closest('tr');const r={};tr.querySelectorAll('.bv-f').forEach(i=>{const v=i.value.trim();if(v)r[i.dataset.k]=v});
    if(!Object.keys(r).length){toast('Completá al menos un dato');return}
    if(tr.dataset.id){const i=DATA[vista].findIndex(x=>x.id===tr.dataset.id);DATA[vista][i]=Object.assign({id:tr.dataset.id},r)}else DATA[vista].unshift(Object.assign({id:rid()},r));
    editId=null;agregando=false;b.blur();render();await guardar('Guardado')}});
$('#bvTable').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.classList.contains('bv-f')){e.preventDefault();e.target.closest('tr').querySelector('[data-bvsave]').click()}
  if(e.key==='Escape'){editId=null;agregando=false;e.target.blur();render()}});

/* ---------- Importar desde Excel (copiar y pegar) ---------- */
$('#bvImpBtn').onclick=()=>{$('#bvImport').hidden=!$('#bvImport').hidden;$('#bvImpText').value='';$('#bvImpInfo').textContent='';if(!$('#bvImport').hidden)$('#bvImpText').focus()};
function parsear(txt){const S=SECS[vista];const lineas=txt.replace(/\r/g,'').split('\n').filter(l=>l.trim());
  const filas=lineas.map(l=>l.split('\t'));
  if(filas.length&&S.fields.some((f,i)=>(filas[0][i]||'').trim().toLowerCase()===f.l.toLowerCase().split(' ')[0]))filas.shift(); // salta encabezado
  return filas.map(c=>{const r={};S.fields.forEach((f,i)=>{const v=(c[i]||'').trim();if(v)r[f.k]=v});return r}).filter(r=>Object.keys(r).length)}
$('#bvImpText').addEventListener('input',()=>{const n=parsear($('#bvImpText').value).length;$('#bvImpInfo').textContent=n?`${n} fila${n>1?'s':''} lista${n>1?'s':''} para importar`:''});
$('#bvImpOk').onclick=async()=>{const rs=parsear($('#bvImpText').value);if(!rs.length){toast('No encontré filas para importar');return}
  DATA[vista]=rs.map(r=>Object.assign({id:rid()},r)).concat(DATA[vista]);$('#bvImpText').value='';$('#bvImport').hidden=true;render();await guardar(`${rs.length} importadas`)};

/* ---------- Cambiar clave maestra ---------- */
$('#bvChange').onclick=()=>{$('#bvChangeForm').hidden=!$('#bvChangeForm').hidden};
$('#bvChangeForm').addEventListener('submit',async e=>{e.preventDefault();const a=$('#bvNew1').value,b=$('#bvNew2').value;
  if(a.length<10){toast('Usá al menos 10 caracteres');return}if(a!==b){toast('Las claves no coinciden');return}
  SALT=crypto.getRandomValues(new Uint8Array(16));ITERS=ITER;KEY=await derivar(a,SALT,ITERS);await guardar('Clave maestra cambiada');
  $('#bvNew1').value='';$('#bvNew2').value='';$('#bvChangeForm').hidden=true});
})();
