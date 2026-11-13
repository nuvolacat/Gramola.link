#!/usr/bin/env python3
"""Monta la pantalla de la tele a partir del diseño original, sin tocar su aspecto.

Lee  diseno/Gramola TV.dc.html  (el prototipo tal cual sale de la herramienta de diseño)
y escribe web/app/index.html con unos enganches mínimos a web/tv/gramola-bridge.js, que es quien pone
lo real: sala y móviles, canciones UltraStar, audio, voz, récords, ajustes, calibración y avisos.

Cuando llegue una versión nueva del diseño: copiarla en diseno/ y volver a ejecutar
    python3 tools/build-tv.py
Si algún enganche ya no encaja (porque el diseño cambió ese trozo de código), el script se para y dice cuál.
"""
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'diseno' / 'Gramola TV.dc.html'
OUT = ROOT / 'web' / 'app' / 'index.html'
TV = ROOT / 'web' / 'tv'

s = SRC.read_text(encoding='utf-8')
fails = []


def sub(old, new, regex=False, count=1, name=None):
    """Sustituye exactamente `count` apariciones (0 = todas, al menos una)."""
    global s
    if regex:
        found = len(re.findall(old, s, flags=re.S))
        if not found or (count and found < count):
            fails.append(name or old[:70]); return
        s = re.sub(old, new, s, count=count or 0, flags=re.S)
    else:
        found = s.count(old)
        if not found or (count and found < count):
            fails.append(name or old[:70]); return
        s = s.replace(old, new, count if count else -1)


# --- datos simulados → datos reales del puente (mismos arrays, contenido real)
sub(r"const PLAYERS=\[\[.*?\]\];", "const PLAYERS=GR.PLAYERS;", regex=True, name='PLAYERS')
sub(r"const SONGS=\[\n.*?\];\nSONGS\.forEach\(\(s,i\)=>s\.genre=\[.*?\]\[i\]\);", "const SONGS=GR.SONGS;", regex=True, name='SONGS')
sub(r"LANGS=\['Todos'.*?\],DECS=\['Todas'.*?\],GENS=\['Todos'.*?\];", "LANGS=GR.LANGS,DECS=GR.DECS,GENS=GR.GENS;", regex=True, name='filtros')
sub(r"const REC2=\[\[.*?\]\];", "const REC2=GR.REC2;", regex=True, name='REC2')
sub(r"const REC3=\[\[.*?\]\];", "const REC3=GR.REC3;", regex=True, name='REC3')
sub("const ERRS={", "const ERRS_D={", name='ERRS')
sub("class Component extends DCLogic {",
    "const ERRS=new Proxy(ERRS_D,{get:(o,k)=>Array.isArray(o[k])?o[k].map(t=>GR.errText(k,t)):o[k]});\nclass Component extends DCLogic {", name='ERRS proxy')
sub("{'60':1960,'80':1980,'90':1990,'00':2000,'10':2010}[DECS[s.dec]]", "GR.decadeStart(DECS[s.dec])", name='décadas')

# --- estado inicial: sin jugadores de mentira, sala real, ajustes guardados
sub("room:'MOKA'", "room:GR.room||'····'", name='sala')
sub("count:this.props.lobbyPlayers??4", "count:0", name='count')
sub("settings:{diff:1,delay:110,music:8,fx:6,trail:this.props.showTrail===false?0:1,lyr:0,lang:0}",
    "settings:GR.loadSettings({diff:1,delay:110,music:8,fx:6,trail:1,lyr:0,lang:0})", name='ajustes')
sub("jq:[1,2,3,4],settings", "jq:[],settings", name='cola jukebox')
sub("componentDidUpdate(prev,ps){if(ps&&ps.screen!==this.state.screen&&!this.trVia&&this.state.tr!=='pre')this.enter();if(prev.lobbyPlayers!==this.props.lobbyPlayers&&this.props.lobbyPlayers!=null)this.setState({count:this.props.lobbyPlayers});",
    "componentDidUpdate(prev,ps){if(ps&&ps.screen!==this.state.screen&&!this.trVia&&this.state.tr!=='pre')this.enter();", name='lobbyPlayers')

# --- bucle: el puente mira cada fotograma (música, avances, estado para los móviles, avisos)
sub("this.pollPad(ts);\n", "this.pollPad(ts);GR.tick(this,ts);\n", name='tick')
# --- mando: la tele (LG) convierte la cruceta y algunos botones en teclas Y el navegador también ve el mando;
#     sin esto cada pulsación contaba dos veces. GR.inAct descarta el duplicado y desde entonces ese botón va por teclas.
sub("if(!this.padKeys)for(const i in PAD_MAP){if(B[i]&&!pv[i]&&!(i>=12))this.act(PAD_MAP[i]);}",
    "if(!this.padKeys)for(const i in PAD_MAP){if(B[i]&&!pv[i]&&!(i>=12)&&GR.inAct(this,PAD_MAP[i],'pad'))this.act(PAD_MAP[i]);}", name='pad-botones')
sub("const d=dp!=null?(this.padKeys?null:PAD_MAP[dp]):st;\n    if(d){if(this.holdDir!==d){this.holdDir=d;this.holdT=ts+380;this.act(d);}else if(ts>this.holdT){this.holdT=ts+110;this.act(d);}}else this.holdDir=null;",
    "const d=dp!=null?(this.padKeys?null:PAD_MAP[dp]):st;const ds=dp!=null?'pad':'stick';\n    if(d){if(this.holdDir!==d){this.holdDir=d;this.holdT=ts+380;if(GR.inAct(this,d,ds))this.act(d);}else if(ts>this.holdT){this.holdT=ts+110;if(GR.inAct(this,d,ds))this.act(d);}}else this.holdDir=null;", name='pad-direcciones')
sub("if(e.key.startsWith('Gamepad'))this.padKeys=true;this.act(a);}",
    "if(e.key.startsWith('Gamepad'))this.padKeys=true;if(GR.inAct(this,a,'key'))this.act(a);}", name='teclas-dedupe')
sub("const k=Math.max(0,Math.min(1,(ts-this.bootT)/2600));", "const k=GR.bootK(ts,this.bootT);", name='arranque')

