/* =========================================================
   Mi panel (cada programador) y Reportes (jefe).
   - Mi panel: las tareas pendientes de esa persona; por cada una
     escribe qué hizo hoy y cuánto tiempo le llevó, y Guardar.
     Al final del día envía su reporte.
   - Reportes: reporte diario de cada uno, horas por tarea
     (para ver cuánto llevó cada tarea terminada) y horas por persona.
   Datos: registro/<fecha>_<idUsuario> = un reporte por persona por día.
          config/responsables = qué usuario es qué responsable.
   ========================================================= */
(function(){
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const TZ='America/Argentina/Buenos_Aires';
const hoyStr=()=>new Date().toLocaleDateString('en-CA',{timeZone:TZ});
const parse=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return fmt(d)};
const DSEM=['dom','lun','mar','mié','jue','vie','sáb'];
const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const fFecha=s=>{if(!s)return'—';const d=parse(s);return `${DSEM[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`};
const fLarga=s=>{const d=parse(s);return `${['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`};
const fHora=iso=>iso?new Date(iso).toLocaleTimeString('es-AR',{timeZone:TZ,hour:'2-digit',minute:'2-digit'}):'';
const fMin=m=>{m=Math.round(m||0);if(!m)return'0 min';const h=Math.floor(m/60),r=m%60;return h?(r?`${h} h ${r} min`:`${h} h`):`${r} min`};
const fHs=m=>(Math.round((m||0)/6)/10).toLocaleString('es-AR')+' h';
const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const rid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function toast(t){const e=$('#toast');if(!e)return;e.textContent=t;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2200)}
function armed(b,txt){if(b.classList.contains('arm'))return true;b.classList.add('arm');const o=b.textContent;b.textContent=txt||'¿Seguro?';setTimeout(()=>{b.classList.remove('arm');b.textContent=o},2500);return false}
const errTxt=e=>e&&e.code==='invalid_argument'?'No tenés permiso para guardar esto':'No se pudo guardar. Probá de nuevo';

// Cada lista de tareas pertenece a una persona: k = valor guardado en la tarea, p = nombre de la persona
const RLIST=()=>(window.TC.RESP||[]).filter(r=>r.p);
const RESP=()=>RLIST().map(r=>r.k);
const PERSONAS=RESP;
const lbl=k=>{const r=RLIST().find(x=>x.k===k);return r?r.p:k};

let db=null,perfil=null,sb=null,JEFE=false,ADMIN=false;
const T={tareas:[],reg:{},map:{},perfiles:[],ready:{t:false,r:false}};
let miResp=null,pFecha=hoyStr(),rFecha=hoyStr(),rVista='dia',htResp='',htEstado='hecha',abierta=null;
const draft={};   // lo que se está escribiendo en cada tarea (no se pierde si llegan cambios)
let otraDraft={texto:'',h:'',m:''},notaDraft=null;

/* ---------- quién es quién ---------- */
function autoResp(p){const cands=[norm(p.nombre),norm(p.usuario)].filter(Boolean);
  for(const k of PERSONAS()){const n=norm(lbl(k));if(cands.some(c=>c===n||(c.length>=3&&n.length>=3&&(c.startsWith(n)||n.startsWith(c)))))return k}return null}
function respDe(p){const m=T.map[p.id];if(m==='-')return null;return m||autoResp(p)}

/* ---------- datos ---------- */
const regId=(fecha,uid)=>`${fecha}_${uid}`;
const miReg=f=>T.reg[regId(f,perfil.id)]||null;
const tareasDe=k=>T.tareas.filter(t=>t.tipo==='pendiente'&&(t.resp||'General')===k);
// todas las entradas de trabajo, planas
function entradas(){const out=[];for(const r of Object.values(T.reg))(r.items||[]).forEach(it=>out.push(Object.assign({fecha:r.fecha,resp:r.resp,nombre:r.nombre,uid:r.uid},it)));return out}
function aggTarea(id){const es=entradas().filter(e=>e.tarea===id);const dias=new Set(es.map(e=>e.fecha));const fs=[...dias].sort();
  return {min:es.reduce((a,e)=>a+(e.min||0),0),dias:dias.size,desde:fs[0]||null,hasta:fs[fs.length-1]||null,es}}

