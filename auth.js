/* =========================================================
   Login, conexión a Supabase y sección Usuarios.
   Expone window.TC.ready -> Promise<{db, perfil, sb}>
   ========================================================= */
(function(){
const CFG=window.TC_CONFIG||{};
const DOMINIO='tcpauta.local';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let resolveReady;window.TC={ready:new Promise(r=>resolveReady=r)};
document.body.classList.add('locked');

function toast(t){const e=$('#toast');if(!e)return;e.textContent=t;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2200)}
function genClave(n=12){const a='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';const v=new Uint32Array(n);crypto.getRandomValues(v);return Array.from(v,x=>a[x%a.length]).join('')}
async function copiar(t){try{await navigator.clipboard.writeText(t);toast('Copiado')}catch(e){toast('Seleccioná y copiá a mano')}}

if(!CFG.SUPABASE_URL||!CFG.SUPABASE_ANON_KEY||CFG.SUPABASE_URL.includes('TU-PROYECTO')){
  $('#loginErr').textContent='Falta configurar Supabase en config.js (ver LEEME).';return}
const sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});

/* ---------- Base de datos: caché local + cambios en vivo ----------
   Una sola lectura al entrar y después solo llegan los cambios. */
function makeDb(){
  const cache=new Map(),dl=new Map(),cl=new Map();let loaded=false;
  const parent=p=>p.slice(0,p.lastIndexOf('/'));
  const idOf=p=>p.slice(p.lastIndexOf('/')+1);
  const dsnap=p=>{const d=cache.get(p);return {id:idOf(p),exists:d!==undefined,data:()=>d,metadata:{fromCache:false,hasPendingWrites:false}}};
  const csnap=c=>{const docs=[];for(const p of cache.keys())if(parent(p)===c)docs.push(dsnap(p));docs.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);return {docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{}}};
  const notify=p=>{(dl.get(p)||[]).forEach(f=>f(dsnap(p)));const c=parent(p);(cl.get(c)||[]).forEach(f=>f(csnap(c)))};
  async function loadAll(){const all=[];for(let from=0;;from+=1000){const {data,error}=await sb.from('docs').select('path,data').range(from,from+999);if(error)throw error;all.push(...data);if(data.length<1000)break}
    cache.clear();all.forEach(r=>cache.set(r.path,r.data));loaded=true;
    dl.forEach((s,p)=>s.forEach(f=>f(dsnap(p))));cl.forEach((s,c)=>s.forEach(f=>f(csnap(c))))}
  function sub(map,key,fn,snap){if(!map.has(key))map.set(key,new Set());map.get(key).add(fn);if(loaded)setTimeout(()=>fn(snap(key)));return ()=>map.get(key).delete(fn)}
  const fail=e=>{throw {code:(e.code==='42501'||/row-level/.test(e.message||''))?'invalid_argument':'unavailable',message:e.message}};
  const sinPermiso=p=>{notify(p);return Promise.reject({code:'invalid_argument',message:'Solo lectura'})};
  async function put(p,d){const prev=cache.get(p);if(window.TC.guard&&!window.TC.guard(p,d,prev))return sinPermiso(p);cache.set(p,d);notify(p);const {error}=await sb.from('docs').upsert({path:p,data:d});
    if(error){if(prev===undefined)cache.delete(p);else cache.set(p,prev);notify(p);fail(error)}}
  function merge(a,b){const o=Object.assign({},a);for(const k in b){const v=b[k];o[k]=(v&&typeof v==='object'&&!Array.isArray(v)&&o[k]&&typeof o[k]==='object'&&!Array.isArray(o[k]))?merge(o[k],v):v}return o}
  const rid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  const clone=d=>JSON.parse(JSON.stringify(d));
  const doc=p=>({id:idOf(p),path:p,
    onSnapshot:fn=>sub(dl,p,fn,dsnap),
    get:async()=>dsnap(p),
    set:d=>put(p,clone(d)),
    update:d=>{const cur=cache.get(p);if(cur===undefined)return Promise.reject({code:'invalid_argument',message:'No existe'});return put(p,merge(cur,clone(d)))},
    delete:async()=>{const prev=cache.get(p);if(window.TC.guard&&!window.TC.guard(p,undefined,prev))return sinPermiso(p);cache.delete(p);notify(p);const {error}=await sb.from('docs').delete().eq('path',p);if(error){if(prev!==undefined){cache.set(p,prev);notify(p)}fail(error)}}});
  const collection=c=>({path:c,onSnapshot:fn=>sub(cl,c,fn,csnap),get:async()=>csnap(c),doc:id=>doc(c+'/'+(id||rid())),add:async d=>{const r=doc(c+'/'+rid());await r.set(d);return r}});
  sb.channel('docs-cambios').on('postgres_changes',{event:'*',schema:'public',table:'docs'},pl=>{
    if(pl.eventType==='DELETE'){const p=pl.old&&pl.old.path;if(p&&cache.has(p)){cache.delete(p);notify(p)}}
    else if(pl.new&&pl.new.path){cache.set(pl.new.path,pl.new.data);notify(pl.new.path)}}).subscribe();
  // Si la pestaña estuvo oculta más de 5 minutos, se relee todo una vez (por si se perdió algún cambio).
  let hiddenAt=0;document.addEventListener('visibilitychange',()=>{if(document.hidden)hiddenAt=Date.now();else if(hiddenAt&&Date.now()-hiddenAt>3e5){hiddenAt=0;loadAll().catch(()=>{})}});
  return {doc,collection,loadAll};
}