# --- sala real
sub("qrRef=el=>{if(!el||el._d)return;", "qrRef=el=>{if(GR.qr(el))return;if(!el||el._d)return;", name='QR')
sub("errAct(){const e=this.state.err;", "errAct(){if(GR.errAct)return GR.errAct(this);const e=this.state.err;", name='avisos')
sub("isOff(i){return this.state.count===8&&i===6;}", "isOff(i){return GR.isOff(i);}", name='isOff')
sub("addPlayer(){", "addPlayer(){return GR.addBot(this);", name='Y simular jugador')
sub("else if(a==='rem')this.setState({count:Math.max(0,s.count-1)});", "else if(a==='rem')GR.kickLast(this);", name='quitar jugador')
sub(r"else if\(r\.k==='kick'\)\{.*?this\.setState\(\{count:s\.count-1\}\);\}", "else if(r.k==='kick'){GR.kickLast(this);}", regex=True, name='expulsar')
sub(r"else\{const L='ABCDEFGHJKLMNPRSTUVXYZ';.*?entrar'\);\}", "else{GR.newCode(this);}", regex=True, name='nuevo código')
sub("return {name:PLAYERS[i][0],color:PLAYERS[i][1],shape:PLAYERS[i][2],tol:", "return {id:PLAYERS[i][3],bot:PLAYERS[i][4],name:PLAYERS[i][0],color:PLAYERS[i][1],shape:PLAYERS[i][2],tol:", name='cantantes')
sub("singers:[{name:P0[0],color:P0[1],shape:P0[2],", "singers:[{id:P0[3],bot:P0[4],name:P0[0],color:P0[1],shape:P0[2],", name='turno pasa el micro')

# --- canción real: partitura UltraStar, audio, voz de los móviles y reloj de la canción
sub("function buildChart(skills,duo){", "function buildChart(skills,duo){if(GR.chartFor)return GR.chartFor(skills,duo);", name='partitura')
sub("update(dt){if(this.state.paused)return;", "update(dt){return GR.update(this,dt);if(this.state.paused)return;", name='update')
sub("py(p,L){return L.y+L.h-56-(p/12)*(L.h-112);}", "py(p,L){return L.y+L.h-56-(p/((this.chart&&this.chart.range)||12))*(L.h-112);}", name='altura de notas')
sub("this.props.videoUrl", "GR.videoUrl(this)", count=0, name='vídeo')
sub("this.chart=null;this.showResults(rows,rows[0].score>recN", "GR.saveRecord(this,rows);this.chart=null;this.showResults(rows,rows[0].score>recN", name='récords')
sub("this.setState({mode:'jukebox',songSel:0,singers:[],jq:[1,2,3,4]},()=>this.startSing())",
    "this.go('songs',{zone:'grid',mode:'jukebox',songF:0})", name='jukebox: elige canción')
sub("beats(phase){", "beats(phase){return GR.beats(this,phase);", name='calibración')

# --- videoclip con sus colores originales (decisión del usuario, 01-nov-2026), sin bucle: lo sincroniza el puente
sub("loop:true,playsInline:true,style:{position:'absolute',inset:0,width:1920,height:1080,objectFit:'cover',filter:'grayscale(1) contrast(1.08)'}",
    "loop:false,playsInline:true,'data-gramola':'videoclip',style:{position:'absolute',inset:0,width:1920,height:1080,objectFit:'cover'}", name='vídeo en color')
sub("Videoclip de la canción · en blanco y negro", "Videoclip de la canción", count=0, name='rótulo del vídeo')

# --- rendimiento en teles (01-nov-2026, medido en una tele: 26-32 fps en el canto)
# Marcadores de la interfaz: 2 veces por segundo en lugar de 10 (la puntuación grande va en el lienzo)
sub("hud+=dt;if(hud>0.1&&this.chart){hud=0;", "hud+=dt;if(hud>(GR.hudEvery||0.1)&&this.chart){hud=0;", name='marcadores cada 0,5 s')
# Fondo: no repintarlo cuando está tapado (vídeo) o a menos fps si es la animación lenta
sub("drawBg(c,dt){const sc=this.state.screen;", "drawBg(c,dt){if(GR.skipBg&&GR.skipBg(this))return;const sc=this.state.screen;", name='fondo ligero')

# --- mando de la tele: «Pulsa OK para continuar» (no «A»), con el glifo OK del diseño
sub("fontSize:32,fontWeight:800}},'A'),h('span',null,'para continuar')", "fontSize:26,fontWeight:800}},'OK'),h('span',null,'para continuar')", name='Pulsa OK')

# --- Ajustes sin la opción de idioma (la app solo va en castellano)
sub("{k:'lang',label:'Idioma',type:'seg',opts:['Castellano','Català'],help:'Idioma de la interfaz en la tele y en los móviles.'},", "", name='sin idioma en Ajustes')

# --- letra centrada en pantalla (el diseño la alinea a la izquierda); nunca empieza antes de x0
sub("const base=C.bg,dim=C.n5,fill=C.red5;", "const base=C.bg,dim=C.n5,fill=C.red5;const cx=w=>Math.max(x0,960-w/2);", name='letra: centro')
sub("c.fillText('Sin letra. De memoria.',x0,y1);c.restore();return;}const ch=this.chart",
    "c.fillText('Sin letra. De memoria.',Math.max(x0,960-c.measureText('Sin letra. De memoria.').width/2),y1);c.restore();return;}const ch=this.chart", name='letra: sin letra')
sub("c.fillText('Canta la Parte '+(2-part),x0,y1);c.font='400 '+s2+'px Archivo';c.fillText(cur.notes.map(n=>n.s).join(''),x0,y2);",
    "{const t1='Canta la Parte '+(2-part);c.fillText(t1,cx(c.measureText(t1).width),y1);}c.font='400 '+s2+'px Archivo';{const t2=cur.notes.map(n=>n.s).join('');c.fillText(t2,cx(c.measureText(t2).width),y2);}", name='letra: canta la parte')
sub("c.fillText('Interludio musical',x0,y1);\n      const k=(now-prevEnd)/(cur.start-prevEnd);c.fillStyle='rgba(243,242,242,0.2)';c.fillRect(x0,y2-16,560,8);c.fillStyle=base;c.fillRect(x0,y2-16,560*k,8);",
    "{const it=GR.interText(this,cur);c.font=(it==='Interludio musical'?'300 ':'600 ')+s1+'px Archivo';c.fillText(it,cx(c.measureText(it).width),y1);}\n      const k=(now-prevEnd)/(cur.start-prevEnd),bx=cx(560);c.fillStyle='rgba(243,242,242,0.2)';c.fillRect(bx,y2-16,560,8);c.fillStyle=base;c.fillRect(bx,y2-16,560*k,8);", name='letra: interludio')