let cola=Promise.resolve();
function guardarReg(fecha,cambiar){ // una escritura a la vez
  const p=cola.then(async()=>{const id=regId(fecha,perfil.id);const cur=T.reg[id];
    const base=cur?JSON.parse(JSON.stringify(cur)):{uid:perfil.id,usuario:perfil.usuario,nombre:perfil.nombre||perfil.usuario,resp:miResp,fecha,items:[],nota:'',enviado:null};
    base.resp=miResp;base.nombre=perfil.nombre||perfil.usuario;cambiar(base);base.actualizado=new Date().toISOString();
    T.reg[id]=base;renderPanel(true);await db.doc('registro/'+id).set(base)});
  cola=p.catch(()=>{});return p}

/* ---------- MI PANEL ---------- */
function bloqueEnfoque(sec){const a=document.activeElement;return a&&sec.contains(a)&&/^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)}
let pendP=false,pendR=false;
function renderPanel(force){const sec=$('#tab-panel');if(!sec||!miResp||!perfil)return;
  if(!force&&bloqueEnfoque(sec)){pendP=true;return}pendP=false;
  const hoy=hoyStr(),r=miReg(pFecha),items=(r&&r.items)||[];
  const mias=tareasDe(miResp),abiertas=mias.filter(t=>!t.hecha).sort((a,b)=>(a.orden??0)-(b.orden??0));
  const mes=hoy.slice(0,7),hechasMes=mias.filter(t=>t.hecha&&(t.hechaEn||'').startsWith(mes));
  const totDia=items.reduce((a,i)=>a+(i.min||0),0);
  const sem=[];for(let i=6;i>=0;i--){const f=addDays(hoy,-i);const rr=miReg(f);sem.push((rr&&rr.items||[]).reduce((a,x)=>a+(x.min||0),0))}
  const nombre=perfil.nombre||perfil.usuario;
  const tareaHtml=t=>{const a=aggTarea(t.id),dh=draft[t.id]||{},deHoy=items.filter(i=>i.tarea===t.id);
    return `<div class="twk" data-t="${esc(t.id)}">
      <div class="twk-h"><b>${esc(t.texto)}</b><span class="chip ${a.min?'acc':''}" title="Tiempo total cargado en esta tarea">${a.min?`${fMin(a.min)} · ${a.dias} ${a.dias===1?'día':'días'}`:'sin horas aún'}</span></div>
      ${deHoy.length?`<ul class="twk-hoy">${deHoy.map(i=>`<li><b>${fMin(i.min)}</b>${esc(i.texto)}</li>`).join('')}</ul>`:''}
      <textarea data-f="texto" placeholder="¿Qué hiciste ${pFecha===hoy?'hoy':'ese día'} en esta tarea?" aria-label="Qué hiciste">${esc(dh.texto||'')}</textarea>
      <div class="twk-f"><label>Tiempo <input type="number" data-f="h" min="0" max="16" placeholder="0" value="${esc(dh.h||'')}" aria-label="Horas"> h <input type="number" data-f="m" min="0" max="59" step="5" placeholder="0" value="${esc(dh.m||'')}" aria-label="Minutos"> min</label>
        <span class="sp"></span><button type="button" class="btn sm" data-a="terminar" title="Marcar la tarea como terminada">✓ Terminada</button><button type="button" class="btn pri sm" data-a="guardar">Guardar</button></div></div>`};
  const nota=notaDraft!==null?notaDraft:(r&&r.nota)||'';
  sec.innerHTML=`
  <div class="toolbar"><h2 class="sec">Mi panel · ${esc(nombre)}</h2><span class="sp"></span>
    <label class="sub" for="pFecha">Día</label><input type="date" id="pFecha" value="${pFecha}" max="${hoy}"></div>
  <div class="tiles">
    <div class="tile"><div class="k">${pFecha===hoy?'Trabajado hoy':'Trabajado ese día'}</div><div class="v">${fMin(totDia)}</div><div class="h">${items.length} ${items.length===1?'registro':'registros'}</div></div>
    <div class="tile"><div class="k">Últimos 7 días</div><div class="v">${fHs(sem.reduce((a,b)=>a+b,0))}</div><div class="h">${(n=>n===1?'1 día':n+' días')(sem.filter(Boolean).length)} con trabajo</div></div>
    <div class="tile"><div class="k">Tareas abiertas</div><div class="v">${abiertas.length}</div><div class="h">${hechasMes.length} terminadas este mes</div></div>
    <div class="tile"><div class="k">Reporte del día</div><div class="v txt">${r&&r.enviado?'Enviado':'Sin enviar'}</div><div class="h">${r&&r.enviado?'a las '+fHora(r.enviado):'enviálo al terminar'}</div></div>
  </div>
  <div class="calgrid">
    <div>
      <div class="toolbar"><h2 class="sec" style="font-size:1rem">Mis tareas pendientes</h2></div>
      <div id="pTareas">${abiertas.length?abiertas.map(tareaHtml).join(''):`<div class="card"><div class="empty">No tenés tareas pendientes. Cuando te asignen una en “Hoy → Tareas de ${esc(lbl(miResp))}”, aparece acá.</div></div>`}</div>
      <div class="card" style="margin-top:4px"><h2>Otra actividad <small>algo que no está en la lista (reunión, soporte, bug urgente)</small></h2>
        <textarea id="oTexto" placeholder="¿Qué hiciste?" style="width:100%;min-height:50px">${esc(otraDraft.texto)}</textarea>
        <div class="twk-f"><label>Tiempo <input type="number" id="oH" min="0" max="16" placeholder="0" value="${esc(otraDraft.h)}"> h <input type="number" id="oM" min="0" max="59" step="5" placeholder="0" value="${esc(otraDraft.m)}"> min</label><span class="sp"></span><button type="button" class="btn pri sm" id="oGuardar">Guardar</button></div></div>
    </div>
    <div class="card"><h2>Mi reporte del día <small>${fLarga(pFecha)}</small></h2>
      ${items.length?items.map(i=>`<div class="rep-it"><div class="x"><b>${esc(i.titulo||'Otra actividad')}</b><p>${esc(i.texto)}</p></div><span class="tm">${fMin(i.min)}</span><button type="button" class="ib del" data-del="${esc(i.id)}" aria-label="Borrar" title="Borrar">×</button></div>`).join('')
        +`<div class="rep-tot"><span>Total</span><span>${fMin(totDia)}</span></div>`:'<div class="empty">Todavía no cargaste nada. Escribí en cada tarea lo que hiciste y tocá Guardar.</div>'}
      <label class="twl">Comentario general (opcional)<textarea id="pNota" placeholder="Algo que quieras contar: bloqueos, dudas, qué sigue mañana…">${esc(nota)}</textarea></label>
      <div class="twk-f"><span class="sub">${r&&r.enviado?`Enviado a las ${fHora(r.enviado)}${r.actualizado&&r.actualizado>r.enviado?' · con cambios después':''}`:''}</span><span class="sp"></span><button type="button" class="btn pri" id="pEnviar" ${items.length?'':'disabled'}>${r&&r.enviado?'Volver a enviar':'Enviar reporte del día'}</button></div>
      ${terminadasHtml(mias)}
    </div>
  </div>`;
}
function terminadasHtml(mias){const h=mias.filter(t=>t.hecha).sort((a,b)=>(b.hechaEn||'').localeCompare(a.hechaEn||'')).slice(0,5);if(!h.length)return'';
  return `<h2 style="margin-top:18px">Últimas que terminé</h2>`+h.map(t=>{const a=aggTarea(t.id);return `<div class="rep-it"><div class="x"><b>${esc(t.texto)}</b><p>${t.hechaEn?'terminada el '+fFecha(t.hechaEn)+' · ':''}${a.dias} ${a.dias===1?'día':'días'} de trabajo</p></div><span class="tm">${fMin(a.min)}</span></div>`}).join('')}