/* ---------- Login ---------- */
async function entrar(session){
  const {data:perfil}=await sb.from('perfiles').select('*').eq('id',session.user.id).maybeSingle();
  if(!perfil||!perfil.activo){await sb.auth.signOut();$('#loginErr').textContent='Tu usuario no está habilitado. Pedile acceso al administrador.';return}
  const admin=perfil.rol==='admin';
  if(!admin&&(!$('#tab-usuarios').hidden||!$('#tab-boveda').hidden))document.querySelector('[data-tab=hoy]').click();
  document.body.classList.remove('locked');document.body.classList.toggle('is-admin',admin);
  $('#who').textContent=perfil.nombre||perfil.usuario;
  const db=makeDb();
  try{await db.loadAll()}catch(e){console.error(e);toast('No se pudieron cargar los datos')}
  resolveReady({db,perfil,sb});
  initPermisos(db,perfil);
  if(admin)initUsuarios(perfil);
}
$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();$('#loginErr').textContent='';const b=$('#loginBtn');b.disabled=true;b.textContent='Entrando…';
  let u=$('#lUser').value.trim().toLowerCase();if(u&&!u.includes('@'))u+='@'+DOMINIO;
  const {data,error}=await sb.auth.signInWithPassword({email:u,password:$('#lPass').value});
  b.disabled=false;b.textContent='Entrar';
  if(error){$('#loginErr').textContent='Usuario o clave incorrectos.';return}
  $('#lPass').value='';entrar(data.session);
});
$('#logout').addEventListener('click',async()=>{await sb.auth.signOut();location.reload()});
sb.auth.getSession().then(({data})=>{if(data.session)entrar(data.session);else $('#lUser').focus()});

/* ---------- Permisos por rol: oculto / solo ver / ver y editar ---------- */
const SECCIONES=[
  {g:'Hoy',k:'hoy_resumen',l:'Resumen de arriba (cuadros)',soloVer:true},
  {g:'Hoy',k:'hoy_diarias',l:'Tareas diarias'},
  {g:'Hoy',k:'hoy_semanales',l:'Tareas semanales'},
  {g:'Hoy',k:'hoy_mensuales',l:'Tareas mensuales'},
  {g:'Hoy',k:'hoy_pendientes',l:'Tareas pendientes (Gen, Lean, etc.)'},
  {g:'Hoy',k:'hoy_historico',l:'Histórico de cumplimiento',soloVer:true},
  {g:'Spam y Publicidad',k:'spam_spam',l:'Spam'},
  {g:'Spam y Publicidad',k:'spam_publi',l:'Publicidad'},
  {g:'Cajeros',k:'cajeros_errores',l:'Errores y desempeño'},
  {g:'Cajeros',k:'cajeros_ranking',l:'Ranking e histórico',soloVer:true},
  {g:'Cajeros',k:'cajeros_horarios',l:'Horarios'},
  {g:'Cajeros',k:'cajeros_equipo',l:'Equipo (CBU y sueldos)'},
  {g:'Calendario',k:'cal_juegos',l:'Calendario de juegos'},
  {g:'Calendario',k:'cal_contenido',l:'Calendario de contenido'},
  {g:'Calendario',k:'cal_push',l:'Calendario de push'}];