sub("let x=x0;if(joint){c.font='800 '+Math.round(s1*0.55)+'px Archivo';const tw=c.measureText('Juntos').width;c.fillStyle=C.red;c.fillRect(x0,y1-s1*0.62,tw+24,s1*0.78);c.fillStyle='#fff';c.fillText('Juntos',x0+12,y1-s1*0.06);x+=tw+40;}",
    "let x=x0;{let tw0=0;if(joint){c.font='800 '+Math.round(s1*0.55)+'px Archivo';tw0+=c.measureText('Juntos').width+40;}cur.notes.forEach(n=>{c.font=(n.type==='free'?'italic 400 ':'800 ')+s1+'px Archivo';tw0+=c.measureText(n.s).width;});{const mw=1920-2*x0;if(tw0>mw){s1=Math.floor(s1*mw/tw0);tw0=mw;}}x=cx(tw0);}const jx=x;{const k=GR.leadK(now,PH,ci);if(k)GR.leadBar(c,joint?jx:GR.inkLeft(c,cur.notes,jx,s1,'800 '),y1-s1*0.36,Math.round(s1*0.74),fill,k,jx-50);}if(joint){c.font='800 '+Math.round(s1*0.55)+'px Archivo';const tw=c.measureText('Juntos').width;c.fillStyle=C.red;c.fillRect(jx,y1-s1*0.62,tw+24,s1*0.78);c.fillStyle='#fff';c.fillText('Juntos',jx+12,y1-s1*0.06);x+=tw+40;}", name='letra: frase')
sub("if(nx){c.font='400 '+s2+'px Archivo';c.fillStyle=dim;c.fillText(nx.notes.map(n=>n.s).join(''),x0,y2);}",
    "if(nx){c.font='400 '+s2+'px Archivo';c.fillStyle=dim;const t3=nx.notes.map(n=>n.s).join('');{const w3=c.measureText(t3).width,mw=1920-2*x0;if(w3>mw)c.font='400 '+Math.floor(s2*mw/w3)+'px Archivo';}c.fillText(t3,cx(c.measureText(t3).width),y2);}", name='letra: siguiente')
# (pantalla con cámara)
sub("const s1=Math.round(56*(this.state.settings.lyr?1.12:1)),s2=38,y1=yc+4,y2=yc+56,maxW=1824-x0;",
    "const s1=Math.round(56*(this.state.settings.lyr?1.12:1)),s2=38,y1=yc+4,y2=yc+56,maxW=1824-x0;const cx=w=>Math.max(x0,960-w/2);let lx=x0;", name='letra C: centro')
sub("const S=Math.floor(size*Math.min(1,maxW/tw));let x=x0;", "const S=Math.floor(size*Math.min(1,maxW/tw));let x=cx(tw*S/size);if(size===s1)lx=x;", name='letra C: frases')
sub("c.fillText('Sin letra. De memoria.',x0,y1-s1/2+20);", "c.fillText('Sin letra. De memoria.',cx(c.measureText('Sin letra. De memoria.').width),y1-s1/2+20);", name='letra C: sin letra')
sub("c.fillText('Canta la Parte '+(2-part),x0,yA);c.font='400 '+s2+'px Archivo';c.fillStyle='rgba(243,242,242,0.55)';c.fillText(sep(cur.notes).map(p=>p.pre+p.txt).join(''),x0,yA+50);",
    "{const t1='Canta la Parte '+(2-part);c.fillText(t1,cx(c.measureText(t1).width),yA);}c.font='400 '+s2+'px Archivo';c.fillStyle='rgba(243,242,242,0.55)';{const t2=sep(cur.notes).map(p=>p.pre+p.txt).join('');c.fillText(t2,cx(c.measureText(t2).width),yA+50);}", name='letra C: canta la parte')
sub("c.fillText('Interludio musical',x0,yA);const k=(now-prevEnd)/(cur.start-prevEnd);c.fillStyle='rgba(243,242,242,0.2)';c.fillRect(x0,yA+30,560,8);c.fillStyle='#f3f2f2';c.fillRect(x0,yA+30,560*k,8);",
    "c.fillText('Interludio musical',cx(c.measureText('Interludio musical').width),yA);const k=(now-prevEnd)/(cur.start-prevEnd),bx=cx(560);c.fillStyle='rgba(243,242,242,0.2)';c.fillRect(bx,yA+30,560,8);c.fillStyle='#f3f2f2';c.fillRect(bx,yA+30,560*k,8);", name='letra C: interludio')

# --- cambio de frase de la letra: si la siguiente empieza pronto, entra en cuanto acaba la anterior (sin los 0,35 s
# de espera), para que la barra de aproximación siempre tenga tiempo de recorrer
sub("const ci=PH.findIndex(p=>p.end+0.35>now);", "const ci=GR.lyrIdx(PH,now);", count=2, name='cambio de frase')

# --- barra de aproximación (como en los karaokes clásicos): en la intro y tras un interludio, una barra a la izquierda
# de la frase se va acortando hasta llegar a la letra justo cuando hay que cantar
sub("    if(nx){line(nx.notes,s2,'400',", "    {const k=GR.leadK(now,PH,ci);if(k)GR.leadBar(c,GR.inkLeft(c,cur.notes,lx,s1,'600 '),yA-s1*0.36,Math.round(s1*0.74),col,k,lx-50);}\n    if(nx){line(nx.notes,s2,'400',", name='barra de aproximación C')

# --- canto siempre con el fondo claro (variante A) y sin el selector de fondos (tecla V)
sub("variant(){return this.state.variant??this.props.singVariant??'C';}", "variant(){return 'A';}", name='fondo claro fijo')
sub("toggleVariant=()=>this.setState({variant:{A:'B',B:'C',C:'A'}[this.variant()]});", "toggleVariant=()=>{};", name='sin cambio de fondo')
sub('<div onClick="{{ onToggleVariant }}" style="position:absolute;right:96px;display:flex;', '<div onClick="{{ onToggleVariant }}" style="display:none;position:absolute;right:96px;', name='sin selector de fondo')

# --- en la sala (pantalla del QR), Atrás vuelve a la bienvenida
sub("if(s.screen==='lobby'){if(a==='ok')this.onStartFn();else if(a==='add')this.addPlayer();else if(a==='rem')GR.kickLast(this);}",
    "if(s.screen==='lobby'){if(a==='ok')this.onStartFn();else if(a==='add')this.addPlayer();else if(a==='rem')GR.kickLast(this);else if(a==='back')this.go('welcome');}", name='sala: atrás a bienvenida')