function leerTiempo(h,m){const hh=Math.max(0,parseFloat(h)||0),mm=Math.max(0,parseInt(m,10)||0);return Math.round(hh*60+mm)}
function initPanelEventos(){const sec=$('#tab-panel');
  sec.addEventListener('input',e=>{const box=e.target.closest('.twk');const f=e.target.dataset.f;
    if(box&&f){(draft[box.dataset.t]=draft[box.dataset.t]||{})[f]=e.target.value;return}
    if(e.target.id==='oTexto')otraDraft.texto=e.target.value;if(e.target.id==='oH')otraDraft.h=e.target.value;if(e.target.id==='oM')otraDraft.m=e.target.value;
    if(e.target.id==='pNota')notaDraft=e.target.value});
  sec.addEventListener('change',e=>{if(e.target.id==='pFecha'){const v=e.target.value;pFecha=v&&v<=hoyStr()?v:hoyStr();notaDraft=null;renderPanel(true)}});
  sec.addEventListener('focusout',()=>setTimeout(()=>{if(pendP&&!bloqueEnfoque(sec))renderPanel()},0));
  sec.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
    const box=b.closest('.twk');
    if(box&&b.dataset.a==='guardar'){const id=box.dataset.t,t=T.tareas.find(x=>x.id===id),d=draft[id]||{};
      const texto=(d.texto||'').trim(),min=leerTiempo(d.h,d.m);
      if(!texto){toast('Escribí qué hiciste');box.querySelector('textarea').focus();return}
      if(!min){toast('Poné cuánto tiempo te llevó');box.querySelector('[data-f=h]').focus();return}
      if(min>16*60){toast('Revisá el tiempo: más de 16 horas');return}
      b.disabled=true;try{await guardarReg(pFecha,r=>r.items.push({id:rid(),tarea:id,titulo:t?t.texto:'',texto,min,hora:new Date().toISOString()}));delete draft[id];renderPanel(true);toast('Guardado: '+fMin(min))}
      catch(err){console.error(err);toast(errTxt(err));b.disabled=false}return}
    if(box&&b.dataset.a==='terminar'){if(!armed(b,'¿Terminada?'))return;const id=box.dataset.t,t=T.tareas.find(x=>x.id===id);if(!t)return;
      const d=draft[id]||{};if((d.texto||'').trim()&&leerTiempo(d.h,d.m)){try{await guardarReg(pFecha,r=>r.items.push({id:rid(),tarea:id,titulo:t.texto,texto:d.texto.trim(),min:leerTiempo(d.h,d.m),hora:new Date().toISOString()}));delete draft[id]}catch(err){toast(errTxt(err));return}}
      try{t.hecha=true;t.hechaEn=pFecha;await db.doc('tareas/'+id).update({hecha:true,hechaEn:pFecha});renderPanel(true);toast('¡Terminada! Total: '+fMin(aggTarea(id).min))}catch(err){t.hecha=false;toast(errTxt(err));renderPanel(true)}return}
    if(b.id==='oGuardar'){const texto=otraDraft.texto.trim(),min=leerTiempo(otraDraft.h,otraDraft.m);if(!texto){toast('Escribí qué hiciste');return}if(!min){toast('Poné cuánto tiempo te llevó');return}
      b.disabled=true;try{await guardarReg(pFecha,r=>r.items.push({id:rid(),tarea:null,titulo:'',texto,min,hora:new Date().toISOString()}));otraDraft={texto:'',h:'',m:''};renderPanel(true);toast('Guardado: '+fMin(min))}catch(err){toast(errTxt(err));b.disabled=false}return}
    if(b.dataset.del){if(!armed(b,'¿Borrar?'))return;const id=b.dataset.del;try{await guardarReg(pFecha,r=>{r.items=r.items.filter(i=>i.id!==id)});toast('Borrado')}catch(err){toast(errTxt(err))}return}
    if(b.id==='pEnviar'){const nota=(notaDraft!==null?notaDraft:(miReg(pFecha)||{}).nota||'').trim();b.disabled=true;
      try{await guardarReg(pFecha,r=>{r.nota=nota;r.enviado=new Date().toISOString()});notaDraft=null;renderPanel(true);toast('Reporte enviado')}catch(err){toast(errTxt(err));b.disabled=false}}
  });
}

