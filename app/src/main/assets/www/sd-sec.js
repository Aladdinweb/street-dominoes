/* sd-sec.js v1.5.0 - account security (guest token, recovery key, email link, cloud snapshot) + report / block tools. Page side of /api/auth/*, /api/report, /api/block. */
(function(){
'use strict';
var KA='dm_acc',KB='dm_blk',SK=['dm_set','dm_eco','dm_sdx','dm_prof2','dm_me','dm_friends'],ID=/^usr_[a-z0-9]{4,20}$/;
var A={tok:'',rk:'',em:''},B=[],mail=false,claimed=false,lastH='',chatLog=[],muted={},REASONS=['chat','name','cheat','spam','other'];
function ld(){try{var o=JSON.parse(localStorage.getItem(KA)||'{}');A.tok=String(o.tok||'');A.rk=String(o.rk||'');A.em=String(o.em||'')}catch(e){}
try{var b=JSON.parse(localStorage.getItem(KB)||'[]');B=Array.isArray(b)?b.filter(function(x){return ID.test(x)}).slice(0,200):[]}catch(e){}}
function sv(){try{localStorage.setItem(KA,JSON.stringify(A))}catch(e){}}
function svb(){try{localStorage.setItem(KB,JSON.stringify(B))}catch(e){}}
var ST={
en:{t:'Account Security',on:'Your account is protected on this device.',off:'Not protected yet (needs a connection).',claimed:'This player id is already protected by another device. Use your recovery key below to restore it here.',
rkT:'Recovery key',rkMake:'Create recovery key',rkNew:'New key',cp:'Copy',cpd:'Copied',rkN:'Write it down. It restores your coins, XP and rank on a new phone. Anyone who has it can restore your account.',
reT:'Restore on this device',reB:'Restore',reC:'This replaces the progress on this device. Continue?',reOk:'Restored',reBad:'Wrong or unknown key',
emT:'Email',emPh:'you@example.com',emL:'Link email',emR:'Email me a restore link',emS:'Check your inbox (the link works once, 15 min)',emOk:'Email linked',noMail:'Email linking is not available yet.',
bT:'Blocked players',none:'None',ub:'Unblock',cl:'Close',rpT:'Report or block',rp:'Report',bl:'Block',mu:'Mute for this game',cn:'Cancel',sent:'Report sent. Thank you.',bd:'Player blocked',md:'Muted',err:'Could not reach the server',rate:'Too many tries, wait a bit',
r_chat:'Abusive chat',r_name:'Offensive name',r_cheat:'Cheating',r_spam:'Spam',r_other:'Other',pick:'Who?',link:'Report / Block a player'},
fr:{t:'S\u00E9curit\u00E9 du compte',on:'Votre compte est prot\u00E9g\u00E9 sur cet appareil.',off:'Pas encore prot\u00E9g\u00E9 (connexion requise).',claimed:'Cet identifiant est d\u00E9j\u00E0 prot\u00E9g\u00E9 par un autre appareil. Utilisez votre cl\u00E9 de r\u00E9cup\u00E9ration ci-dessous.',
rkT:'Cl\u00E9 de r\u00E9cup\u00E9ration',rkMake:'Cr\u00E9er la cl\u00E9',rkNew:'Nouvelle cl\u00E9',cp:'Copier',cpd:'Copi\u00E9',rkN:'Notez-la. Elle restaure vos pi\u00E8ces, XP et rang sur un nouveau t\u00E9l\u00E9phone. Quiconque l\u2019a peut restaurer votre compte.',
reT:'Restaurer sur cet appareil',reB:'Restaurer',reC:'Cela remplace la progression de cet appareil. Continuer ?',reOk:'Restaur\u00E9',reBad:'Cl\u00E9 incorrecte ou inconnue',
emT:'E-mail',emPh:'vous@exemple.com',emL:'Lier l\u2019e-mail',emR:'M\u2019envoyer un lien de restauration',emS:'V\u00E9rifiez votre bo\u00EEte (lien \u00E0 usage unique, 15 min)',emOk:'E-mail li\u00E9',noMail:'La liaison par e-mail n\u2019est pas encore disponible.',
bT:'Joueurs bloqu\u00E9s',none:'Aucun',ub:'D\u00E9bloquer',cl:'Fermer',rpT:'Signaler ou bloquer',rp:'Signaler',bl:'Bloquer',mu:'Muet pour cette partie',cn:'Annuler',sent:'Signalement envoy\u00E9. Merci.',bd:'Joueur bloqu\u00E9',md:'Muet',err:'Serveur injoignable',rate:'Trop d\u2019essais, patientez',
r_chat:'Chat abusif',r_name:'Pseudo offensant',r_cheat:'Triche',r_spam:'Spam',r_other:'Autre',pick:'Qui ?',link:'Signaler / bloquer un joueur'},
ar:{t:'\u0623\u0645\u0627\u0646 \u0627\u0644\u062D\u0633\u0627\u0628',on:'\u062D\u0633\u0627\u0628\u0643 \u0645\u062D\u0645\u064A \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632.',off:'\u063A\u064A\u0631 \u0645\u062D\u0645\u064A \u0628\u0639\u062F (\u064A\u062D\u062A\u0627\u062C \u0625\u0646\u062A\u0631\u0646\u062A).',claimed:'\u0647\u0630\u0627 \u0627\u0644\u0645\u0639\u0631\u0651\u0641 \u0645\u062D\u0645\u064A \u0628\u062C\u0647\u0627\u0632 \u0622\u062E\u0631. \u0627\u0633\u062A\u062E\u062F\u0645 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0623\u062F\u0646\u0627\u0647.',
rkT:'\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629',rkMake:'\u0625\u0646\u0634\u0627\u0621 \u0645\u0641\u062A\u0627\u062D',rkNew:'\u0645\u0641\u062A\u0627\u062D \u062C\u062F\u064A\u062F',cp:'\u0646\u0633\u062E',cpd:'\u062A\u0645 \u0627\u0644\u0646\u0633\u062E',rkN:'\u0627\u0643\u062A\u0628\u0647. \u064A\u0639\u064A\u062F \u0639\u0645\u0644\u0627\u062A\u0643 \u0648\u062E\u0628\u0631\u062A\u0643 \u0648\u062A\u0631\u062A\u064A\u0628\u0643 \u0639\u0644\u0649 \u0647\u0627\u062A\u0641 \u062C\u062F\u064A\u062F. \u0645\u0646 \u064A\u0645\u0644\u0643\u0647 \u064A\u0633\u062A\u0637\u064A\u0639 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u062D\u0633\u0627\u0628\u0643.',
reT:'\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632',reB:'\u0627\u0633\u062A\u0639\u0627\u062F\u0629',reC:'\u0633\u064A\u062A\u0645 \u0627\u0633\u062A\u0628\u062F\u0627\u0644 \u062A\u0642\u062F\u0645 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632. \u0645\u062A\u0627\u0628\u0639\u0629\u061F',reOk:'\u062A\u0645\u062A \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629',reBad:'\u0645\u0641\u062A\u0627\u062D \u062E\u0627\u0637\u0626 \u0623\u0648 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641',
emT:'\u0627\u0644\u0628\u0631\u064A\u062F',emPh:'you@example.com',emL:'\u0631\u0628\u0637 \u0627\u0644\u0628\u0631\u064A\u062F',emR:'\u0623\u0631\u0633\u0644 \u0644\u064A \u0631\u0627\u0628\u0637 \u0627\u0633\u062A\u0639\u0627\u062F\u0629',emS:'\u062A\u062D\u0642\u0642 \u0645\u0646 \u0628\u0631\u064A\u062F\u0643 (\u0627\u0644\u0631\u0627\u0628\u0637 \u0644\u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629\u060C 15 \u062F\u0642\u064A\u0642\u0629)',emOk:'\u062A\u0645 \u0631\u0628\u0637 \u0627\u0644\u0628\u0631\u064A\u062F',noMail:'\u0627\u0644\u0631\u0628\u0637 \u0628\u0627\u0644\u0628\u0631\u064A\u062F \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0628\u0639\u062F.',
bT:'\u0627\u0644\u0644\u0627\u0639\u0628\u0648\u0646 \u0627\u0644\u0645\u062D\u0638\u0648\u0631\u0648\u0646',none:'\u0644\u0627 \u0623\u062D\u062F',ub:'\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u062D\u0638\u0631',cl:'\u0625\u063A\u0644\u0627\u0642',rpT:'\u0625\u0628\u0644\u0627\u063A \u0623\u0648 \u062D\u0638\u0631',rp:'\u0625\u0628\u0644\u0627\u063A',bl:'\u062D\u0638\u0631',mu:'\u0643\u062A\u0645 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0644\u0639\u0628\u0629',cn:'\u0625\u0644\u063A\u0627\u0621',sent:'\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u0644\u0627\u063A. \u0634\u0643\u0631\u064B\u0627.',bd:'\u062A\u0645 \u062D\u0638\u0631 \u0627\u0644\u0644\u0627\u0639\u0628',md:'\u062A\u0645 \u0627\u0644\u0643\u062A\u0645',err:'\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u062E\u0627\u062F\u0645',rate:'\u0645\u062D\u0627\u0648\u0644\u0627\u062A \u0643\u062B\u064A\u0631\u0629\u060C \u0627\u0646\u062A\u0638\u0631',
r_chat:'\u062F\u0631\u062F\u0634\u0629 \u0645\u0633\u064A\u0626\u0629',r_name:'\u0627\u0633\u0645 \u0645\u0633\u064A\u0621',r_cheat:'\u063A\u0634',r_spam:'\u0631\u0633\u0627\u0626\u0644 \u0645\u0632\u0639\u062C\u0629',r_other:'\u0623\u062E\u0631\u0649',pick:'\u0645\u0646\u061F',link:'\u0625\u0628\u0644\u0627\u063A / \u062D\u0638\u0631 \u0644\u0627\u0639\u0628'}};
function L(){var l=localStorage.getItem('dm_lang')||'en';return ST[l]||ST.en}
function s(k){return L()[k]||ST.en[k]||k}
function tip(m){try{toast(m)}catch(e){}}
function E(x){return String(x).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function call(path,body,method){var h={'content-type':'application/json'};if(A.tok)h.authorization='Bearer '+A.tok;
return fetch(API_URL+path,{method:method||'POST',headers:h,body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{ok:r.ok,status:r.status,j:j}})})}
function css(){if(document.getElementById('sdsec-css'))return;var c=document.createElement('style');c.id='sdsec-css';c.textContent=
'.sxm{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.74)}.sxm[hidden]{display:none}'+
'.sxp{width:min(94vw,360px);max-height:92dvh;overflow:auto;background:#1a1a1a;border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:18px;color:#fff;box-shadow:0 14px 50px rgba(0,0,0,.6)}.sxp h3{margin:0 0 8px;text-align:center}'+
'.sxp .big{width:100%;margin-top:8px}.sxp small{display:block;color:#b9b9b9;margin-top:6px;line-height:1.4}.sxb{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.1)}'+
'.sxk{font:700 22px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-align:center;padding:10px;border-radius:12px;background:rgba(255,255,255,.06);margin:6px 0;user-select:all}'+
'.sxp input,.sxp select{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#101010;color:#fff;font:inherit;margin-top:6px}'+
'.sxr{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0}.sxr button{padding:6px 10px}'+
'.rpb{width:26px;height:26px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.35);color:#fff;font-size:15px;line-height:1;margin-inline-start:4px;opacity:.7}';
document.head.appendChild(c)}
function modal(h){css();var e=document.getElementById('sxm');if(!e){e=document.createElement('div');e.id='sxm';e.className='sxm';e.hidden=true;document.body.appendChild(e);e.addEventListener('click',onClick)}
e.innerHTML='<div class="sxp">'+h+'</div>';e.hidden=false;return e}
function close(){var e=document.getElementById('sxm');if(e)e.hidden=true}
function peerName(id){try{var p=frPeople().find(function(z){return z.id===id});if(p)return p.n}catch(e){}return id}
// ---------- account
function init(){ld();if(A.tok)return Promise.resolve();
return call('/api/auth/init',{playerId:pid}).then(function(r){if(r.ok&&r.j.token){A.tok=r.j.token;sv();push(true);pull()}else if(r.status===409)claimed=true}).catch(function(){})}
function cfg(){call('/api/auth/config',null,'GET').then(function(r){mail=!!(r.j&&r.j.mail)}).catch(function(){})}
function snap(){var d={};SK.forEach(function(k){var v=localStorage.getItem(k);if(typeof v==='string'&&v.length<=4096)d[k]=v});return d}
function push(force){if(!A.tok)return;var d=snap(),h=JSON.stringify(d);if(!force&&h===lastH)return;lastH=h;call('/api/auth/save',{playerId:pid,data:d}).catch(function(){lastH=''})}
function pull(){if(!A.tok)return;call('/api/blocks?playerId='+encodeURIComponent(pid),null,'GET').then(function(r){if(r.ok&&Array.isArray(r.j.list)){B=r.j.list.filter(function(x){return ID.test(x)}).slice(0,200);svb()}}).catch(function(){})}
function adopt(j){try{localStorage.setItem('dm_pid',j.playerId);A={tok:j.token,rk:A.rk,em:A.em};sv();if(j.snap&&j.snap.d)SK.forEach(function(k){if(typeof j.snap.d[k]==='string')localStorage.setItem(k,j.snap.d[k])})}catch(e){}tip('\u2705 '+s('reOk'));setTimeout(function(){location.reload()},700)}
function openSec(){ld();var h='<h3>\uD83D\uDD10 '+E(s('t'))+'</h3><small>'+E(claimed&&!A.tok?s('claimed'):A.tok?s('on'):s('off'))+'</small>'+
'<div class="sxb"><b>'+E(s('rkT'))+'</b><div class="sxk" id="sxk">'+(A.rk?E(A.rk):'\u2014')+'</div>'+(A.rk?'<button class="big alt" data-x="cp">'+E(s('cp'))+'</button>':'')+'<button class="big" data-x="rk">'+E(A.rk?s('rkNew'):s('rkMake'))+'</button><small>'+E(s('rkN'))+'</small></div>'+
'<div class="sxb"><b>'+E(s('reT'))+'</b><input id="sxi" placeholder="SD-XXXX-XXXX" autocomplete="off" autocapitalize="characters"><button class="big alt" data-x="rec">'+E(s('reB'))+'</button></div>'+
'<div class="sxb"><b>'+E(s('emT'))+'</b>'+(mail?'<input id="sxe" type="email" placeholder="'+E(s('emPh'))+'"><button class="big alt" data-x="em">'+E(s('emL'))+'</button><button class="big alt" data-x="emr">'+E(s('emR'))+'</button>':'<small>'+E(s('noMail'))+'</small>')+'</div>'+
'<div class="sxb"><b>'+E(s('bT'))+'</b>'+(B.length?B.map(function(id){return'<div class="sxr"><span>'+E(peerName(id))+'</span><button class="big alt" data-x="ub" data-id="'+E(id)+'">'+E(s('ub'))+'</button></div>'}).join(''):'<small>'+E(s('none'))+'</small>')+'</div>'+
'<button class="big alt" data-x="cl">'+E(s('cl'))+'</button>';modal(h)}
// ---------- report / block
function seatId(p){try{var id=net.pids&&net.pids[p];return ID.test(id||'')?id:''}catch(e){return''}}
function sheet(p){var id=seatId(p);if(!id)return;var nm='';try{nm=names[p]||''}catch(e){}
modal('<h3>\uD83D\uDEA9 '+E(s('rpT'))+'</h3><p style="text-align:center;margin:0 0 6px"><b>'+E(nm||id)+'</b></p><select id="sxr">'+REASONS.map(function(r){return'<option value="'+r+'">'+E(s('r_'+r))+'</option>'}).join('')+'</select>'+
'<button class="big" data-x="rp" data-p="'+p+'">'+E(s('rp'))+'</button><button class="big alt" data-x="bl" data-p="'+p+'">'+E(s('bl'))+'</button><button class="big alt" data-x="mu" data-p="'+p+'">'+E(s('mu'))+'</button><button class="big alt" data-x="cl">'+E(s('cn'))+'</button>')}
function picker(){var h='<h3>\uD83D\uDEA9 '+E(s('rpT'))+'</h3><small>'+E(s('pick'))+'</small>',n=0;
for(var p=0;p<4;p++){if(p===net.own||!seatId(p))continue;var nm='';try{nm=names[p]||''}catch(e){}h+='<button class="big alt" data-rp="'+p+'">'+E(nm||seatId(p))+'</button>';n++}
if(!n)return;h+='<button class="big alt" data-x="cl">'+E(s('cn'))+'</button>';modal(h)}
function report(p){var id=seatId(p),r=document.getElementById('sxr');if(!id)return;var nm='';try{nm=names[p]||''}catch(e){}
var chat=chatLog.filter(function(c){return c.p===p}).slice(-5).map(function(c){return c.x});
call('/api/report',{playerId:pid,target:id,reason:r?r.value:'other',name:nm,chat:chat}).then(function(x){tip(x.ok?'\u2705 '+s('sent'):x.status===429?s('rate'):s('err'));if(x.ok)close()}).catch(function(){tip(s('err'))})}
function mute(p){muted[p]=1;try{Voice.rmute.add(p)}catch(e){}tip('\uD83D\uDD07 '+s('md'));close()}
function block(p){var id=seatId(p);if(!id)return;if(B.indexOf(id)<0)B.push(id);svb();mute(p);tip('\u26D4 '+s('bd'));call('/api/block',{playerId:pid,target:id,on:1}).catch(function(){})}
function unblock(id){B=B.filter(function(x){return x!==id});svb();call('/api/block',{playerId:pid,target:id,on:0}).catch(function(){});openSec()}
// ---------- click handling (capture: runs before the game's own handlers)
function onClick(ev){var t=ev.target,x=t.closest&&t.closest('[data-x]');if(!x)return;var a=x.dataset.x,p=+x.dataset.p;
if(a==='cl')close();
else if(a==='rk'){call('/api/auth/recovery-key',{playerId:pid}).then(function(r){if(r.ok&&r.j.key){A.rk=r.j.key;sv();openSec()}else tip(r.status===429?s('rate'):s('err'))}).catch(function(){tip(s('err'))})}
else if(a==='cp'){try{navigator.clipboard.writeText(A.rk);tip(s('cpd'))}catch(e){var k=document.getElementById('sxk');if(k){var g=document.createRange();g.selectNodeContents(k);var q=getSelection();q.removeAllRanges();q.addRange(g)}}}
else if(a==='rec'){var v=(document.getElementById('sxi')||{}).value||'';if(!confirm(s('reC')))return;call('/api/auth/recover',{key:v}).then(function(r){if(r.ok&&r.j.token){A.rk=v.trim().toUpperCase();adopt(r.j)}else tip(r.status===429?s('rate'):s('reBad'))}).catch(function(){tip(s('err'))})}
else if(a==='em'||a==='emr'){var m=((document.getElementById('sxe')||{}).value||'').trim();if(!m)return;call(a==='em'?'/api/auth/email':'/api/auth/email-recover',a==='em'?{playerId:pid,email:m}:{email:m}).then(function(r){tip(r.ok?'\u2709 '+s('emS'):r.status===429?s('rate'):s('err'))}).catch(function(){tip(s('err'))})}
else if(a==='ub')unblock(x.dataset.id);
else if(a==='rp')report(p);else if(a==='bl'){block(p)}else if(a==='mu')mute(p)}
document.addEventListener('click',function(ev){var t=ev.target,b=t.closest&&t.closest('[data-rp],[data-sec],[data-rpl]');if(!b)return;ev.preventDefault();ev.stopPropagation();
if(b.dataset.sec){try{document.getElementById('set').hidden=true}catch(e){}openSec()}else if(b.dataset.rpl!==undefined){try{document.getElementById('up').hidden=true}catch(e){}picker()}else sheet(+b.dataset.rp)},true);
// hide chat bubbles from blocked / muted players and remember recent chat lines for reports
var sb=window.showTextBubble;if(typeof sb==='function')window.showTextBubble=function(p,x){try{chatLog.push({p:p,x:x});if(chatLog.length>40)chatLog.shift();var id=seatId(p);if(muted[p]||(id&&B.indexOf(id)>=0))return}catch(e){}return sb.apply(this,arguments)};
// magic link: /?link=TOKEN (forwarded by the landing page)
function link(){var m=/[?&]link=([\w-]{20,60})/.exec(location.search);if(!m)return;try{history.replaceState(null,'',location.pathname)}catch(e){}
call('/api/auth/verify',{link:m[1]}).then(function(r){if(!r.ok)return tip(s('reBad'));if(r.j.purpose==='bind')tip('\u2705 '+s('emOk')+' '+(r.j.email||''));else adopt(r.j)}).catch(function(){tip(s('err'))})}
window.SDSec={btn:function(){return'<button class="big alt" data-sec="1">\uD83D\uDD10 '+E(s('t'))+'</button>'},
rp:function(p){try{if(net.online&&p!==net.own&&seat[p]!==2&&seatId(p))return'<button class="rpb" data-rp="'+p+'" aria-label="'+E(s('rpT'))+'">\u22EF</button>'}catch(e){}return''},
rpLink:function(){try{if(net.online)return'<button class="big alt" data-rpl="1">\uD83D\uDEA9 '+E(s('link'))+'</button>'}catch(e){}return''}};
ld();cfg();setTimeout(function(){init().then(link)},1500);
setInterval(function(){push(false)},120000);document.addEventListener('visibilitychange',function(){if(document.hidden)push(false)});
setInterval(function(){try{if(net.online)for(var p=0;p<4;p++){var id=seatId(p);if(id&&B.indexOf(id)>=0)Voice.rmute.add(p)}}catch(e){}},3000);
})();