# --- relleno de la letra: las sílabas en cursiva (notas libres) sobresalen de su ancho; se amplía el recorte
sub("if(pr>0){c.save();c.beginPath();c.rect(x,y1-s1,w*pr,s1*1.4);c.clip();",
    "if(pr>0){c.save();c.beginPath();{const ov=n.type==='free'?s1*0.22:0;c.rect(x-ov*0.4,y1-s1,(w+ov*1.4)*pr,s1*1.4);}c.clip();", name='relleno de la cursiva')

# --- sin modo Dúo (no hay canciones a dos voces): su hueco en el menú es ahora el Megamix; sin el filtro «Solo dúos»
sub("['Dúo','A dos voces','Canciones a dos voces: cada uno canta su parte.'],", "['Megamix','Estribillos','El estribillo de 4, 6 u 8 canciones, seguidas y sin parar.'],", name='menú: Megamix')
sub("menuAct(i){if(i<=2){const mode=['sing','duel','duo'][i];", "menuAct(i){if(i===2){GR.megaOpen(this);return;}if(i<=2){const mode=['sing','duel','duo'][i];", name='menú: abrir Megamix')
sub("const FILTERS=['Orden','Idioma','Década','Género','Solo dúos'];", "const FILTERS=['Orden','Idioma','Década','Género'];", name='sin filtro dúos')
sub(",'Género · '+GENS[s.gen],'Solo dúos'],chipAct=[!!s.query,false,s.lng>0,s.dec>0,s.gen>0,s.duoOnly];", ",'Género · '+GENS[s.gen]],chipAct=[!!s.query,false,s.lng>0,s.dec>0,s.gen>0];", name='sin chip dúos')

# --- Megamix: teclas de su pantalla, ficha «Megamix» en Preparar/Resultados, sin récord por canción
sub("  act(a){const s=this.state;", "  act(a){const s=this.state;if(!s.err&&(GR.creditsKey(this,a)||GR.megaKey(this,a)))return;GR.navBefore(this,a);", name='Megamix y zzzup: teclas')

# --- Créditos (Ajustes → Créditos, y △ en la bienvenida): qué es Gramola, licencias y contacto
sub("{k:'code',label:'Nuevo código de sala',type:'act',help:'Genera un código nuevo. Todos los móviles tendrán que volver a entrar.'}]",
    "{k:'code',label:'Nuevo código de sala',type:'act',help:'Genera un código nuevo. Todos los móviles tendrán que volver a entrar.'},{k:'credits',label:'Créditos',type:'act',help:'Qué es Gramola, de quién es cada pieza que usa y cómo contactar.'}]", name='créditos: fila de Ajustes')
sub("else{GR.newCode(this);}}}", "else if(r.k==='credits'){GR.creditsOpen(this);}else{GR.newCode(this);}}}", name='créditos: abrir desde Ajustes')
sub("o.val=r.k==='delay'?st.delay+' ms':r.k==='kick'?(n?PLAYERS[n-1][0]:'Nadie en la sala'):s.room;o.cta=r.k==='delay'?'Calibrar':r.k==='kick'?'Expulsar':'Generar';",
    "o.val=r.k==='delay'?st.delay+' ms':r.k==='kick'?(n?PLAYERS[n-1][0]:'Nadie en la sala'):r.k==='credits'?'Proyecto libre y sin ánimo de lucro':s.room;o.cta=r.k==='delay'?'Calibrar':r.k==='kick'?'Expulsar':r.k==='credits'?'Ver':'Generar';", name='créditos: fila')
sub("if(s.screen==='welcome'){if(a==='ok')this.go('lobby');return;}", "if(s.screen==='welcome'){if(a==='ok')this.go('lobby');else if(a==='y'||a==='x')GR.creditsOpen(this);return;}", name='créditos: △ en la bienvenida')
# En el pie de la bienvenida: logo a la izquierda, versión pequeña en el centro (sin la palabra «Versión») y «△ Créditos»
# a la derecha (discreto, fuera del «Pulsa ✕ para continuar»)
sub(r'(\{\{ pressEl \}\}</div>\n  <div style=")display:flex;justify-content:space-between;', r'\1display:grid;grid-template-columns:1fr auto 1fr;', regex=True, name='bienvenida: pie en tres columnas')
sub("const recN=parseInt((song.rec.split(' ')[0]||'0').replace('.',''))||0;", "const recN=GR.mega?Infinity:(parseInt((song.rec.split(' ')[0]||'0').replace('.',''))||0);", name='Megamix: sin récord')
sub("resAct(i){this.conf=[];", "resAct(i){this.conf=[];if(GR.megaRes(this,i))return;", name='Megamix: resultados')

# --- «Pasa el micro» se llama «Pásalo»
sub("Pasa el micro", "Pásalo", count=0, name='Pásalo')

# --- lista de canciones en rejilla de dos filas (sin transiciones en las fichas: se reutilizan al desplazarse y
#     una animación de color hacía parpadear en rojo la ficha que antes estaba seleccionada) (en lugar del carrusel de una en una); el resto de la pantalla igual
GRID_HTML = """      <div style="position:absolute;left:0;top:0;height:100%;transition:transform {{ grid.tr }};transform:translateX({{ grid.tx }}px)">
        <sc-for list="{{ grid.tags }}" as="g" hint-placeholder-count="3">
          <div style="position:absolute;left:{{ g.x }}px;top:{{ g.y }}px;width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;color:#fff;background:{{ g.bg }}">{{ g.l }}</div>
        </sc-for>
        <sc-for list="{{ grid.tiles }}" as="s" hint-placeholder-count="10">
          <div onClick="{{ s.click }}" style="position:absolute;left:{{ s.x}}px;top:{{ s.y }}px;width:{{ s.w }}px;height:{{ s.h }}px;overflow:hidden;cursor:pointer;background:{{ s.tbg }};box-shadow:{{ s.sh }};transform:{{ s.t }};z-index:{{ s.z }}">
            <div style="position:relative;width:100%;height:{{ s.ch }}px;overflow:hidden;background:{{ s.bg }}">
              <div style="position:absolute;right:0;bottom:0;width:58%;height:46%;background:{{ s.blk }}"></div>
              <div style="position:absolute;left:6%;top:3%;font-weight:800;line-height:1;letter-spacing:-0.05em;font-size:{{ s.fs }}px;color:{{ s.fg }}">{{ s.ini }}</div>
              <div style="display:{{ s.nw }};position:absolute;left:0;top:0;background:#ec3013;color:#fff;font-size:17px;font-weight:800;letter-spacing:.1em;padding:5px 9px">NUEVA</div>
            </div>
            <div style="padding:8px 12px 0;display:flex;flex-direction:column;gap:2px;min-width:0">
              <span style="font-size:22px;font-weight:800;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:{{ s.c1 }}">{{ s.title }}</span>
              <span style="font-size:19px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:{{ s.c2 }}">{{ s.artist }}</span>
            </div>
          </div>
        </sc-for>
      </div>
      <div style="position:absolute;left:96px;right:96px;bottom:0;display:flex;gap:4px;flex-wrap:nowrap;overflow:hidden">
        <sc-for list="{{ grid.abc }}" as="k" hint-placeholder-count="12">
          <div style="min-width:34px;height:34px;padding:0 6px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;background:{{ k.bg }};color:{{ k.fg }}">{{ k.l }}</div>
        </sc-for>
      </div>"""