/* ---------- REPORTES (jefe) ---------- */
function personasRep(){const set=new Set(PERSONAS());Object.values(T.reg).forEach(r=>r.resp&&set.add(r.resp));return [...set]}
function regsDe(fecha,k){return Object.values(T.reg).filter(r=>r.fecha===fecha&&r.resp===k)}
function renderRep(force){const sec=$('#tab-reportes');if(!sec||!JEFE)return;if(!force&&bloqueEnfoque(sec)){pendR=true;return}pendR=false;
  const vistas=[['dia','Reporte diario'],['tareas','Horas por tarea'],['personas','Horas por persona']];if(ADMIN)vistas.push(['vincular','Vincular usuarios']);
  let body='';
  if(rVista==='dia')body=vistaDia();else if(rVista==='tareas')body=vistaTareas();else if(rVista==='personas')body=vistaPersonas();else body=vistaVincular();
  sec.innerHTML=`<div class="seg" data-rseg role="tablist">${vistas.map(([v,l])=>`<button type="button" data-rv="${v}" aria-selected="${v===rVista}">${l}</button>`).join('')}</div>${body}`}

function vistaDia(){const hoy=hoyStr(),ps=personasRep();let tot=0,env=0,con=0;
  const cards=ps.map(k=>{const rs=regsDe(rFecha,k);const items=rs.flatMap(r=>r.items||[]);const min=items.reduce((a,i)=>a+(i.min||0),0);tot+=min;if(items.length)con++;const en=rs.find(r=>r.enviado);if(en)env++;
    const nota=rs.map(r=>r.nota).filter(Boolean).join('\n');
    const estado=en?`<span class="chip ok">Enviado ${fHora(en.enviado)}</span>`:items.length?'<span class="chip">Sin enviar</span>':'<span class="chip bad">Sin reporte</span>';
    return `<div class="card"><h2><span><span class="resp-tag"></span>${esc(lbl(k))}</span>${estado}</h2>
      ${items.length?items.map(i=>`<div class="rep-it"><div class="x"><b>${esc(i.titulo||'Otra actividad')}</b><p>${esc(i.texto)}</p></div><span class="tm">${fMin(i.min)}</span></div>`).join('')+`<div class="rep-tot"><span>Total del día</span><span>${fMin(min)}</span></div>`:'<div class="empty">No cargó nada este día.</div>'}
      ${nota?`<div class="note" style="white-space:pre-wrap;color:var(--fg)"><b style="color:var(--muted)">Comentario:</b> ${esc(nota)}</div>`:''}</div>`}).join('');
  return `<div class="toolbar"><h2 class="sec">${fLarga(rFecha)}</h2><span class="sp"></span>
    <button type="button" class="ib" data-rd="-1" aria-label="Día anterior">‹</button><input type="date" id="rFecha" value="${rFecha}" max="${hoy}"><button type="button" class="ib" data-rd="1" aria-label="Día siguiente" ${rFecha>=hoy?'disabled':''}>›</button>
    ${rFecha!==hoy?'<button type="button" class="btn sm" data-rd="0">Hoy</button>':''}</div>
  <div class="tiles"><div class="tile"><div class="k">Horas del equipo</div><div class="v">${fHs(tot)}</div><div class="h">sumando a todos</div></div>
    <div class="tile"><div class="k">Cargaron trabajo</div><div class="v">${con}/${ps.length}</div><div class="h">personas</div></div>
    <div class="tile"><div class="k">Reportes enviados</div><div class="v">${env}/${ps.length}</div><div class="h">${rFecha===hoy?'el día todavía no terminó':'&nbsp;'}</div></div></div>
  <div class="grid">${cards||'<div class="empty">No hay responsables cargados.</div>'}</div>`}