const ROLES=[{k:'admin',l:'Administrador'},{k:'gerente',l:'Gerente'},{k:'usuario',l:'Usuario'}];
const NIVELES=[{k:'oculto',l:'Oculto'},{k:'ver',l:'Solo ver'},{k:'editar',l:'Ver y editar'}];
function nivelDefault(rol,k){if(k==='cajeros_equipo')return rol==='admin'?'editar':rol==='gerente'?'ver':'oculto';return 'editar'}
let PERMS={},MI_ROL='usuario',MI_ID='';
function nivel(rol,k){const v=(PERMS[rol]||{})[k];if(v===true)return 'editar';if(v===false)return 'oculto';return NIVELES.some(n=>n.k===v)?v:nivelDefault(rol,k)}
// Qué secciones toca una escritura en la base (para bloquear lo que es "solo ver").
function seccionesDe(path,nuevo,viejo){
  nuevo=nuevo||{};viejo=viejo||{};const s=new Set();
  if(path.startsWith('tareas/')){const t=(nuevo.tipo||viejo.tipo);s.add(t==='diaria'?'hoy_diarias':t==='semanal'?'hoy_semanales':'hoy_pendientes')}
  else if(path.startsWith('checks/w-'))s.add('hoy_semanales');
  else if(path.startsWith('checks/'))s.add('hoy_diarias');
  else if(path.startsWith('diario/')){const SP=['bm','celus','clientes','nota'],PB=['gasto','fondeo','mensajes','convertidos','notaPubli','campanas'];
    const cambio=f=>JSON.stringify(nuevo[f])!==JSON.stringify(viejo[f]);if(SP.some(cambio))s.add('spam_spam');if(PB.some(cambio))s.add('spam_publi')}
  else if(path.startsWith('calendario/')){const a=nuevo.dias||{},b=viejo.dias||{};
    new Set([...Object.keys(a),...Object.keys(b)]).forEach(d=>{const x=a[d]||{},y=b[d]||{},eq=(...f)=>f.every(k=>JSON.stringify(x[k])===JSON.stringify(y[k]));
      if(!eq('pendientes'))s.add('hoy_mensuales');if(!eq('juego','horario','juegos','nota'))s.add('cal_juegos');if(!eq('contenido'))s.add('cal_contenido');if(!eq('push'))s.add('cal_push')})}
  else if(path.startsWith('errores/'))s.add('cajeros_errores');
  else if(path==='config/horarios')s.add('cajeros_horarios');
  else if(path==='config/juegos')s.add('cal_juegos');
  else if(path==='config/contenido')s.add('cal_contenido');
  else if(path.startsWith('privado/'))s.add('cajeros_equipo');
  return [...s]}
function puedeEscribir(path,nuevo,viejo){if(path==='config/permisos'||path==='config/responsables')return MI_ROL==='admin';
  // Reportes de trabajo: cada uno escribe solo los suyos (registro/<fecha>_<id>)
  if(path.startsWith('registro/'))return MI_ROL==='admin'||path.endsWith('_'+MI_ID);return seccionesDe(path,nuevo,viejo).every(k=>nivel(MI_ROL,k)==='editar')}