sub(r'      <sc-for list="\{\{ covers \}\}" as="s" hint-placeholder-count="5">.*?</sc-for>', GRID_HTML.replace('\\', '\\\\'), regex=True, name='rejilla: plantilla')
# --- novedades (marcadas en la administración): primero en la lista, en su grupo «★»
sub("else l.sort((a,b)=>b.plays-a.plays);return l;}", "else l.sort((a,b)=>b.plays-a.plays);return GR.newFirst(l);}", name='novedades primero')
sub("filters,covers,hasSongs:", "filters,covers,grid:GR.songGrid(this,list,sf),webHost:GR.webHost(),microHost:GR.microHost(),hasSongs:", name='rejilla y direcciones: datos')
sub("else{if(a==='l')this.setState({songF:Math.max(0,s.songF-1)});else if(a==='r')this.setState({songF:Math.min(n-1,s.songF+1)});else if(a==='u')this.setState({zone:'filters',filterF:1});",
    "else{const nf=GR.gridMove(this,this.songsList(),s.songF,a);if(nf!=null){if(nf!==s.songF)this.setState({songF:nf});}else if(a==='u')this.setState({zone:'filters',filterF:1});", name='rejilla: teclas')

# --- ficha de la canción (lista): sin «Duración · Año»; el título ocupa la mitad y se encoge si no cabe entero
sub('grid-template-columns:minmax(0,1.6fr) repeat(4,minmax(0,1fr))">', 'grid-template-columns:minmax(0,3fr) repeat(3,minmax(0,1fr))">', name='ficha: columnas')
sub(r'\n      <div style="padding:20px 24px 0;border-left:2px solid var\(--color-text\);display:flex;flex-direction:column;gap:4px"><span style="font-size:28px;color:var\(--color-neutral-700\)">Duración · Año</span><span style="font-size:36px;font-weight:800">\{\{ cur.durYear \}\}</span></div>', '', regex=True, name='ficha: sin duración')
sub('<span style="font-size:56px;font-weight:800;line-height:1;letter-spacing:-0.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ cur.title }}</span><span style="font-size:32px;color:var(--color-neutral-700);white-space:nowrap">{{ cur.artist }}</span>',
    '<span style="font-size:{{ cur.tfs }}px;height:56px;display:flex;align-items:flex-end;font-weight:800;line-height:1;letter-spacing:-0.02em;white-space:nowrap;overflow:hidden">{{ cur.title }}</span><span style="font-size:32px;color:var(--color-neutral-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ cur.artist }}</span>', name='ficha: título entero')
sub("const cur={title:cs.title,artist:cs.artist,", "const cur={tfs:GR.fitTitle(cs.title),title:cs.title,artist:cs.artist,", name='ficha: tamaño del título')

# --- foto del jugador (cámara frontal del móvil) en su tarjeta de la sala
sub("const slots=Array.from({length:8},(_,i)=>{if(i<s.count){const p=PLAYERS[i];return {name:p[0],", "const slots=Array.from({length:8},(_,i)=>{if(i<s.count){const p=PLAYERS[i];return {...GR.photoOf(p[3],p[1]),name:p[0],", name='foto: datos')
sub("      return {name:'Libre',color:'transparent',", "      return {ph:'none',phw:0,pho:'none',name:'Libre',color:'transparent',", name='foto: libre')
sub('<div style="height:132px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;padding:0 0 16px;transition:transform 450ms cubic-bezier(.2,.8,.2,1),background 450ms ease-out;transform:{{ p.t }};opacity:{{ p.op }};background:{{ p.bg }};border:2px solid {{ p.bc }}">\n          <div style="height:12px;background:{{ p.color }}"></div>',
    '<div style="position:relative;height:132px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;padding:0 0 16px;transition:transform 450ms cubic-bezier(.2,.8,.2,1),background 450ms ease-out;transform:{{ p.t }};opacity:{{ p.op }};background:{{ p.bg }};border:2px solid {{ p.bc }}">\n          <div style="height:12px;background:{{ p.color }}"></div>\n          <div style="position:absolute;right:10px;top:20px;width:{{ p.phw }}px;height:{{ p.phw }}px;background:{{ p.ph }};outline:{{ p.pho }}"></div>', name='foto: tarjeta')

# --- aviso tras el logo de nuvola (~6 s): gratis, sin ánimo de lucro y sin relación con los artistas
sub("if(e>4100&&this.trTo!=='boot'){this.splashT=0;this.bootT=ts+700;this.go('boot',{bootK:0,splashIn:false,splashRed:false,splashOut:false,bootIn:false},",
    "if(e>4000&&!this.state.splashMsg)this.setState({splashMsg:true});if(e>10000&&!this.state.splashMsgOut)this.setState({splashMsgOut:true});if(e>10600&&this.trTo!=='boot'){this.splashT=0;this.bootT=ts+700;this.go('boot',{bootK:0,splashIn:false,splashRed:false,splashOut:false,splashMsg:false,splashMsgOut:false,bootIn:false},", name='aviso: tiempos')