function vistaTareas(){const ps=personasRep();
  let filas=T.tareas.filter(t=>t.tipo==='pendiente').map(t=>Object.assign({t},aggTarea(t.id)));
  // entradas de tareas que ya se borraron
  const vivas=new Set(T.tareas.map(t=>t.id));const borr={};entradas().forEach(e=>{if(e.tarea&&!vivas.has(e.tarea)){(borr[e.tarea]=borr[e.tarea]||{t:{id:e.tarea,texto:e.titulo||'(tarea borrada)',resp:e.resp,hecha:true,borrada:true},es:[]}).es.push(e)}});
  Object.values(borr).forEach(b=>{const fs=[...new Set(b.es.map(e=>e.fecha))].sort();filas.push({t:b.t,es:b.es,min:b.es.reduce((a,e)=>a+(e.min||0),0),dias:fs.length,desde:fs[0],hasta:fs[fs.length-1]})});
  if(htResp)filas=filas.filter(f=>(f.t.resp||'General')===htResp);
  if(htEstado==='hecha')filas=filas.filter(f=>f.t.hecha);else if(htEstado==='abierta')filas=filas.filter(f=>!f.t.hecha);
  filas.sort((a,b)=>b.min-a.min||String(a.t.texto).localeCompare(b.t.texto));
  const conH=filas.filter(f=>f.min),tot=conH.reduce((a,f)=>a+f.min,0),prom=conH.length?tot/conH.length:0;
  const otras=entradas().filter(e=>!e.tarea&&(!htResp||e.resp===htResp)).reduce((a,e)=>a+(e.min||0),0);
  return `<div class="toolbar"><h2 class="sec">Horas por tarea</h2><span class="sp"></span>
    <select id="htResp" aria-label="Responsable"><option value="">Todos</option>${[...new Set([...ps,...RESP()])].map(k=>`<option value="${esc(k)}" ${k===htResp?'selected':''}>${esc(lbl(k))}</option>`).join('')}</select>
    <select id="htEstado" aria-label="Estado"><option value="hecha" ${htEstado==='hecha'?'selected':''}>Terminadas</option><option value="abierta" ${htEstado==='abierta'?'selected':''}>En curso</option><option value="todas" ${htEstado==='todas'?'selected':''}>Todas</option></select></div>
  <div class="tiles"><div class="tile"><div class="k">Tareas con horas</div><div class="v">${conH.length}</div><div class="h">de ${filas.length} en la lista</div></div>
    <div class="tile"><div class="k">Tiempo total</div><div class="v">${fHs(tot)}</div><div class="h">en estas tareas</div></div>
    <div class="tile"><div class="k">Promedio por tarea</div><div class="v">${fMin(prom)}</div><div class="h">sirve para comparar</div></div>
    <div class="tile"><div class="k">Otras actividades</div><div class="v">${fHs(otras)}</div><div class="h">fuera de la lista de tareas</div></div></div>
  <div class="card"><div class="tablewrap"><table><thead><tr><th>Tarea</th><th>Responsable</th><th>Estado</th><th style="text-align:right">Tiempo total</th><th style="text-align:right">Días</th><th style="text-align:right">Prom. por día</th><th>Empezó</th><th>Terminó</th><th></th></tr></thead><tbody>
  ${filas.length?filas.map(f=>{const t=f.t,open=abierta===t.id,vs=prom&&f.min?f.min/prom:0;
    const flag=vs>=2?'<span class="chip bad" title="Llevó el doble o más que el promedio">lenta</span>':'';
    return `<tr class="click" data-ht="${esc(t.id)}"><td class="wrap"><b>${esc(t.texto)}</b> ${flag}</td><td>${esc(lbl(t.resp||'General'))}</td><td>${t.borrada?'<span class="chip">borrada</span>':t.hecha?'<span class="chip ok">Terminada</span>':'<span class="chip acc">En curso</span>'}</td>
      <td class="n"><b>${fMin(f.min)}</b></td><td class="n">${f.dias}</td><td class="n">${f.dias?fMin(f.min/f.dias):'—'}</td><td>${fFecha(f.desde)}</td><td>${t.hecha?fFecha(t.hechaEn||f.hasta):'—'}</td><td>${f.es.length?(open?'▲':'▼'):''}</td></tr>
      ${open&&f.es.length?`<tr class="det"><td colspan="9">${[...f.es].sort((a,b)=>a.fecha.localeCompare(b.fecha)).map(e=>`<div class="rep-it"><span class="sub" style="min-width:70px">${fFecha(e.fecha)}</span><div class="x"><p style="color:var(--fg)">${esc(e.texto)}</p><p>${esc(e.nombre||lbl(e.resp)||'')}</p></div><span class="tm">${fMin(e.min)}</span></div>`).join('')}</td></tr>`:''}`}).join('')
   :`<tr><td colspan="9" class="empty">${htEstado==='hecha'?'Todavía no hay tareas terminadas con este filtro.':'No hay tareas con este filtro.'}</td></tr>`}
  </tbody></table></div><div class="note">Tocá una tarea para ver día por día qué se hizo. “Lenta” = llevó el doble o más que el promedio de las tareas de la lista.</div></div>`}

