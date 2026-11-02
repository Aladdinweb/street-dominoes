/* sd-ads.js v1.4.0 - rewarded ads, bottom banner, Daily Box extra roll, boost-only Spin Wheel.
   Ads go through the native AdMob bridge of the Android app (Native.showRewarded / bannerShow / bannerHide).
   The web build shows no ads unless the URL has ?adtest=1 (simulated ads for testing). */
(function(){
'use strict';
var KEY='dm_sdx',AD_SPINS_PER_DAY=5,XP_BOOST_MIN=60,XP_BOOST_CAP_MIN=120,SHIELD_CAP=3,TOKEN_CAP=9;
var S={xd:'',sh:0,xb:0,tk:0,sd:'',sn:0,fd:''}; // xd: day of the extra box, sh: loss shields, xb: XP boost end, tk: spin tokens, sd/sn: day + ad spins used
try{var o=JSON.parse(localStorage.getItem(KEY)||'{}');if(o&&typeof o==='object'){S.xd=String(o.xd||'');S.sh=Math.min(SHIELD_CAP,Math.max(0,o.sh|0));S.xb=+o.xb||0;S.tk=Math.min(TOKEN_CAP,Math.max(0,o.tk|0));S.sd=String(o.sd||'');S.fd=String(o.fd||'');S.sn=Math.max(0,o.sn|0)}}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
function day(){var d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()}
var TEST=/[?&]adtest=1/.test(location.search);
var ST={
en:{won:'You won!',spin:'Spin Wheel',spinT:'Boost Wheel',adBox:'Watch an ad for an extra box',adBoxDone:'Extra box used today',adNA:'Rewarded ads are available in the Android app',watch:'Watch an ad to spin',free:'Free spin',left:'ad spins left today',none:'No ad spins left today',
 sh:'Loss Shield',xp:'XP Booster x2',tk:'Lucky Extra Spin',shG:'Loss Shield ready: your entry fee is refunded if you lose a staked match.',xpG:'XP x2 is on',tkG:'You won a free spin',shUsed:'Loss Shield saved your entry fee',have:'Shields',tokens:'Free spins',xpOn:'XP x2',min:'min',close:'Close',adT:'Ad preview',adS:'Reward in',skip:'Cancel'},
fr:{won:'Vous avez gagn\u00E9 !',spin:'Roue bonus',spinT:'Roue des boosts',adBox:'Regarder une pub pour un coffre en plus',adBoxDone:'Coffre en plus utilise aujourd\u2019hui',adNA:'Les pubs avec recompense sont dans l\u2019appli Android',watch:'Regarder une pub pour tourner',free:'Tour gratuit',left:'tours pub restants aujourd\u2019hui',none:'Plus de tours pub aujourd\u2019hui',
 sh:'Bouclier de perte',xp:'Booster XP x2',tk:'Tour gratuit en plus',shG:'Bouclier pret : votre mise est remboursee si vous perdez une partie avec mise.',xpG:'XP x2 actif',tkG:'Tour gratuit gagne',shUsed:'Le bouclier a sauve votre mise',have:'Boucliers',tokens:'Tours gratuits',xpOn:'XP x2',min:'min',close:'Fermer',adT:'Apercu pub',adS:'Recompense dans',skip:'Annuler'},
ar:{won:'\u0631\u0628\u062D\u062A!',spin:'\u0639\u062C\u0644\u0629 \u0627\u0644\u062D\u0638',spinT:'\u0639\u062C\u0644\u0629 \u0627\u0644\u062A\u0639\u0632\u064A\u0632\u0627\u062A',adBox:'\u0634\u0627\u0647\u062F \u0625\u0639\u0644\u0627\u0646\u064B\u0627 \u0644\u0635\u0646\u062F\u0648\u0642 \u0625\u0636\u0627\u0641\u064A',adBoxDone:'\u062A\u0645 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u0625\u0636\u0627\u0641\u064A \u0627\u0644\u064A\u0648\u0645',adNA:'\u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0643\u0627\u0641\u0623\u0629 \u0645\u062A\u0648\u0641\u0631\u0629 \u0641\u064A \u062A\u0637\u0628\u064A\u0642 \u0623\u0646\u062F\u0631\u0648\u064A\u062F',watch:'\u0634\u0627\u0647\u062F \u0625\u0639\u0644\u0627\u0646\u064B\u0627 \u0644\u0644\u062F\u0648\u0631\u0627\u0646',free:'\u062F\u0648\u0631\u0629 \u0645\u062C\u0627\u0646\u064A\u0629',left:'\u062F\u0648\u0631\u0627\u062A \u0625\u0639\u0644\u0627\u0646 \u0645\u062A\u0628\u0642\u064A\u0629 \u0627\u0644\u064A\u0648\u0645',none:'\u0644\u0627 \u062A\u0648\u062C\u062F \u062F\u0648\u0631\u0627\u062A \u0625\u0639\u0644\u0627\u0646 \u0627\u0644\u064A\u0648\u0645',
 sh:'\u062F\u0631\u0639 \u0627\u0644\u062E\u0633\u0627\u0631\u0629',xp:'\u0645\u0639\u0632\u0632 XP \u00D72',tk:'\u062F\u0648\u0631\u0629 \u062D\u0638 \u0625\u0636\u0627\u0641\u064A\u0629',shG:'\u062F\u0631\u0639 \u0627\u0644\u062E\u0633\u0627\u0631\u0629 \u062C\u0627\u0647\u0632: \u064A\u064F\u0639\u0627\u062F \u0631\u0633\u0645 \u0627\u0644\u062F\u062E\u0648\u0644 \u0625\u0630\u0627 \u062E\u0633\u0631\u062A \u0645\u0628\u0627\u0631\u0627\u0629 \u0628\u0631\u0647\u0627\u0646.',xpG:'XP \u00D72 \u0645\u0641\u0639\u0651\u0644',tkG:'\u0631\u0628\u062D\u062A \u062F\u0648\u0631\u0629 \u0645\u062C\u0627\u0646\u064A\u0629',shUsed:'\u062F\u0631\u0639 \u0627\u0644\u062E\u0633\u0627\u0631\u0629 \u0623\u0646\u0642\u0630 \u0631\u0633\u0645 \u062F\u062E\u0648\u0644\u0643',have:'\u0627\u0644\u062F\u0631\u0648\u0639',tokens:'\u062F\u0648\u0631\u0627\u062A \u0645\u062C\u0627\u0646\u064A\u0629',xpOn:'XP \u00D72',min:'\u062F',close:'\u0625\u063A\u0644\u0627\u0642',adT:'\u0645\u0639\u0627\u064A\u0646\u0629 \u0625\u0639\u0644\u0627\u0646',adS:'\u0627\u0644\u0645\u0643\u0627\u0641\u0623\u0629 \u062E\u0644\u0627\u0644',skip:'\u0625\u0644\u063A\u0627\u0621'}};
function s(k){var l=(localStorage.getItem('dm_lang')||'en').slice(0,2);return (ST[l]||ST.en)[k]||ST.en[k]||k}
function rnd(){try{return typeof rnd01==='function'?rnd01():Math.random()}catch(e){return Math.random()}}
function tip(m){try{toast(m)}catch(e){}}
function css(){if(document.getElementById('sdads-css'))return;var c=document.createElement('style');c.id='sdads-css';c.textContent=
':root{--adh:0px}body.hasad #app{height:calc(100vh - var(--adh));height:calc(100dvh - var(--adh))}'+
'#adb{position:fixed;left:0;right:0;bottom:0;height:var(--adh);z-index:5;display:none;align-items:center;justify-content:center;background:#0c0c0c;border-top:1px solid rgba(255,255,255,.12);color:#8a8a8a;font:12px system-ui,sans-serif}body.hasad #adb{display:flex}'+
'.sdm{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.74)}.sdm[hidden]{display:none}'+
'.sdp{width:min(92vw,340px);max-height:92dvh;overflow:auto;background:#1a1a1a;border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:20px;text-align:center;color:#fff;box-shadow:0 14px 50px rgba(0,0,0,.6)}.sdp h3{margin:0 0 10px}.sdp .big{width:100%;margin-top:10px}.sdp small{display:block;color:#b9b9b9;margin-top:8px;line-height:1.4}'+
'.swwrap{position:relative;width:216px;height:216px;margin:6px auto 4px}.swptr{position:absolute;top:-8px;left:50%;margin-left:-10px;border:10px solid transparent;border-top:18px solid #E53935;border-bottom:0;z-index:2}'+
'.swh{position:relative;width:216px;height:216px;border-radius:50%;border:4px solid #3a2416;background:conic-gradient(#b71c1c 0 60deg,#2b2b2b 0 120deg,#E53935 0 180deg,#2b2b2b 0 240deg,#b71c1c 0 300deg,#2b2b2b 0 360deg);transition:transform 4s cubic-bezier(.12,.7,.1,1);box-shadow:0 0 30px rgba(229,57,53,.35)}'+
'.swh b{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;font-size:26px;line-height:34px;text-align:center;transform:rotate(var(--a)) translateY(-76px)}'+
'.sdq{position:absolute;left:50%;top:42%;width:0;height:0;pointer-events:none;z-index:3}.sdq i{position:absolute;left:0;top:0;font-style:normal;font-size:22px;opacity:0;animation:sdqf 1.3s cubic-bezier(.15,.8,.3,1) forwards}@keyframes sdqf{0%{transform:translate(-50%,-50%) scale(.3) rotate(0);opacity:1}70%{opacity:1}100%{transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(1.1) rotate(var(--r));opacity:0}}@media(prefers-reduced-motion:reduce){.sdq{display:none}}';
document.head.appendChild(c)}
// ---------- rewarded ads (native AdMob bridge)
var pend={};
function fake(cb){var m=document.createElement('div');m.className='sdm';m.style.zIndex=90;var n=3;m.innerHTML='<div class="sdp"><h3></h3><p></p><button class="big alt"></button></div>';
var h=m.querySelector('h3'),p=m.querySelector('p'),b=m.querySelector('button');h.textContent=s('adT');b.textContent=s('skip');document.body.appendChild(m);
function tick(){p.textContent=s('adS')+' '+n+'s'}tick();var iv=setInterval(function(){n--;if(n<=0){clearInterval(iv);m.remove();cb(true)}else tick()},1000);
b.onclick=function(){clearInterval(iv);m.remove();cb(false)}}
function reward(id,cb){var N=window.Native;
if(N&&typeof N.showRewarded==='function'){pend[id]=cb;setTimeout(function(){if(pend[id]===cb){delete pend[id];cb(false)}},150000);try{N.showRewarded(id)}catch(e){delete pend[id];cb(false)}return}
if(TEST){fake(cb);return}
tip(s('adNA'));cb(false)}
window.onAdResult=function(id,ok){var f=pend[id];delete pend[id];if(f)f(!!ok)};
// ---------- bottom banner (space is reserved only while an ad is really showing)
function setH(h){h=Math.max(0,Math.round(+h||0));document.documentElement.style.setProperty('--adh',h+'px');document.body.classList.toggle('hasad',h>0)}
window.onBannerState=setH;
var shown=false;
function sync(){var want=typeof inGame!=='undefined'&&!!inGame;if(want===shown)return;shown=want;var N=window.Native;
if(N&&typeof N.bannerShow==='function'){try{want?N.bannerShow():N.bannerHide()}catch(e){}if(!want)setH(0)}
else if(TEST){if(!document.getElementById('adb')){var d=document.createElement('div');d.id='adb';d.textContent='Ad banner (test)';document.body.appendChild(d)}setH(want?50:0)}}
// ---------- boosts
function xp(n){return Date.now()<S.xb?n*2:n}
function shield(stake){if(S.sh>0&&stake>0){S.sh--;save();tip('\uD83D\uDEE1 '+s('shUsed')+' ('+stake+')');return true}return false}
// ---------- Daily Box: one extra box per day for an ad
function decorate(){var e=document.getElementById('mbx'),p=e&&e.querySelector('.mbp'),c=document.getElementById('mbclose');if(!p||!c||!document.getElementById('mbc'))return;
var done=S.xd===day(),b=document.createElement('button');b.className='big'+(done?' alt':'');b.id='sdxb';b.disabled=done;b.textContent=done?s('adBoxDone'):'\uD83C\uDFAC '+s('adBox');p.insertBefore(b,c);
b.onclick=function(){if(S.xd===day())return;b.disabled=true;reward('box',function(ok){if(!ok){b.disabled=false;return}if(S.xd===day())return;S.xd=day();save();var r=rollBox();applyBox(r);saveEco();showBoxReward(r)})}}
var ob=window.openBox;if(typeof ob==='function')window.openBox=function(){ob.apply(this,arguments);try{decorate()}catch(e){}};
// ---------- Spin Wheel: boosts and perks only, never coins
var SEG=['sh','xp','tk','sh','xp','tk'],ICO={sh:'\uD83D\uDEE1',xp:'\u26A1',tk:'\uD83C\uDF9F'},WT={sh:35,xp:40,tk:25},rot=0,busy=false;
function pick(){var r=rnd()*100,k;for(k in WT){if(r<WT[k])return k;r-=WT[k]}return'xp'}
function adLeft(){return Math.max(0,AD_SPINS_PER_DAY-(S.sd===day()?S.sn:0))}
function swEl(){var e=document.getElementById('swx');if(!e){e=document.createElement('div');e.id='swx';e.className='sdm';e.hidden=true;document.body.appendChild(e);e.addEventListener('click',function(ev){if(!busy&&(ev.target===e||ev.target.id==='swc'))e.hidden=true})}return e}
function xpMin(){return Math.max(0,Math.ceil((S.xb-Date.now())/60000))}
function paint(msg){var e=swEl(),left=adLeft();e.innerHTML='<div class="sdp"><h3></h3><div class="swwrap"><i class="swptr"></i><div class="swh" id="swh"></div></div><small id="swm"></small><small id="sws"></small><button class="big" id="swa"></button><button class="big alt" id="swf"></button><button class="big alt" id="swc"></button></div>';
e.querySelector('h3').textContent='\uD83C\uDFA1 '+s('spinT');
var w=e.querySelector('#swh');w.style.transform='rotate('+rot+'deg)';SEG.forEach(function(k,i){var b=document.createElement('b');b.style.setProperty('--a',(i*60+30)+'deg');b.textContent=ICO[k];w.appendChild(b)});
e.querySelector('#swm').textContent=msg||(s('sh')+' \uD83D\uDEE1 \u00B7 '+s('xp')+' \u26A1 \u00B7 '+s('tk')+' \uD83C\uDF9F');
e.querySelector('#sws').textContent=s('have')+': '+S.sh+' \u00B7 '+s('tokens')+': '+S.tk+(Date.now()<S.xb?' \u00B7 '+s('xpOn')+' '+xpMin()+' '+s('min'):'');
var a=e.querySelector('#swa'),f=e.querySelector('#swf');a.textContent=left?'\uD83C\uDFAC '+s('watch')+' ('+left+' '+s('left')+')':s('none');a.disabled=!left||busy;
var fc=S.tk+(S.fd!==day()?1:0);f.textContent=s('free')+' ('+fc+')';f.disabled=!fc||busy;e.querySelector('#swc').textContent=s('close');
a.onclick=function(){if(busy||!adLeft())return;busy=true;paint();reward('spin',function(ok){busy=false;if(!ok){paint();return}if(S.sd!==day()){S.sd=day();S.sn=0}S.sn++;save();spin()})};
f.onclick=function(){if(busy)return;if(S.fd!==day())S.fd=day();else if(S.tk>0)S.tk--;else return;save();spin()};e.hidden=false}
function spin(){var k=pick(),ix=[];SEG.forEach(function(v,i){if(v===k)ix.push(i)});var i=ix[Math.floor(rnd()*ix.length)];busy=true;
var e=swEl(),w=e.querySelector('#swh');if(!w){paint();w=e.querySelector('#swh')}
rot=rot-(rot%360)+360*5+((360-(i*60+30))%360);w.style.transform='rotate('+rot+'deg)';
['#swa','#swf'].forEach(function(q){var b=e.querySelector(q);if(b)b.disabled=true});
setTimeout(function(){busy=false;var m;
if(k==='sh'){S.sh=Math.min(SHIELD_CAP,S.sh+1);m=ICO.sh+' '+s('shG')}
else if(k==='xp'){var now=Date.now();S.xb=Math.min(now+XP_BOOST_CAP_MIN*6e4,Math.max(now,S.xb)+XP_BOOST_MIN*6e4);m=ICO.xp+' '+s('xpG')+' ('+xpMin()+' '+s('min')+')'}
else{S.tk=Math.min(TOKEN_CAP,S.tk+1);m=ICO.tk+' '+s('tkG')}
save();prize(k,m)},4200)}
// prize pop-up: same card as the Daily Box reward (mbEl / .mbp.rw / sparkle ring) plus a prize-themed particle burst
function prize(k,m){var e=null,i;try{e=mbEl()}catch(er){}
if(!e||typeof snd==='undefined'){paint(m);return}
swEl().hidden=true;var sp='',q='',em=[ICO[k],'\u2728',ICO[k],'\u2B50'],nm={sh:s('sh'),xp:s('xp'),tk:s('tk')};
for(i=0;i<24;i++)sp+='<i class="sp" style="--a:'+(i*15)+'deg;--d:'+(80+(i%3)*24)+'px;animation-delay:'+((i%4)*.06)+'s"></i>';
for(i=0;i<18;i++){var a=i/18*6.283+rnd()*.5,d=90+rnd()*70;q+='<i style="--x:'+Math.round(Math.cos(a)*d)+'px;--y:'+Math.round(Math.sin(a)*d)+'px;--r:'+Math.round((rnd()-.5)*540)+'deg;animation-delay:'+(i%6)*.05+'s">'+em[i%4]+'</i>'}
e.innerHTML='<div class="mbp rw"><div class="vh"><div class="spk">'+sp+'</div><div class="sdq">'+q+'</div><div class="mbic">'+ICO[k]+'</div></div><p class="mbt"></p><div class="mbv"></div><p class="mbs"></p><button class="big" id="mbclose"></button></div>';
e.querySelector('.mbt').textContent=s('won');e.querySelector('.mbv').textContent=nm[k];e.querySelector('.mbs').textContent=String(m).replace(ICO[k]+' ','');
var c=e.querySelector('#mbclose');c.textContent=s('close');c.addEventListener('click',function(){setTimeout(paint,0)});
e.hidden=false;try{snd.win()}catch(er){}try{navigator.vibrate&&navigator.vibrate([30,40,60])}catch(er){}}
function btn(){return'<button class="big alt" data-m="spin">\uD83C\uDFA1 '+s('spin')+'</button>'}
window.SDAds={xp:xp,shield:shield,btn:btn,openSpin:function(){paint()},s:s,state:S};
css();setInterval(sync,1500);
setTimeout(function(){try{if(inMenu)menuUI()}catch(e){}},0);
})();