sub("V.spTf=s.splashIn?'scale(1)':'scale(0.94)';", "V.spTf=s.splashIn?'scale(1)':'scale(0.94)';V.spMsgOp=s.splashMsg&&!s.splashMsgOut?1:0;V.spMsgTf=s.splashMsg&&!s.splashMsgOut?'translateY(0)':'translateY(18px)';", name='aviso: valores')
AVISO = """  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;padding:0 220px;text-align:center;color:#fff;opacity:{{ spMsgOp }};transform:{{ spMsgTf }};transition:opacity 500ms ease-out,transform 700ms cubic-bezier(.2,.8,.2,1)">
    <div style="font-size:60px;font-weight:800;line-height:1.1;letter-spacing:-0.02em">Gramola es un proyecto gratuito<br>y sin ánimo de lucro.</div>
    <div style="font-size:40px;font-weight:300;line-height:1.3">Nunca se solicitará ningún pago por su uso.</div>
    <div style="font-size:30px;font-weight:400;line-height:1.4;max-width:1250px;opacity:.92">Gramola no tiene relación alguna con los artistas, autores o compañías discográficas de las obras que incluye, cuyos derechos pertenecen a sus respectivos titulares.</div>
  </div>
"""
sub(r'(<img src="assets/nuvola/nuvola-blanco\.png"[^\n]*\n    </div>\n  </div>\n)', lambda m: m.group(1) + AVISO, regex=True, name='aviso: texto')

# --- ayudas de botones según el mando conectado (PlayStation ✕○□△, Xbox ABXY, o las del diseño)
GK = {'OK': 'ok', '←': 'back', 'X': 'x', 'Y': 'y', 'L': 'l', 'R': 'r', 'L R': 'lr', '≡': 'menu'}
sub(r'((?:min-width|width):4[48]px;height:4[48]px;[^>]*>)(OK|←|X|Y|L|R|L R|≡)(</div>)', lambda m: m.group(1) + '{{ gk.' + GK[m.group(2)] + ' }}' + m.group(3), regex=True, count=0, name='ayudas: símbolos')
sub("V.isSplash=s.screen==='splash';", "V.gk=GR.gk();V.onCredits=e=>{if(e&&e.stopPropagation)e.stopPropagation();GR.creditsOpen(this);};V.onPagePrev=()=>GR.gridPage(this,-1);V.onPageNext=()=>GR.gridPage(this,1);V.isSplash=s.screen==='splash';", name='ayudas: datos')
sub("if(!this._pressEl){const h=React.createElement;this._pressEl=", "if(!this._pressEl||this._pressGk!==GR.gk().ok){this._pressGk=GR.gk().ok;const h=React.createElement;this._pressEl=", name='ayudas: pulsa')
sub("fontSize:26,fontWeight:800}},'OK'),h('span',null,'para continuar')", "fontSize:26,fontWeight:800}},GR.gk().ok),h('span',null,'para continuar')", name='ayudas: pulsa OK')

# --- subtítulo de Récords en el menú más corto (no cabía en una línea)
sub("['Récords','Salón de la fama','Las mejores puntuaciones de la casa.']", "['Récords','Los mejores','Las mejores puntuaciones de la casa.']", name='menú: Los mejores')

# --- tarjeta del menú seleccionada: borde negro por los cuatro lados (antes solo el de la derecha); con ratón, la
#     tarjeta se elige al pasar por encima
sub("const tiles=MODES.map((m,i)=>{const on=s.menuF===i;return {num:", "const tiles=MODES.map((m,i)=>{const on=s.menuF===i;return {hover:()=>{if(!on)this.setState({menuF:i});},ol:on?'2px solid '+C.ink:'none',num:", name='menú: borde datos')
sub('<div onClick="{{ m.click }}" style="height:260px;', '<div onClick="{{ m.click }}" onMouseEnter="{{ m.hover }}" style="height:260px;', name='menú: elegir con el ratón')
sub("t:on?'scale(1.05)':'scale(1)',s:on?SHADOW:'none',z:on?2:1,br:i<6", "t:on?'scale(1.05)':'scale(1)',s:on?'0 18px 40px rgba(32,30,29,0.38), 0 4px 12px rgba(32,30,29,0.22)':'none',z:on?2:1,br:i<6", name='menú: sombra')
sub("border-right:{{ m.br }};background:{{ m.bg }};", "border-right:{{ m.br }};outline:{{ m.ol }};outline-offset:-2px;background:{{ m.bg }};", name='menú: borde')

# --- lista de canciones: desvanecimiento en los laterales (las portadas no se cortan en seco)
FADE = 'linear-gradient(to right,transparent 0,#000 120px,#000 calc(100% - 120px),transparent 100%)'
sub('position:relative;flex:1;min-height:0;margin:24px -96px 0;overflow:hidden', 'position:relative;flex:1;min-height:0;margin:24px -96px 0;overflow:hidden;-webkit-mask-image:' + FADE + ';mask-image:' + FADE, name='rejilla: desvanecimiento')

# --- avisos apilados: el de «Vibrato» va encima del de la frase (dy)
sub("else ry=(this.rowY[p.k]||400)-56;", "else ry=(this.rowY[p.k]||400)-56-(p.dy||0);", name='avisos: altura')
sub("else bx=x0+p.k*(cw+8);\n      c.fillStyle=p.bg;c.fillRect(bx,by,w,fs+14);", "else bx=x0+p.k*(cw+8);if(p.dy)by+=fs+18;\n      c.fillStyle=p.bg;c.fillRect(bx,by,w,fs+14);", name='avisos: altura (fondo claro)')

# --- sin el 3-2-1 sobre el carril antes de cantar (ya lo marca la barra de aproximación de la letra)
sub("if(now<f0&&now>f0-3){", "if(false&&now<f0&&now>f0-3){", count=0, name='sin 3-2-1 en el carril')

# --- sin «Interludio musical»: en las pausas se ve la frase que viene (solo el Megamix anuncia la canción siguiente)
sub("if(ci>0&&now>prevEnd+0.35&&cur.start-now>2.2){", "if(ci>0&&now>prevEnd+0.35&&cur.start-now>2.2&&GR.interText(this,cur)){", count=0, name='sin interludio')

# --- bienvenida sin eslogan (solo el logo)
sub('\n    <div style="font-size:40px;font-weight:300;letter-spacing:-0.01em">Karaoke en casa. Tu móvil es el micro.</div>', '', name='bienvenida: sin eslogan')