function vistaPersonas(){const hoy=hoyStr(),ps=personasRep(),dias=[];for(let i=13;i>=0;i--)dias.push(addDays(hoy,-i));
  const min=(k,f)=>regsDe(f,k).flatMap(r=>r.items||[]).reduce((a,i)=>a+(i.min||0),0);
  const env=(k,f)=>regsDe(f,k).some(r=>r.enviado);
  const cls=m=>!m?'h0':m<180?'h1':m<360?'h2':'h3';
  return `<div class="toolbar"><h2 class="sec">Horas por persona · últimos 14 días</h2></div>
  <div class="card"><div class="tablewrap"><table><thead><tr><th>Persona</th>${dias.map(f=>`<th class="heat">${fFecha(f).replace(' ','<br>')}</th>`).join('')}<th style="text-align:right">Total</th><th style="text-align:right">Prom./día trabajado</th><th style="text-align:right">Enviados</th></tr></thead><tbody>
  ${ps.map(k=>{const v=dias.map(f=>min(k,f)),t=v.reduce((a,b)=>a+b,0),d=v.filter(Boolean).length,e=dias.filter(f=>env(k,f)).length;
    return `<tr><td><b>${esc(lbl(k))}</b></td>${v.map((m,i)=>`<td class="heat ${cls(m)}" title="${fFecha(dias[i])}: ${fMin(m)}">${m?(Math.round(m/6)/10).toLocaleString('es-AR'):'·'}</td>`).join('')}<td class="n"><b>${fHs(t)}</b></td><td class="n">${d?fMin(t/d):'—'}</td><td class="n">${e}/${d||0}</td></tr>`}).join('')}
  </tbody></table></div><div class="note">Números en horas. Más oscuro = más horas ese día. Como trabajan en horario libre, importa más el total y que reporten, no a qué hora.</div></div>`}