function aplicarPermisos(){
  const rol=MI_ROL;
  document.querySelectorAll('[data-perm]').forEach(el=>{const n=nivel(rol,el.dataset.perm);el.classList.toggle('perm-off',n==='oculto');el.classList.toggle('perm-ro',n==='ver')});
  // Calendario: el formulario sigue al tipo de calendario elegido
  const cm=document.querySelector('.seg[data-seg=cal] button[aria-selected="true"]');const cf=document.getElementById('calForm');
  if(cm&&cf)cf.classList.toggle('perm-ro',nivel(rol,cm.dataset.perm)==='ver');
  // sub-vistas (Spam/Publicidad, Juegos/Contenido): si la elegida está oculta, pasar a la otra
  document.querySelectorAll('.seg[data-seg]').forEach(seg=>{
    const bs=[...seg.querySelectorAll('button[data-perm]')],ok=bs.filter(b=>!b.classList.contains('perm-off'));
    seg.classList.toggle('perm-off',ok.length<2);
    const sel=bs.find(b=>b.getAttribute('aria-selected')==='true');
    if(ok.length&&sel&&sel.classList.contains('perm-off'))ok[0].click()});
  // pestañas sin nada visible se ocultan
  document.querySelectorAll('nav.tabs button[data-tab]').forEach(b=>{const sec=document.getElementById('tab-'+b.dataset.tab);if(!sec||b.dataset.tab==='usuarios')return;
    const items=[...sec.querySelectorAll('[data-perm]')];b.classList.toggle('perm-off',items.length>0&&items.every(x=>x.classList.contains('perm-off')))});
  const act=document.querySelector('nav.tabs button[aria-selected="true"]');
  if(act&&(act.classList.contains('perm-off')||getComputedStyle(act).display==='none')){const f=[...document.querySelectorAll('nav.tabs button[data-tab]')].find(b=>!b.classList.contains('perm-off')&&getComputedStyle(b).display!=='none');if(f)f.click()}
}
function initPermisos(db,perfil){
  MI_ROL=['admin','gerente','usuario'].includes(perfil.rol)?perfil.rol:'usuario';
  MI_ID=perfil.id;
  window.TC.guard=puedeEscribir;
  document.querySelectorAll('.seg[data-seg=cal] button').forEach(b=>b.addEventListener('click',()=>setTimeout(aplicarPermisos)));
  function renderPermTable(){let g='';
    $('#permTable').innerHTML=`<thead><tr><th>Sección</th>${ROLES.map(r=>`<th>${r.l}</th>`).join('')}</tr></thead><tbody>`+SECCIONES.map(s=>{
      const head=s.g!==g?(g=s.g,`<tr class="grp"><td colspan="${ROLES.length+1}">${esc(s.g)}</td></tr>`):'';
      return head+`<tr><td>${esc(s.l)}</td>${ROLES.map(r=>{const v=nivel(r.k,s.k);return `<td><select class="nivel nv-${v}" data-rol="${r.k}" data-k="${s.k}" aria-label="${esc(r.l)}: ${esc(s.l)}">${NIVELES.filter(n=>!(s.soloVer&&n.k==='editar')||v==='editar').map(n=>`<option value="${n.k}" ${n.k===v?'selected':''}>${s.soloVer&&n.k==='editar'?'Ver':n.l}</option>`).join('')}</select></td>`}).join('')}</tr>`}).join('')+'</tbody>'}
  db.doc('config/permisos').onSnapshot(s=>{PERMS=(s.exists&&s.data())||{};aplicarPermisos();if(MI_ROL==='admin'&&!$('#permTable').contains(document.activeElement))renderPermTable()});
  if(MI_ROL!=='admin')return;
  $('#permTable').addEventListener('change',async e=>{const c=e.target;if(!c.dataset.rol)return;
    const next=JSON.parse(JSON.stringify(PERMS));next[c.dataset.rol]=next[c.dataset.rol]||{};next[c.dataset.rol][c.dataset.k]=c.value;c.className='nivel nv-'+c.value;c.blur();
    try{await db.doc('config/permisos').set(next);toast('Permisos guardados')}catch(err){toast('No se pudo guardar. ¿Corriste roles.sql en Supabase?');renderPermTable()}});
  renderPermTable();
}