# --- versión (esquema 1.AA.MMDD.HHMM, fichero VERSION en la raíz del repo)
VERSION = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'VERSION')).read().strip()
sub('<span style="color:var(--color-neutral-700)">Versión 1.0.0</span>',
    f'<span style="color:var(--color-neutral-700);font-size:22px;font-weight:500;justify-self:center">{VERSION}</span>'
    '<span onClick="{{ onCredits }}" style="justify-self:end;display:flex;align-items:center;gap:12px;font-size:24px;font-weight:600;color:var(--color-neutral-700)">'
    '<span style="width:40px;height:40px;border-radius:50%;border:2px solid var(--color-text);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:var(--color-text)">{{ gk.y }}</span>Créditos</span>', name='versión')
# …y la misma versión en la insignia del README (así el repo muestra siempre la versión desplegada)
_readme = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'README.md')
if os.path.exists(_readme):
    _r = open(_readme, encoding='utf-8').read()
    _n = re.sub(r'badge/versi%C3%B3n-[0-9.]+-', 'badge/versi%C3%B3n-' + VERSION + '-', _r)
    if _n != _r: open(_readme, 'w', encoding='utf-8').write(_n)


# --- listón de afinación al 50 % (márgenes ÷ 0,5): textos del diseño con los valores reales
sub('Fácil · ±2 semitonos', 'Fácil · ±4 semitonos', count=0, name='texto Fácil')
sub('Normal · ±1 semitono', 'Normal · ±2 semitonos', count=0, name='texto Normal')
sub('Difícil · ±½ semitono', 'Difícil · ±1 semitono', count=0, name='texto Difícil')
sub('Fácil admite ±2 semitonos; Normal, ±1; Difícil, ±½', 'Fácil admite ±4 semitonos; Normal, ±2; Difícil, ±1', count=0, name='ayuda dificultad')

# --- protecciones: con datos reales la lista puede estar vacía (cargando o sin canciones)
sub("V.jq=s.jq.slice(0,4).map(i=>{const so=SONGS[i];", "V.jq=s.jq.slice(0,4).filter(i=>SONGS[i]&&SONGS[i].id).map(i=>{const so=SONGS[i];", name='cola segura')
sub("const cs=s.screen==='songs'?(list[sf]||SONGS[0]):SONGS[s.songSel];", "const cs=s.screen==='songs'?(list[sf]||SONGS[0]):(GR.megaCard(s)||SONGS[s.songSel]||SONGS[0]);", name='ficha segura (y Megamix)')
sub("let l=SONGS.slice();", "let l=SONGS.filter(x=>x.id);", name='sin relleno en la lista')

# --- página: título, iconos, rutas y el puente antes del runtime del diseño
sub('<head>', '<head>\n<base href="/tv/">\n<title>Gramola</title>\n<meta name="theme-color" content="#ec3013">\n'
    '<link rel="icon" href="/assets/iconos/favicon-32.png" sizes="32x32">\n<link rel="apple-touch-icon" href="/assets/iconos/favicon-180.png">\n'
    '<style>html,body{margin:0;background:#0e0f0f;overflow:hidden;cursor:none}</style>\n'
    '<script src="/vendor/qrcode.js"></script>\n<script src="/tv/gramola-bridge.js?v=' + VERSION + '"></script>', name='head')

# --- revisión del 03-nov-2026: récords comprobados en el servidor y casos límite de Pásalo/Preparar/Resultados
# Cada fila de resultados lleva el id del jugador (el servidor solo guarda récords de jugadores de la sala) y la
# precisión no es NaN en una canción sin ranuras
sub("return {name:s.name,color:s.color,shape:s.shape,score:Math.round(this.score[k]),prec:Math.round(100*h/t),",
    "return {id:s.id,name:s.name,color:s.color,shape:s.shape,score:Math.round(this.score[k]),prec:t?Math.round(100*h/t):0,", name='resultados: id y precisión')
# Pásalo: un equipo que se queda sin jugadores no deja la pantalla en blanco
sub("turnPlayer(p){const ids=this.teamIds(p,p.turn);return ids[", "turnPlayer(p){const ids=this.teamIds(p,p.turn);if(!ids.length)return null;return ids[", name='Pásalo: equipo vacío')
sub("partyGo(){const p=this.state.party,P0=PLAYERS[this.turnPlayer(p)];this.beginCount(",
    "partyGo(){const p=this.state.party,pi=this.turnPlayer(p);if(pi==null){this.toast('Ese equipo se ha quedado sin jugadores');this.P({step:'teams'});return;}const P0=PLAYERS[pi];this.beginCount(", name='Pásalo: ir sin jugador')
# Pásalo: elige canción en vez de sacarla al azar (aquí el guardia ya dejó «const P0=PLAYERS[pi]» delante)
sub("partyGo(){const p=this.state.party,pi=this.turnPlayer(p);if(pi==null){this.toast('Ese equipo se ha quedado sin jugadores');this.P({step:'teams'});return;}const P0=PLAYERS[pi];this.beginCount(",
    "partyGo(){const p=this.state.party,pi=this.turnPlayer(p);if(pi==null){this.toast('Ese equipo se ha quedado sin jugadores');this.P({step:'teams'});return;}this.go('songs',{zone:'grid',mode:'party',songF:0});return;const P0=PLAYERS[pi];this.beginCount(",
    name='Pásalo elige canción')
sub("if(sp==='turn'){const pi=this.turnPlayer(p);V.turnName=PLAYERS[pi][0];", "if(sp==='turn'){const pi=this.turnPlayer(p);V.turnName=pi==null?'—':PLAYERS[pi][0];", name='Pásalo: nombre del turno')
# Preparar partida: un jugador que se ha ido (fila sin nombre) no se convierte en cantante fantasma
sub("singersFromSetup(){const m=this.state.mode;return this.state.setup.map((s,i)=>{if(this.isOff(i))return null;",
    "singersFromSetup(){const m=this.state.mode;return this.state.setup.map((s,i)=>{if(this.isOff(i)||!PLAYERS[i][0])return null;", name='preparar: sin fantasmas')
# Calibración: cancelar con Atrás también para la toma de arranques de voz en el puente
sub("calKey(a){const c=this.state.calib;if(c.phase==='measure'||c.phase==='test'){if(a==='back'){clearInterval(this.bTimer);this.setState(",
    "calKey(a){const c=this.state.calib;if(c.phase==='measure'||c.phase==='test'){if(a==='back'){clearInterval(this.bTimer);if(GR.cal)GR.cal.on=false;this.setState(", name='calibración: cancelar')