function vistaVincular(){const ops=PERSONAS();
  return `<div class="toolbar"><h2 class="sec">Vincular usuarios con responsables</h2></div>
  <div class="card"><div class="tablewrap"><table><thead><tr><th>Usuario</th><th>Nombre</th><th>Ve el panel de</th></tr></thead><tbody>
  ${T.perfiles.length?T.perfiles.map(p=>{const m=T.map[p.id],a=autoResp(p);
    return `<tr><td style="font-family:var(--mono)">${esc(p.usuario)}</td><td>${esc(p.nombre)}</td><td><select data-vinc="${esc(p.id)}" aria-label="Responsable de ${esc(p.usuario)}">
      <option value="" ${!m?'selected':''}>Automático${a?' ('+esc(lbl(a))+')':' (ninguno)'}</option>${ops.map(k=>`<option value="${esc(k)}" ${m===k?'selected':''}>${esc(lbl(k))}</option>`).join('')}<option value="-" ${m==='-'?'selected':''}>Ninguno (sin panel)</option></select></td></tr>`}).join('')
   :'<tr><td colspan="3" class="empty">Cargando usuarios…</td></tr>'}
  </tbody></table></div><div class="note">“Automático” une por nombre o usuario (por ejemplo “Genesis” → Gen). Si no aparece bien, elegilo a mano. Para que Paul y Diego entren, creales el acceso en <b>Usuarios</b>.</div></div>`}