/* ---------- Usuarios (solo admin) ---------- */
function initUsuarios(yo){
  let lista=[],editId=null;
  async function cargar(){const {data,error}=await sb.from('perfiles').select('*').order('usuario');if(error){toast('No se pudo leer usuarios');return}lista=data;render()}
  async function llamar(body){
    const {data,error}=await sb.functions.invoke('admin-usuarios',{body});
    if(error){let m='No se pudo completar';try{m=(await error.context.json()).error||m}catch(_){}toast(m);return false}
    if(data&&data.error){toast(data.error);return false}return true}
  function mostrarClave(usuario,clave){$('#uNueva').hidden=false;$('#uNueva').innerHTML=`<b>${esc(usuario)}</b> · clave: <code id="uClave">${esc(clave)}</code> <button type="button" class="btn sm" id="uCopy">Copiar</button><div class="note">Pasásela por un canal privado. No se vuelve a mostrar.</div>`;$('#uCopy').onclick=()=>copiar(`Usuario: ${usuario}\nClave: ${clave}`)}
  function render(){
    $('#uTable').innerHTML=`<thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>`+lista.map(u=>{const me=u.id===yo.id;
      if(editId===u.id)return `<tr data-id="${u.id}"><td style="font-family:var(--mono)">${esc(u.usuario)}</td><td><input type="text" class="u-nom" value="${esc(u.nombre)}" style="width:140px" aria-label="Nombre"></td><td><select class="u-rol" ${me?'disabled':''} aria-label="Rol">${[['usuario','Usuario'],['gerente','Gerente'],['admin','Administrador']].map(([k,l])=>`<option value="${k}" ${u.rol===k?'selected':''}>${l}</option>`).join('')}</select></td><td></td><td><button class="btn pri sm" data-a="guardar">Guardar</button> <button class="btn sm" data-a="cancelar">Cancelar</button></td></tr>`;
      return `<tr data-id="${u.id}"><td style="font-family:var(--mono)">${esc(u.usuario)}${me?' <span class="chip acc">vos</span>':''}</td><td>${esc(u.nombre)}</td><td><span class="chip ${u.rol==='admin'?'acc':''}">${({admin:'Administrador',gerente:'Gerente'})[u.rol]||'Usuario'}</span></td><td>${u.activo?'Activo':'<span class="chip bad">Bloqueado</span>'}</td><td>
        <button class="ib" data-a="editar" title="Editar" aria-label="Editar">✎</button>
        <button class="btn sm" data-a="clave">Nueva clave</button>
        ${me?'':`<button class="btn sm" data-a="activo">${u.activo?'Bloquear':'Activar'}</button> <button class="ib del" data-a="borrar" title="Borrar" aria-label="Borrar">×</button>`}</td></tr>`}).join('')+'</tbody>'}
  $('#uTable').addEventListener('click',async e=>{const b=e.target.closest('[data-a]');if(!b)return;const id=b.closest('tr').dataset.id,u=lista.find(x=>x.id===id),a=b.dataset.a;
    if(a==='editar'){editId=id;render();return}
    if(a==='cancelar'){editId=null;render();return}
    if(a==='guardar'){const tr=b.closest('tr');const body={accion:'actualizar',id,nombre:tr.querySelector('.u-nom').value.trim()};const r=tr.querySelector('.u-rol');if(!r.disabled)body.rol=r.value;if(await llamar(body)){editId=null;toast('Usuario actualizado');cargar()}return}
    if(a==='clave'){const c=genClave();if(await llamar({accion:'actualizar',id,password:c})){mostrarClave(u.usuario,c);toast('Clave cambiada')}return}
    if(a==='activo'){if(await llamar({accion:'actualizar',id,activo:!u.activo})){toast(u.activo?'Usuario bloqueado':'Usuario activado');cargar()}return}
    if(a==='borrar'){if(!b.classList.contains('arm')){b.classList.add('arm');b.textContent='¿Borrar?';setTimeout(()=>{b.classList.remove('arm');b.textContent='×'},2500);return}
      if(await llamar({accion:'borrar',id})){toast('Usuario borrado');cargar()}}});
  $('#uGen').onclick=()=>{$('#uPass').value=genClave();$('#uPass').type='text'};
  $('#uForm').addEventListener('submit',async e=>{e.preventDefault();const usuario=$('#uUser').value.trim().toLowerCase(),password=$('#uPass').value;
    if(!usuario||!password){toast('Completá usuario y clave');return}
    const b=$('#uCrear');b.disabled=true;const ok=await llamar({accion:'crear',usuario,password,nombre:$('#uNom').value.trim(),rol:$('#uRol').value});b.disabled=false;
    if(ok){mostrarClave(usuario,password);['#uUser','#uNom','#uPass'].forEach(s=>$(s).value='');$('#uPass').type='password';toast('Usuario creado');cargar()}});
  cargar();
}
})();