# Transición cancelada: si se sale de la cuenta atrás (o del fundido hacia el canto) antes de que llegue, se para la cuenta
# y la canción (antes la cuenta seguía viva y arrancaba la canción sola en otra pantalla, o el audio se quedaba sonando)
sub("if(this.state.tr==='out'){clearTimeout(this.trT);}",
    "if(this.state.tr==='out'){clearTimeout(this.trT);if(this.trTo==='count'&&screen!=='count'){clearTimeout(this.cWait);clearInterval(this.cTimer);}if(this.trTo==='sing'&&screen!=='sing'){this.chart=null;GR.stopAudio&&GR.stopAudio();}}clearTimeout(this.trI);", name='transición cancelada')
# Récords «Por canción»: solo las que tienen récord, 8 como mucho (cabían en pantalla; la biblioteca entera se salía)
sub("return [so.title,sc||'—',nm||'Sin récord todavía',parseInt((sc||'0').replace('.',''))||0];}).sort((a,b)=>b[3]-a[3]);",
    "return [so.title,sc||'—',nm||'Sin récord todavía',parseInt((sc||'0').replace('.',''))||0];}).sort((a,b)=>b[3]-a[3]).filter(r=>r[3]>0).slice(0,8);", name='récords por canción: 8')
# Pásalo: tantas rondas como hagan falta para que canten todos (con 3 equipos o equipos desiguales, 4 fijas era injusto)
sub("this.P({step:'roulette'});}else if(a==='back')this.go('menu');}",
    "this.P({step:'roulette',rounds:p.nT*Math.max(...[...Array(p.nT).keys()].map(t=>this.teamIds(p,t).length))});}else if(a==='back')this.go('menu');}", name='Pásalo: rondas')
# Fin de canción con la biblioteca recargada a medias (sala perdida): la canción puede no estar en su índice
sub("const song=SONGS[this.state.songSel];const recN=", "const song=SONGS[this.state.songSel]||{rec:'—'};const recN=", name='fin: canción desaparecida')
# El carrusel «covers» del diseño ya no se usa (lo sustituye la rejilla): no se calcula en cada render (un objeto con
# cierre por canción en cada toast o tic de marcador, también cantando)
sub("const covers=list.map((so,i)=>{", "const covers=[],_coversNo=((so,i)=>{", name='sin carrusel de portadas')
# La lista de canciones filtrada y ordenada se calcula solo cuando cambia algo (antes, en cada render, también cantando)
sub("  songsList(){const s=this.state;let l=SONGS.filter(x=>x.id);",
    "  songsList(){const s=this.state;const key=[SONGS.length,GR.songsRev||0,s.query||'',s.lng,s.dec,s.gen,s.duoOnly?1:0,s.ord].join('|');if(this._sl&&this._sl.key===key)return this._sl.list;const list=this.songsList0();this._sl={key,list};return list;}\n  songsList0(){const s=this.state;let l=SONGS.filter(x=>x.id);", name='lista de canciones memorizada')

# --- Canciones: dos botones a la derecha de los filtros para pasar página con el ratón (o el puntero de la tele)
BOTON_PAG = 'style="width:64px;height:64px;box-sizing:border-box;border:2px solid var(--color-text);display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800;line-height:1;padding-bottom:4px;background:#fff"'
sub('<div style="display:flex;margin-top:24px;border:2px solid var(--color-text);align-self:flex-start">\n    <sc-for list="{{ filters }}" as="f" hint-placeholder-count="8">',
    '<div style="display:flex;margin-top:24px;justify-content:space-between;align-items:flex-start;align-self:stretch">\n  <div style="display:flex;border:2px solid var(--color-text)">\n    <sc-for list="{{ filters }}" as="f" hint-placeholder-count="8">', name='canciones: fila de filtros con paginación')
sub('">{{ f.label }}</div>\n    </sc-for>\n  </div>',
    '">{{ f.label }}</div>\n    </sc-for>\n  </div>\n  <div style="display:flex;gap:12px"><div onClick="{{ onPagePrev }}" ' + BOTON_PAG + '>‹</div><div onClick="{{ onPageNext }}" ' + BOTON_PAG + '>›</div></div>\n  </div>', name='canciones: botones de página')

if fails:
    print('ERROR: estos enganches ya no encajan con el diseño nuevo:', *fails, sep='\n  - ')
    sys.exit(1)

OUT.parent.mkdir(parents=True, exist_ok=True)
# Jukebox y Pásalo no pasan por «Preparar» (no hay jugadores que preparar): canción elegida y a cantar
sub("startSetup(){const l=this.songsList();if(!l.length)return;const song=l[Math.min(this.state.songF,l.length-1)];",
    "startSetup(){const l=this.songsList();if(!l.length)return;const song=l[Math.min(this.state.songF,l.length-1)];"
    "if(this.state.mode==='jukebox'){const q=SONGS.indexOf(song);this.setState({songSel:q,singers:[],jq:[q].concat((this.state.jq||[]).filter(x=>x!==q).slice(0,3))},()=>this.startSing());return;}"
    "if(this.state.mode==='party'){const pi=this.turnPlayer(this.state.party);if(pi==null){this.toast('Ese equipo se ha quedado sin jugadores');this.P({step:'teams'});return;}const P0=PLAYERS[pi];this.beginCount({mode:'party',singers:[{id:P0[3],bot:P0[4],name:P0[0],color:P0[1],shape:P0[2],tol:DIFFS[this.state.settings.diff][1],team:0,part:0}],songSel:SONGS.indexOf(song)});return;}", name='sin Preparar en jukebox y party')

OUT.write_text(s, encoding='utf-8')

# Runtime del diseño y su sistema de estilos, con React/Babel servidos en local
D = ROOT / 'diseno'
TV.mkdir(parents=True, exist_ok=True)
sup = (D / 'support.js').read_text(encoding='utf-8')
for a, b in [('https://unpkg.com/react@18.3.1/umd/react.production.min.js', '/vendor/react.production.min.js'),
             ('https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', '/vendor/react-dom.production.min.js'),
             ('https://unpkg.com/@babel/standalone@7.29.0/babel.min.js', '/vendor/babel.min.js')]:
    if a not in sup:
        print('AVISO: support.js ya no pide', a)
    sup = sup.replace(a, b)
(TV / 'support.js').write_text(sup, encoding='utf-8')
if (TV / '_ds').exists():
    shutil.rmtree(TV / '_ds')
shutil.copytree(D / '_ds', TV / '_ds')
print('OK: web/index.html montado desde el diseño (', len(s) // 1024, 'KB )')