function initRepEventos(){const sec=$('#tab-reportes');
  sec.addEventListener('click',e=>{const b=e.target.closest('button,tr[data-ht]');if(!b)return;
    if(b.dataset.rv){rVista=b.dataset.rv;abierta=null;renderRep(true);if(rVista==='vincular')cargarPerfiles();return}
    if(b.dataset.rd!==undefined){const n=Number(b.dataset.rd);rFecha=n===0?hoyStr():addDays(rFecha,n);if(rFecha>hoyStr())rFecha=hoyStr();renderRep(true);return}
    if(b.dataset.ht){abierta=abierta===b.dataset.ht?null:b.dataset.ht;renderRep(true)}});
  sec.addEventListener('change',async e=>{const c=e.target;
    if(c.id==='rFecha'){rFecha=c.value&&c.value<=hoyStr()?c.value:hoyStr();c.blur();renderRep(true);return}
    if(c.id==='htResp'){htResp=c.value;c.blur();renderRep(true);return}
    if(c.id==='htEstado'){htEstado=c.value;c.blur();renderRep(true);return}
    if(c.dataset.vinc){const map=Object.assign({},T.map);if(c.value)map[c.dataset.vinc]=c.value;else delete map[c.dataset.vinc];c.blur();
      try{await db.doc('config/responsables').set({map});toast('Guardado')}catch(err){toast(errTxt(err));renderRep(true)}}});
  sec.addEventListener('focusout',()=>setTimeout(()=>{if(pendR&&!bloqueEnfoque(sec))renderRep()},0));
}
async function cargarPerfiles(){if(!ADMIN||!sb)return;const {data,error}=await sb.from('perfiles').select('id,usuario,nombre,rol,activo').order('usuario');if(!error){T.perfiles=data||[];renderRep(true)}}

/* ---------- pestañas ---------- */
function mostrarPestanas(){const bp=document.querySelector('nav.tabs [data-tab=panel]'),br=document.querySelector('nav.tabs [data-tab=reportes]');
  bp.classList.toggle('tw-off',!miResp);br.classList.toggle('tw-off',!JEFE);
  const act=document.querySelector('nav.tabs button[aria-selected="true"]');
  if(act&&act.classList.contains('tw-off')){const f=[...document.querySelectorAll('nav.tabs button[data-tab]')].find(b=>getComputedStyle(b).display!=='none');if(f)f.click()}}
function render(){const nuevo=perfil?respDe(perfil):null;if(nuevo!==miResp){miResp=nuevo;mostrarPestanas()}renderPanel();renderRep()}

(async()=>{
  const ctx=await window.TC.ready;db=ctx.db;perfil=ctx.perfil;sb=ctx.sb;if(!db||!perfil)return;
  ADMIN=perfil.rol==='admin';JEFE=ADMIN||perfil.rol==='gerente';
  initPanelEventos();initRepEventos();
  let primeraVez=true;
  db.doc('config/responsables').onSnapshot(s=>{T.map=(s.exists&&s.data().map)||{};render();
    // Un programador entra directo a su panel la primera vez
    if(primeraVez){primeraVez=false;let guardada=null;try{guardada=localStorage.getItem('tab')}catch(e){}
      if(miResp&&!JEFE&&(!guardada||guardada==='hoy')){const b=document.querySelector('nav.tabs [data-tab=panel]');if(b)b.click()}}});
  db.collection('tareas').onSnapshot(s=>{T.tareas=s.docs.map(d=>Object.assign({id:d.id},d.data()));render()});
  db.collection('registro').onSnapshot(s=>{const o={};s.docs.forEach(d=>o[d.id]=d.data());T.reg=o;render()});
  if(ADMIN)cargarPerfiles();
  mostrarPestanas();
})();
})();
