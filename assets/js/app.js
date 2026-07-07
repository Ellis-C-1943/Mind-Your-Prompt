/* ── IndexedDB local storage ── */
const DB_NAME='MYP',DB_VER=1,DB_STORE='prompts',DB_IMG='images';
const MAX_IMAGE_BYTES=80*1024*1024;
let db=null;
const dbOpen=()=>db?Promise.resolve(db):new Promise((ok,fail)=>{
  const r=indexedDB.open(DB_NAME,DB_VER);
  r.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains(DB_STORE))d.createObjectStore(DB_STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(DB_IMG))d.createObjectStore(DB_IMG)};
  r.onsuccess=e=>{db=e.target.result;ok(db)};r.onerror=e=>fail(e.target.error);
});
const dbGetAll=async()=>{const d=await dbOpen();return new Promise((ok,fail)=>{const tx=d.transaction(DB_STORE,'readonly');const r=tx.objectStore(DB_STORE).getAll();r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>fail(r.error)})};
const dbPutAll=async(data)=>{const d=await dbOpen();return new Promise((ok,fail)=>{const tx=d.transaction(DB_STORE,'readwrite');tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error);const s=tx.objectStore(DB_STORE);s.clear();data.forEach(p=>s.put(p))})};
const dbPutImg=async(key,blob)=>{const d=await dbOpen();return new Promise((ok,fail)=>{const tx=d.transaction(DB_IMG,'readwrite');tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error);tx.objectStore(DB_IMG).put(blob,key)})};
const dbGetImg=async(key)=>{const d=await dbOpen();return new Promise((ok,fail)=>{const r=d.transaction(DB_IMG,'readonly').objectStore(DB_IMG).get(key);r.onsuccess=()=>ok(r.result||null);r.onerror=()=>fail(r.error)})};
const dbDelImg=async(key)=>{const d=await dbOpen();return new Promise((ok,fail)=>{const tx=d.transaction(DB_IMG,'readwrite');tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error);tx.objectStore(DB_IMG)['delete'](key)})};
const isLocalImg=p=>typeof p==='string'&&p.startsWith('local:');

/* ── Core app ── */
const $=id=>document.getElementById(id);
let prompts=[],savedPrompts=[],currentId=null,draft=null,serverMode=true,listFilter='all',lightboxImages=[],lightboxIndex=0;
const id=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const blank=()=>({id:id(),title:'',prompt:'',note:'',model:'',image:'',images:[],imageDates:{},sourceImages:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
function sortPrompts(){prompts.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')))}
function cloneData(data){return JSON.parse(JSON.stringify(data))}
function setSavedSnapshot(){savedPrompts=cloneData(prompts)}
function restoreSavedPrompt(promptId){
  if(!promptId)return;
  const i=prompts.findIndex(p=>p.id===promptId);
  if(i<0)return;
  const original=savedPrompts.find(p=>p.id===promptId);
  if(original)prompts[i]=cloneData(original);
}

/* ── API layer with IndexedDB fallback ── */
const serverApi=(url,opt={})=>fetch(url,{headers:{'Content-Type':'application/json'},...opt}).then(async r=>{if(!r.ok){let e='请求失败';try{e=(await r.json()).error||e}catch{/* Ignore non-JSON error responses and use the default message. */}throw new Error(e)}return r.headers.get('content-type')?.includes('json')?r.json():r.text()});

async function api(url,opt={}){
  if(serverMode){
    try{return await serverApi(url,opt)}
    catch(e){
      if(e instanceof TypeError||e.message==='Failed to fetch'){
        serverMode=false;
        setDot(false);
        return await api(url,opt);
      }
      throw e;
    }
  }
  /* local mode handlers */
  const method=(opt.method||'GET').toUpperCase();
  if(url==='/api/prompts'&&method==='GET') return await dbGetAll();
  if(url==='/api/prompts'&&method==='POST'){
    const d=JSON.parse(opt.body);await dbPutAll(d);return{ok:true};
  }
  if(url==='/api/image'&&method==='POST'){
    const b=JSON.parse(opt.body);const key='local:'+id();
    await dbPutImg(key,{dataUrl:b.data,name:b.name,lastModified:b.lastModified});
    return{ok:true,image:key,modified:b.lastModified};
  }
  if(url==='/api/delete-image'&&method==='POST'){
    const b=JSON.parse(opt.body);
    if(isLocalImg(b.image))await dbDelImg(b.image);
    return{ok:true};
  }
  throw new Error('本地模式: 未知请求');
}

const imgPath=p=>imagesOf(p)[0]||'';

const pathUrl=path=>path?(isLocalImg(path)?'':'/data/'+path):'';
function current(){let p=prompts.find(p=>p.id===currentId);if(p)return p;if(draft&&draft.id===currentId)return draft;draft=blank();currentId=draft.id;return draft}
const saved=p=>!!p&&prompts.some(x=>x.id===p.id);
function imagesOf(p){return [...new Set([...(Array.isArray(p?.images)?p.images:[]),p?.image].filter(Boolean))]}
function setImages(p,imgs){p.images=[...new Set(imgs.filter(Boolean))];p.image=p.images[0]||'';if(!p.imageDates||typeof p.imageDates!=='object')p.imageDates={};Object.keys(p.imageDates).forEach(k=>{if(!p.images.includes(k))delete p.imageDates[k]})}
const sourceImagesOf=p=>[...new Set(Array.isArray(p?.sourceImages)?p.sourceImages.filter(Boolean):[])]
function setSourceImages(p,imgs){p.sourceImages=[...new Set(imgs.filter(Boolean))]}
const empty=p=>!((p.title||'').trim()||(p.prompt||'').trim()||imagesOf(p).length||sourceImagesOf(p).length);
const titleOf=p=>(p.title||t('unnamed')).trim();
const modeOf=p=>sourceImagesOf(p).length?t('filterImage'):t('filterText');
const countText=(n,one,many)=>`${n} ${t(n===1?one:many)}`;
const esc=s=>String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const MODEL_NAMES=['GPT Image','Nano Banana','Midjourney'];
function normalizeModelName(name){
  const v=String(name||'').trim(),key=v.replace(/\s+/g,'').toLowerCase();
  if(key==='gptimage2')return 'GPT Image';
  if(key==='nanobanana'||key==='nanobanana2'||key==='nanobananapro')return 'Nano Banana';
  return v;
}
function renderModelDrop(){$('modelDrop').innerHTML=MODEL_NAMES.map(n=>`<div data-v="${esc(n)}">${esc(n)}</div>`).join('')+'<div class="custom">自定义</div>'}
async function copyPrompt(){
  const text=$('prompt')?.value||'';
  try{await navigator.clipboard.writeText(text)}
  catch(e){
    const ta=document.createElement('textarea');
    ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
  }
}
function setDot(on){const d=$('statusDot');d.className='statusDot '+(on?'on':'off');d.title=on?t('connected'):t('offline');d.dataset.label=on?'':t('offline');const dataLabel=document.querySelector('.sideStats div+div span');if(dataLabel)dataLabel.textContent=on?t('statLocal'):t('statBrowser')}
function syncFromForm(options={}){
  const p=current();
  if(saved(p)&&!options.force)return p;
  p.title=$('title').value.trim();
  p.prompt=$('prompt').value;
  p.model=normalizeModelName($('modelName').value);
  delete p.tags;
  p.updatedAt=new Date().toISOString();
  return p;
}
async function saveAll(){await api('/api/prompts',{method:'POST',body:JSON.stringify(prompts)});setSavedSnapshot()}
const toastTimers={};
function showToast(id){
  const t=$(id);
  if(!t)return;
  clearTimeout(toastTimers[id]);
  t.classList.add('on');
  toastTimers[id]=setTimeout(()=>t.classList.remove('on'),2500);
}
function showSaveToast(){showToast('saveToast')}
function showCopyToast(){showToast('copyToast')}
function reportError(action,err){console.error(`[MYP] ${action} failed:`,err);}
let promptExpandTimer=null;
function setPromptExpanded(on,instant=false){
  const field=$('promptField'),ta=$('prompt'),btn=$('promptExpandBtn'),form=$('form');
  if(!field||!ta||!btn)return;
  clearTimeout(promptExpandTimer);
  if(on){
    const mark=$('stageCopyBtn')?.getBoundingClientRect().top||window.innerHeight-64;
    const top=ta.getBoundingClientRect().top;
    ta.style.height=Math.max(260,Math.round(mark-top))+'px';
    form?.classList.add('promptExpanded');
    field.classList.add('expanded');
  }else{
    if(instant){
      ta.style.height='';
      field.classList.remove('expanded');
      form?.classList.remove('promptExpanded');
    }else{
    ta.style.height=ta.getBoundingClientRect().height+'px';
    ta.offsetHeight;
    field.classList.remove('expanded');
    requestAnimationFrame(()=>ta.style.height='150px');
    promptExpandTimer=setTimeout(()=>{ta.style.height='';form?.classList.remove('promptExpanded');scheduleMediaFit()},260);
    }
  }
  scheduleMediaFit();
  btn.setAttribute('aria-expanded',on?'true':'false');
  btn.setAttribute('aria-label',on?'收起提示词':'展开提示词');
}
function fitPromptExpand(){if($('promptField')?.classList.contains('expanded'))setPromptExpanded(true)}
let mediaFitQueued=false;
function scheduleMediaFit(){
  if(mediaFitQueued)return;
  mediaFitQueued=true;
  requestAnimationFrame(()=>{
    mediaFitQueued=false;
    fitMediaLayout();
    requestAnimationFrame(fitMediaLayout);
  });
}
function fitMediaLayout(){
  const form=$('form'),strip=$('imageStrip'),source=$('sourceStrip'),footer=document.querySelector('.footerBtns'),copy=$('stageCopyBtn');
  if(!form||!strip||!source)return;
  if(form.classList.contains('promptExpanded'))return;
  form.style.removeProperty('--media-thumb');
  form.style.removeProperty('--media-frame');
  form.style.removeProperty('--source-strip-height');
  if(strip.classList.contains('on')&&strip.querySelector('.imageThumb')){
    const s=getComputedStyle(strip);
    const pad=(parseFloat(s.paddingLeft)||0)+(parseFloat(s.paddingRight)||0);
    const borderX=(parseFloat(s.borderLeftWidth)||0)+(parseFloat(s.borderRightWidth)||0);
    const chrome=(parseFloat(s.paddingTop)||0)+(parseFloat(s.paddingBottom)||0)+(parseFloat(s.borderTopWidth)||0)+(parseFloat(s.borderBottomWidth)||0);
    const width=Math.max(120,strip.clientWidth-pad);
    const footerTop=footer?.getBoundingClientRect().top;
    const maxBottom=(footerTop||copy?.getBoundingClientRect().bottom||form.getBoundingClientRect().bottom)-2;
    const size=Math.max(96,Math.min(width,maxBottom-strip.getBoundingClientRect().top-chrome));
    form.style.setProperty('--media-thumb',Math.floor(size)+'px');
    form.style.setProperty('--media-frame',Math.ceil(size+pad+borderX)+'px');
  }
  requestAnimationFrame(()=>{
    if(!source.classList.contains('on'))return;
    if(!strip.classList.contains('on'))return;
    const h=Math.max(0,strip.getBoundingClientRect().bottom-source.getBoundingClientRect().top);
    form.style.setProperty('--source-strip-height',Math.round(h)+'px');
  });
}
function resetPromptBeforeSwitch(){
  document.querySelector('.app')?.classList.add('switching');
  setPromptExpanded(false,true);
  const form=$('form');if(form)form.scrollTop=0;
}

let heroTitleText='MYP';
const heroCanvas=document.createElement('canvas');
const heroCtx=heroCanvas.getContext('2d');
function fontFor(el){const s=getComputedStyle(el);return `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`}
function titleSegments(text){return (window.Intl&&Intl.Segmenter)?[...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(text)].map(s=>s.segment):Array.from(text)}
const HERO_TITLE_LAYOUT_LIMIT=420;
function limitHeroTitleText(text,limit=HERO_TITLE_LAYOUT_LIMIT){
  const value=normalizeHeroTitle(text),chars=[];
  let clipped=false,count=0;
  if(window.Intl&&Intl.Segmenter){
    for(const item of new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(value)){
      if(count>=limit){clipped=true;break}
      chars.push(item.segment);count++;
    }
  }else{
    for(const ch of value){
      if(count>=limit){clipped=true;break}
      chars.push(ch);count++;
    }
  }
  return {text:clipped?chars.join(''):value,clipped};
}
function visualTitleText(text){return String(text||'').toLocaleUpperCase()}
function textWidth(text,font,letterSpacing=0){
  heroCtx.font=font;
  const chars=titleSegments(text);
  return chars.reduce((w,ch,i)=>w+heroCtx.measureText(ch).width+(i?letterSpacing:0),0);
}
function inkLeft(text,font,letterSpacing=0){
  const width=Math.max(80,Math.ceil(textWidth(text,font,letterSpacing)+120)),height=180;
  heroCanvas.width=width;heroCanvas.height=height;
  heroCtx.clearRect(0,0,width,height);
  heroCtx.font=font;heroCtx.fillStyle='#fff';heroCtx.textBaseline='alphabetic';
  let x=60;
  for(const ch of titleSegments(text)){heroCtx.fillText(ch,x,120);x+=heroCtx.measureText(ch).width+letterSpacing}
  const data=heroCtx.getImageData(0,0,width,height).data;
  for(let px=0;px<width;px++){
    for(let py=0;py<height;py++){
      if(data[(py*width+px)*4+3]>20)return px-60;
    }
  }
  return 0;
}
function normalizeHeroTitle(text){return String(text||'MYP').replace(/\s+/g,' ').trim()||'MYP'}
function titleParts(text){return normalizeHeroTitle(text).split(/(\s+)/u).filter(Boolean).map(part=>/\s/u.test(part)?' ':part)}
function ellipsisLine(line,font,letterSpacing,maxWidth){
  const dots='…';
  let chars=titleSegments(line.replace(/\s+$/u,''));
  while(chars.length&&textWidth(visualTitleText(chars.join('')+dots),font,letterSpacing)>maxWidth)chars.pop();
  return (chars.join('')||dots)+dots;
}
function wrapHeroTitle(text,font,letterSpacing,maxWidth,lineLimit=20){
  const lines=[];
  let line='',pendingSpace='';
  const fits=value=>textWidth(visualTitleText(value),font,letterSpacing)<=maxWidth;
  const pushLine=()=>{
    const clean=line.replace(/\s+$/u,'');
    if(clean)lines.push(clean);
    line='';pendingSpace='';
  };
  const addGraphemes=value=>{
    for(const ch of titleSegments(value)){
      const next=line+ch;
      if(line&&!fits(next)){pushLine();line=ch}
      else line=next;
      if(lines.length>=lineLimit)return false;
    }
    return true;
  };
  for(const part of titleParts(text)){
    if(part===' '){if(line)pendingSpace=' ';continue}
    const next=line+(line&&pendingSpace?pendingSpace:'')+part;
    if(fits(next)){line=next;pendingSpace='';continue}
    if(line)pushLine();
    if(lines.length>=lineLimit)return {lines,truncated:true};
    pendingSpace='';
    if(fits(part)){line=part;continue}
    if(!addGraphemes(part))return {lines,truncated:true};
  }
  if(line)pushLine();
  return {lines,truncated:false};
}
const wait=ms=>new Promise(res=>setTimeout(res,ms));
let transitionBusy=false;
async function transitionView(work){
  if(transitionBusy){return work()}
  transitionBusy=true;
  const root=document.querySelector('.app');
  let releaseTimer=null;
  const release=()=>{
    root?.classList.remove('switching');
  };
  root?.classList.add('switching');
  try{
    await wait(170);
    releaseTimer=setTimeout(release,260);
    const out=await work();
    return out;
  }finally{
    clearTimeout(releaseTimer);
    release();
    scheduleMediaFit();
    transitionBusy=false;
  }
}
function updateDraftBrand(value){
  const p=current();
  const titleValue=value===undefined?(p.title||''):value;
  document.querySelector('.stage')?.classList.toggle('isDraftBlank',!saved(p)&&!String(titleValue||'').trim());
}
function layoutHeroTitle(text=heroTitleText){
  heroTitleText=normalizeHeroTitle(text);
  const layoutTitle=limitHeroTitleText(heroTitleText);
  const title=$('heroTitle'),eyebrow=document.querySelector('.eyebrow'),hero=document.querySelector('.heroText');
  const outline=document.querySelector('.outline'),stage=document.querySelector('.stage');
  if(!title||!eyebrow||!hero||!outline)return;
  const strokeBuffer=14;
  const minFont=28,maxFont=86.25,lineHeight=1.16;
  const eyebrowStyle=getComputedStyle(eyebrow),eyebrowFont=fontFor(eyebrow),eyebrowSpacing=parseFloat(eyebrowStyle.letterSpacing)||0;
  const target=(parseFloat(eyebrowStyle.marginLeft)||0)+inkLeft(visualTitleText(eyebrow.textContent.trim()),eyebrowFont,eyebrowSpacing);
  const maxWidth=Math.max(80,hero.clientWidth-target-strokeBuffer);
  const safeHeight=Math.max(126,Math.min(248,(stage?.clientHeight||690)*.36));
  const maxLines=Math.max(2,Math.min(4,Math.floor(safeHeight/(minFont*lineHeight))));
  let best=null;
  for(let size=maxFont;size>=minFont;size-=2){
    title.style.setProperty('--hero-title-size',`${size}px`);
    title.style.setProperty('--hero-title-leading',String(lineHeight));
    const titleFont=fontFor(title),titleSpacing=parseFloat(getComputedStyle(title).letterSpacing)||0;
    const wrapped=wrapHeroTitle(layoutTitle.text,titleFont,titleSpacing,maxWidth,maxLines+1);
    if(!wrapped.truncated&&wrapped.lines.length<=maxLines&&wrapped.lines.length*size*lineHeight<=safeHeight){best={size,font:titleFont,spacing:titleSpacing,lines:wrapped.lines};break}
  }
  if(!best){
    title.style.setProperty('--hero-title-size',`${minFont}px`);
    title.style.setProperty('--hero-title-leading',String(lineHeight));
    const titleFont=fontFor(title),titleSpacing=parseFloat(getComputedStyle(title).letterSpacing)||0;
    const wrapped=wrapHeroTitle(layoutTitle.text,titleFont,titleSpacing,maxWidth,maxLines);
    const lines=wrapped.lines.length?wrapped.lines:['MYP'];
    if(wrapped.truncated||layoutTitle.clipped||textWidth(visualTitleText(lines[lines.length-1]),titleFont,titleSpacing)>maxWidth){
      lines[lines.length-1]=ellipsisLine(lines[lines.length-1],titleFont,titleSpacing,maxWidth);
    }
    best={size:minFont,font:titleFont,spacing:titleSpacing,lines};
  }else if(layoutTitle.clipped&&best.lines.length){
    best.lines[best.lines.length-1]=ellipsisLine(best.lines[best.lines.length-1],best.font,best.spacing,maxWidth);
  }
  title.style.setProperty('--hero-title-size',`${best.size}px`);
  title.innerHTML=best.lines.map(line=>{
    const shift=target-inkLeft(visualTitleText(line),best.font,best.spacing);
    return `<span class="heroTitleLine" style="--line-shift:${Math.round(shift)}px">${esc(line)}</span>`;
  }).join('');
  title.style.setProperty('--title-y','0px');
  const isDraftBrand=stage?.classList.contains('isDraftBlank')&&heroTitleText==='MYP';
  if(isDraftBrand)return;
  const titleRect=title.getBoundingClientRect(),eyebrowRect=eyebrow.getBoundingClientRect(),outlineRect=outline.getBoundingClientRect(),stageRect=stage?.getBoundingClientRect();
  let centeredTop=(eyebrowRect.bottom+outlineRect.top-titleRect.height)/2+12;
  if(stageRect)centeredTop=Math.max(stageRect.top+36,Math.min(centeredTop,stageRect.bottom-titleRect.height-76));
  title.style.setProperty('--title-y',`${Math.round(centeredTop-titleRect.top)}px`);
}

/* ── Image helpers ── */
async function resolveImgSrc(src){
  if(!src)return '';
  if(isLocalImg(src)){const r=await dbGetImg(src);return r?.dataUrl||''}
  return pathUrl(src);
}
const thumbCache=new Map();
async function resolveThumbSrc(src,max=220){
  if(!src)return '';
  const key=src+'@'+max;
  if(thumbCache.has(key))return thumbCache.get(key);
  const full=await resolveImgSrc(src);
  if(!full)return '';
  const out=await new Promise(res=>{
    const img=new Image();
    img.onload=()=>{
      const largest=Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height);
      if(!largest||largest<=max){res(full);return}
      const scale=max/largest,w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale)),h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      canvas.width=w;canvas.height=h;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,w,h);
      const webp=canvas.toDataURL('image/webp',.95);
      res(webp.startsWith('data:image/webp')?webp:canvas.toDataURL('image/jpeg',.94));
    };
    img.onerror=()=>res(full);
    img.src=full;
  });
  thumbCache.set(key,out);
  return out;
}
async function localFileToDataUrl(file){
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(file)});
}

/* ── Render ── */
function matchList(p,q=$('search').value.trim().toLowerCase()){
  const mode=modeOf(p),matchFilter=listFilter==='all'||(listFilter==='image'?mode===t('filterImage'):mode===t('filterText'));
  return matchFilter&&[p.title,p.prompt,p.model,mode].join('\n').toLowerCase().includes(q);
}
function updateListActiveFrame(){
  const list=$('list');
  if(!list)return;
  const active=list.querySelector('.item.on');
  if(!active){list.style.setProperty('--active-opacity','0');return}
  list.style.setProperty('--active-height',`${active.offsetHeight}px`);
  list.style.setProperty('--active-top',`${active.offsetTop}px`);
  list.style.setProperty('--active-opacity','1');
}
function renderList(){
  const q=$('search').value.trim().toLowerCase();
  document.querySelectorAll('.filterBtn').forEach(btn=>btn.classList.toggle('on',btn.dataset.filter===listFilter));
  const rows=prompts.filter(p=>matchList(p,q));
  $('count').textContent=prompts.length;
  const previewCache={};
  const renderItems=async()=>{
    for(const p of rows){const src=imgPath(p);previewCache[p.id]=await resolveThumbSrc(src,320)}
    $('list').innerHTML=rows.length?rows.map((p,i)=>{const mode=modeOf(p);return `<div class="item ${p.id===currentId?'on':''}" data-id="${p.id}"><div class="thumb">${previewCache[p.id]?`<img src="${previewCache[p.id]}">`:''}</div><div class="entryBody"><div class="num">${String(i+1).padStart(2,'0')}</div><h3>${esc(titleOf(p))}</h3><div class="metaPills"><span class="modelName">${esc(p.model||t('noModel'))}</span></div><div class="itemMode">${mode}</div></div></div>`}).join(''):`<div class="empty">${t('emptyMsg')}</div>`;
    document.querySelectorAll('.item').forEach(el=>el.onclick=()=>select(el.dataset.id));
    updateListActiveFrame();
  };
  renderItems();
}
async function renderForm(){
  const p=current(),imgs=imagesOf(p),srcs=sourceImagesOf(p),has=!!imgs.length,hasSource=!!srcs.length;
  setImages(p,imgs);setSourceImages(p,srcs);
  $('title').value=p.title||'';$('prompt').value=p.prompt||'';$('modelName').value=p.model||'';$('modelDrop').classList.remove('open');
  updateDraftBrand(p.title||'');
  layoutHeroTitle(p.title||'MYP');
  const mainSrc=await resolveImgSrc(imgPath(p));
  $('heroImg').src=mainSrc;$('heroImg').style.display=mainSrc?'block':'none';
  document.querySelector('.stage').classList.toggle('hasImage',!!mainSrc);
  $('uploadPreview').src=mainSrc;$('uploadBox').classList.toggle('hasImage',has);
  $('uploadTitle').textContent=has?countText(imgs.length,'imgUploaded','imgsUploaded'):t('uploadImage');
  $('uploadHint').textContent=has?t('clickContinueImage'):t('uploadHint');
  $('imageName').textContent=has?t('clickPreview'):t('noImage');
  $('imageStrip').classList.toggle('on',has);
  $('imageStrip').style.setProperty('--thumb-count',Math.max(1,imgs.length));
  const imgSrcs={};for(const s of imgs)imgSrcs[s]=await resolveImgSrc(s);
  $('imageStrip').innerHTML=imgs.map(src=>`<button type="button" class="imageThumb" data-src="${esc(src)}"><img src="${imgSrcs[src]||''}"><span class="imgDel" data-del="${esc(src)}"><svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg></span></button>`).join('');
  document.querySelectorAll('.imageThumb:not(.sourceThumb)').forEach(btn=>{btn.onclick=e=>{e.stopPropagation();openLightbox(btn.dataset.src,imagesOf(current()))};btn.querySelector('.imgDel')?.addEventListener('click',e=>{e.stopPropagation();deleteSingleImage(btn.dataset.src,'generated')})});
  const srcSrc=await resolveImgSrc(srcs[0]||'');
  $('sourcePreview').src=srcSrc;$('sourceBox').classList.toggle('hasImage',hasSource);
  $('sourceTitle').textContent=hasSource?countText(srcs.length,'srcUploaded','srcsUploaded'):t('uploadSource');
  $('sourceHint').textContent=hasSource?t('clickContinueSource'):t('uploadHint');
  $('sourceName').textContent=hasSource?t('clickPreview'):t('noSource');
  $('sourceStrip').classList.toggle('on',hasSource);
  $('sourceStrip').style.setProperty('--thumb-count',Math.max(1,srcs.length));
  const srcImgs={};for(const s of srcs)srcImgs[s]=await resolveImgSrc(s);
  $('sourceStrip').innerHTML=srcs.map(src=>`<button type="button" class="imageThumb sourceThumb" data-src="${esc(src)}"><img src="${srcImgs[src]||''}"><span class="imgDel" data-del="${esc(src)}"><svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg></span></button>`).join('');
  document.querySelectorAll('.sourceThumb').forEach(btn=>{btn.onclick=e=>{e.stopPropagation();openLightbox(btn.dataset.src,sourceImagesOf(current()))};btn.querySelector('.imgDel')?.addEventListener('click',e=>{e.stopPropagation();deleteSingleImage(btn.dataset.src,'source')})});
  renderList();
  scheduleMediaFit();
}
async function select(nextId){
  if(nextId===currentId)return;
  restoreSavedPrompt(currentId);
  resetPromptBeforeSwitch();
  await transitionView(async()=>{if(draft&&draft.id!==nextId)draft=null;currentId=nextId;await renderForm()});
}
async function saveCurrent(msg=t('savedMsg')){
  syncFromForm({force:true}); const p=current();
  if(!saved(p)&&empty(p)){return false}
  if(!saved(p)){prompts.push(p);draft=null}
  sortPrompts();
  await saveAll();renderForm();
  return true;
}
async function startDraft(){
  restoreSavedPrompt(currentId);
  resetPromptBeforeSwitch();
  await transitionView(async()=>{draft=blank();currentId=draft.id;await renderForm()});
}
function validImage(file){return ((/\.(jpe?g|png)$/i.test(file.name)||/image\/(jpeg|png)/.test(file.type))&&file.size<=MAX_IMAGE_BYTES)}
async function uploadFiles(fileList,target='generated'){
  const files=[...fileList].filter(Boolean);
  if(!files.length)return;
  if(files.some(file=>!validImage(file))){files.filter(file=>!validImage(file)).forEach(file=>console.error('[MYP] image upload rejected:',file.name,file.size,'bytes. Only JPG/PNG up to 80MB is allowed.'));return}
  syncFromForm({force:true}); const p=current(),wasDraft=!saved(p);

  const imgs=target==='source'?sourceImagesOf(p):imagesOf(p);
  for(const file of files){
    const data=await localFileToDataUrl(file);
    const modified=new Date(file.lastModified||Date.now()).toISOString();
    const out=await api('/api/image',{method:'POST',body:JSON.stringify({id:p.id,name:file.name,data,lastModified:modified,oldImage:''})});
    imgs.push(out.image);
    if(target!=='source'){
      if(!p.imageDates||typeof p.imageDates!=='object')p.imageDates={};
      p.imageDates[out.image]=out.modified||modified;
    }
  }
  if(target==='source'){setSourceImages(p,imgs);$('sourceInput').value=''}else{setImages(p,imgs);$('imageInput').value=''}
  if(wasDraft){renderForm();return}
  await saveAll();
  await renderForm();
}
async function deleteImages(p){for(const image of imagesOf(p)){await api('/api/delete-image',{method:'POST',body:JSON.stringify({image})})}p.imageDates={};delete p.imageDate;setImages(p,[])}
async function deleteSourceImages(p){for(const image of sourceImagesOf(p)){await api('/api/delete-image',{method:'POST',body:JSON.stringify({image})})}setSourceImages(p,[])}
async function deleteSingleImage(src,target){
  syncFromForm({force:true}); const p=current();
  await api('/api/delete-image',{method:'POST',body:JSON.stringify({image:src})});
  if(target==='source'){const s=sourceImagesOf(p).filter(x=>x!==src);setSourceImages(p,s)}
  else{if(p.imageDates)delete p.imageDates[src];const s=imagesOf(p).filter(x=>x!==src);setImages(p,s)}
  if(saved(p))await saveAll();
  renderForm();
}
async function deleteAllImages(p){await deleteImages(p);await deleteSourceImages(p)}
let closeConfirmButton=null;
function confirmButton(btn,action){
  if(btn.classList.contains('confirming'))return;
  if(closeConfirmButton)closeConfirmButton();
  const html=btn.innerHTML;
  let restored=false;
  const restore=()=>new Promise(res=>{
    if(restored){res();return}
    restored=true;
    document.removeEventListener('click',outside,true);
    if(closeConfirmButton===restore)closeConfirmButton=null;
    btn.classList.add('confirmOut');
    setTimeout(()=>{btn.classList.remove('confirming','confirmOut');btn.innerHTML=html;btn.onclick=()=>confirmButton(btn,action);res()},140);
  });
  const outside=e=>{if(!btn.contains(e.target))restore()};
  closeConfirmButton=restore;
  document.addEventListener('click',outside,true);
  btn.classList.add('confirming');
  btn.innerHTML=`<span data-ok>${t('confirm')}</span><span data-cancel>${t('cancel')}</span>`;
  btn.onclick=async e=>{
    e.stopPropagation();
    if(e.target.closest('[data-ok]')){await restore();try{await action()}catch(err){reportError('confirmed action',err)}}
    else if(e.target.closest('[data-cancel]'))await restore();
  };
}
async function clearGeneratedImages(){
  const p=current();if(!imagesOf(p).length)return;
  syncFromForm({force:true});const wasDraft=!saved(p);await deleteImages(p);
  if(wasDraft){renderForm();return}
  await saveAll();
  await renderForm();
}
async function clearOriginalImages(){
  const p=current();if(!sourceImagesOf(p).length)return;
  syncFromForm({force:true});const wasDraft=!saved(p);await deleteSourceImages(p);
  if(wasDraft){renderForm();return}
  await saveAll();
  await renderForm();
}
async function deleteCurrentProject(){
  const p=current();
  if(!saved(p)){await deleteAllImages(p);await startDraft();return}
  await deleteAllImages(p);
  prompts=prompts.filter(x=>x.id!==p.id);
  if(prompts.length){currentId=prompts[0].id}else{draft=blank();currentId=draft.id}
  await saveAll();renderForm();
}
async function renderLightbox(){
  const src=lightboxImages[lightboxIndex]||'';
  const img=$('lightboxImg');
  img.onload=positionLightboxTools;
  img.src=await resolveImgSrc(src);
  const multi=lightboxImages.length>1;
  $('lightboxPrev').hidden=!multi;
  $('lightboxNext').hidden=!multi;
  requestAnimationFrame(positionLightboxTools);
}
async function openLightbox(src,gallery){
  lightboxImages=[...new Set((Array.isArray(gallery)&&gallery.length?gallery:[src]).filter(Boolean))];
  lightboxIndex=Math.max(0,lightboxImages.indexOf(src));
  await renderLightbox();
  $('lightbox').classList.add('on');
  requestAnimationFrame(positionLightboxTools);
}
function stepLightbox(dir){
  if(!$('lightbox').classList.contains('on')||lightboxImages.length<2)return;
  lightboxIndex=(lightboxIndex+dir+lightboxImages.length)%lightboxImages.length;
  renderLightbox();
}
function positionLightboxTools(){
  const box=$('lightbox'),img=$('lightboxImg');
  if(!box.classList.contains('on')||!img.complete||!img.naturalWidth)return;
  const br=box.getBoundingClientRect(),ir=img.getBoundingClientRect();
  box.style.setProperty('--tools-top',Math.max(8,Math.round(ir.top-br.top-64))+'px');
  box.style.setProperty('--tools-right',Math.max(8,Math.round(br.right-ir.right-80))+'px');
}
async function downloadLightboxImage(){
  const src=lightboxImages[lightboxIndex]||'';if(!src)return;
  const url=await resolveImgSrc(src),blob=await fetch(url).then(r=>r.blob());
  const name=(decodeURIComponent(String(src).split('/').pop()||'image.png')).replace(/[\\/:*?"<>|]/g,'_');
  if(window.showSaveFilePicker){
    const ext=(name.split('.').pop()||'png').toLowerCase(),mime=blob.type||'image/png';
    const handle=await showSaveFilePicker({suggestedName:name,types:[{description:'Image',accept:{[mime]:['.'+ext]}}]});
    const w=await handle.createWritable();await w.write(blob);await w.close();return;
  }
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0);
}
function closeLightbox(){const box=$('lightbox');if(!box.classList.contains('on'))return;box.classList.remove('on');setTimeout(()=>{if(box.classList.contains('on'))return;$('lightboxImg').onload=null;$('lightboxImg').src='';lightboxImages=[];lightboxIndex=0;$('lightboxPrev').hidden=true;$('lightboxNext').hidden=true},240)}
function previewStage(){const imgs=imagesOf(current());if(imgs.length)openLightbox(imgPath(current())||imgs[0],imgs)}
function setupMediaLayout(){
  const generated=$('uploadBox').closest('.field'),source=$('sourceBox').closest('.field');
  if(!generated||!source||generated.parentElement?.classList.contains('mediaGrid'))return;
  generated.classList.add('mediaField','generatedField');
  source.classList.add('mediaField','sourceField');
  const grid=document.createElement('div');
  grid.className='mediaGrid';
  source.before(grid);
  grid.append(generated,source);
}

setupMediaLayout();
renderModelDrop();

/* ── Theme Toggle ── */
const THEME_KEY='myp-theme';
const getTheme=()=>document.documentElement.getAttribute('data-theme')||'dark';
function themeEase(t){
  const x1=.25,y1=.46,x2=.45,y2=.94,bez=(a,b,u)=>3*a*(1-u)*(1-u)*u+3*b*(1-u)*u*u+u*u*u;
  let u=t;
  for(let i=0;i<5;i++){
    const x=bez(x1,x2,u),dx=3*x1*(1-u)*(1-u)+6*(x2-x1)*(1-u)*u+3*(1-x2)*u*u;
    if(!dx)break;
    u=Math.max(0,Math.min(1,u-(x-t)/dx));
  }
  return bez(y1,y2,u);
}
const setTheme=(theme,animate=true)=>{
  const oldTheme=getTheme();
  if(oldTheme===theme)return;
  
  if(animate){
    const root=document.documentElement;
    const scrollFrom=oldTheme==='light'?'#faf8f4':'#0c0c0c';
    const fromRgb=oldTheme==='light'?[250,248,244]:[12,12,12];
    const toRgb=theme==='light'?[250,248,244]:[12,12,12];
    const gradientVars=['--bg-gradient-bottom','--bg-gradient-mid','--bg-gradient-top'];
    const gradientFrom=oldTheme==='light'?[[245,243,237,.92],[245,243,237,.72],[245,243,237,.34]]:[[5,5,5,.82],[5,5,5,.62],[5,5,5,.24]];
    const gradientTo=theme==='light'?[[245,243,237,.92],[245,243,237,.72],[245,243,237,.34]]:[[5,5,5,.82],[5,5,5,.62],[5,5,5,.24]];
    root.style.setProperty('--scroll-track',scrollFrom);
    gradientVars.forEach((v,i)=>{const c=gradientFrom[i];root.style.setProperty(v,`rgba(${c[0]},${c[1]},${c[2]},${c[3]})`)});
    root.getBoundingClientRect();
    const btn=$('themeToggle');
    const rect=btn.getBoundingClientRect();
    const x=rect.left+rect.width/2;
    const y=rect.top+rect.height/2;
    
    /* Create ripple */
    const ripple=document.createElement('div');
    ripple.className='themeRipple';
    ripple.style.left=x+'px';
    ripple.style.top=y+'px';
    ripple.style.width='200vmax';
    ripple.style.height='200vmax';
    ripple.style.marginLeft='-100vmax';
    ripple.style.marginTop='-100vmax';
    ripple.style.background=theme==='light'?'#F5F3ED':'#050505';
    document.body.appendChild(ripple);
    
    /* Trigger expansion */
    requestAnimationFrame(()=>{
      /* Switch theme — CSS transitions start NOW */
      root.setAttribute('data-theme',theme);
      const startTime=performance.now(),duration=800;
      const stepScroll=now=>{
        const p=Math.min((now-startTime)/duration,1);
        const e=themeEase(p);
        const rgb=fromRgb.map((v,i)=>Math.round(v+(toRgb[i]-v)*e));
        root.style.setProperty('--scroll-track',`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
        gradientVars.forEach((v,i)=>{
          const a=gradientFrom[i],b=gradientTo[i],rgb=a.slice(0,3).map((n,j)=>Math.round(n+(b[j]-n)*e)),alpha=a[3]+(b[3]-a[3])*e;
          root.style.setProperty(v,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`);
        });
        if(p<1)requestAnimationFrame(stepScroll);
        else {root.style.removeProperty('--scroll-track');gradientVars.forEach(v=>root.style.removeProperty(v))}
      };
      stepScroll(startTime);
      localStorage.setItem(THEME_KEY,theme);
      btn.classList.toggle('light',theme==='light');
      ripple.classList.add('expanding');
      
      /* Sync accent color with new theme */
      const accentDark=getComputedStyle(document.documentElement).getPropertyValue('--accent-dark').trim()||'#d4ff00';
      const accentLight=getComputedStyle(document.documentElement).getPropertyValue('--accent-light').trim()||'#96C93B';
      document.documentElement.style.setProperty('--accent',theme==='light'?accentLight:accentDark);
      const accentBtn=$('accentBtnInner');
      if(accentBtn)accentBtn.style.background=theme==='light'?accentLight:accentDark;
      buildSwatches(currentAccentDark);
      setTimeout(()=>{ripple.remove()},850);
    });
  }else{
    document.documentElement.setAttribute('data-theme',theme);
    localStorage.setItem(THEME_KEY,theme);
    $('themeToggle').classList.toggle('light',theme==='light');
  }
};

/* Initialize theme */
const savedTheme=localStorage.getItem(THEME_KEY)||'dark';
document.documentElement.setAttribute('data-theme',savedTheme);
$('themeToggle').classList.toggle('light',savedTheme==='light');

/* Theme toggle click handler */
$('themeToggle').onclick=()=>{
  const newTheme=getTheme()==='dark'?'light':'dark';
  setTheme(newTheme);
};

/* ── Accent Color Picker ── */
const ACCENT_COLORS=[
  {dark:'#d4ff00',light:'#96C93B'},
  {dark:'#FDFF00',light:'#B7D232'},
  {dark:'#FC8613',light:'#D69A46'},
  {dark:'#1D99FF',light:'#4E9AE0'},
  {dark:'#FF0D61',light:'#CC465A'},
  {dark:'#C302FF',light:'#C92CD4'},
  {dark:'#ffffff',light:'#474747'}
];
const ACCENT_KEY='myp-accent';
let currentAccentDark='#d4ff00';

function setAccentColor(darkColor,lightColor,save=true){
  currentAccentDark=darkColor;
  const root=document.documentElement;
  root.style.setProperty('--accent-dark',darkColor);
  root.style.setProperty('--accent-light',lightColor);
  const theme=getTheme();
  root.style.setProperty('--accent',theme==='light'?lightColor:darkColor);
  const btn=$('accentBtnInner');
  if(btn)btn.style.background=theme==='light'?lightColor:darkColor;
  /* Rebuild swatches to exclude current color */
  buildSwatches(darkColor);
  if(save)localStorage.setItem(ACCENT_KEY,JSON.stringify({dark:darkColor,light:lightColor}));
}

function buildSwatches(excludeDark){
  const btn=$('accentBtn');
  btn.querySelectorAll('.accentSwatch').forEach(s=>s.remove());
  ACCENT_COLORS.filter(c=>c.dark!==excludeDark).forEach(c=>{
    const swatch=document.createElement('span');
    swatch.className='accentSwatch';
    swatch.dataset.dark=c.dark;
    swatch.dataset.light=c.light;
    swatch.style.background=getTheme()==='light'?c.light:c.dark;
    swatch.onclick=e=>{e.stopPropagation();setAccentColor(c.dark,c.light);btn.classList.remove('open');$('langBtn').classList.remove('shifted');};
    btn.appendChild(swatch);
  });
}

buildSwatches(currentAccentDark);

/* Accent button toggle expand */
$('accentBtn').onclick=e=>{
  e.stopPropagation();
  const isOpen=$('accentBtn').classList.toggle('open');
  $('langBtn').classList.toggle('shifted',isOpen);
};

/* Close when clicking outside */
document.addEventListener('click',e=>{
  const btn=$('accentBtn');
  if(btn.classList.contains('open')&&!btn.contains(e.target)){
    btn.classList.remove('open');
    $('langBtn').classList.remove('shifted');
  }
});

/* Initialize accent color */
(function(){
  const saved=localStorage.getItem(ACCENT_KEY);
  if(saved){
    try{
      const c=JSON.parse(saved);
      const knownAccent=ACCENT_COLORS.find(item=>item.dark===c.dark&&item.light===c.light);
      if(knownAccent)setAccentColor(knownAccent.dark,knownAccent.light,false);
    }catch{/* Ignore malformed saved accent preference and fall back to default. */}
  }
  /* Ensure accent matches current theme */
  const theme=getTheme();
  const darkVar=getComputedStyle(document.documentElement).getPropertyValue('--accent-dark').trim();
  const lightVar=getComputedStyle(document.documentElement).getPropertyValue('--accent-light').trim();
  if(darkVar&&lightVar){
    document.documentElement.style.setProperty('--accent',theme==='light'?lightVar:darkVar);
    const btn=$('accentBtnInner');
    if(btn)btn.style.background=theme==='light'?lightVar:darkVar;
  }
})();

$('newBtn').onclick=startDraft;

/* ── Language Toggle ── */
const LANG_KEY='myp-lang';
let currentLang=localStorage.getItem(LANG_KEY)||'zh';
const LANG_MAP={
  zh:{
    search:'搜索标题',
    filterAll:'全部',
    filterText:'文生图',
    filterImage:'图生图',
    labelTitle:'标题',
    labelModel:'模型',
    labelPrompt:'提示词',
    labelGenerated:'生成图',
    labelSource:'原图',
    placeholderTitle:'请输入你的标题',
    placeholderPrompt:'请输入你的提示词',
    placeholderModel:'模型名',
    uploadImage:'点击上传图片',
    uploadSource:'点击上传原图',
    noImage:'未选择图片',
    noSource:'未选择原图',
    clearImage:'清空生成图',
    clearSource:'清空原图',
    deleteBtn:'删除当前项目',
    saveBtn:'保存',
    copyBtn:'复制提示词',
    copied:'提示词已复制',
    saved:'该项目已保存',
    statItems:'项目',
    statLocal:'本地',
    statBrowser:'浏览器',
    uploadHint:'JPG / PNG -> DATA/images',
    clickPreview:'点击缩略图可全屏预览',
    clickContinue:'点击继续添加原图',
    clickContinueImage:'点击继续添加生成图',
    clickContinueSource:'点击继续添加原图',
    imgUploaded:'张生成图已上传',
    imgsUploaded:'张生成图已上传',
    srcUploaded:'张原图已上传',
    srcsUploaded:'张原图已上传',
    unnamed:'未命名提示词',
    noModel:'未设模型',
    savedMsg:'已保存。',
    imgUpdated:'生成图已更新。',
    srcUpdated:'原图已更新。',
    download:'下载',
    confirm:'确定',
    cancel:'取消',
    connected:'已连接本地服务',
    offline:'本地服务离线 数据存储至浏览器',
    emptyMsg:'还没有已保存提示词。点左下角 NEW Prompt 新建。',
    custom:'自定义'
  },
  en:{
    search:'Search titles',
    filterAll:'All',
    filterText:'Text-to-Image',
    filterImage:'Image-to-Image',
    labelTitle:'Title',
    labelModel:'Model',
    labelPrompt:'Prompt',
    labelGenerated:'Output Image',
    labelSource:'Input Image',
    placeholderTitle:'Enter your title',
    placeholderPrompt:'Enter your prompt',
    placeholderModel:'Model name',
    uploadImage:'Click to Upload Output Image',
    uploadSource:'Click to Upload Input Image',
    noImage:'No output image selected',
    noSource:'No input image selected',
    clearImage:'Clear Output Image',
    clearSource:'Clear Input Image',
    deleteBtn:'Delete Current Project',
    saveBtn:'Save',
    copyBtn:'Copy Prompt',
    copied:'Prompt copied',
    saved:'Item saved',
    statItems:'Items',
    statLocal:'Local',
    statBrowser:'Browser',
    uploadHint:'JPG / PNG -> DATA/images',
    clickPreview:'Click thumbnail to preview',
    clickContinue:'Click to add more input images',
    clickContinueImage:'Click to add more output images',
    clickContinueSource:'Click to add more input images',
    imgUploaded:'output image uploaded',
    imgsUploaded:'output images uploaded',
    srcUploaded:'input image uploaded',
    srcsUploaded:'input images uploaded',
    unnamed:'Untitled',
    noModel:'No model set',
    savedMsg:'Saved.',
    imgUpdated:'Output image updated.',
    srcUpdated:'Input image updated.',
    download:'Down\nload',
    confirm:'Confirm',
    cancel:'Cancel',
    connected:'Local server connected',
    offline:'Local service offline Data stored in browser',
    emptyMsg:'No saved prompts yet. Click NEW Prompt to create one.',
    custom:'Custom'
  }
};
function t(key){return LANG_MAP[currentLang]?.[key]||LANG_MAP.zh[key]||key;}
function applyLang(){
  document.documentElement.setAttribute('data-lang',currentLang);
  const L=LANG_MAP[currentLang];
  const search=$('search');if(search)search.placeholder=L.search;
  document.querySelectorAll('.filterBtn').forEach(b=>{
    if(b.dataset.filter==='all')b.textContent=L.filterAll;
    else if(b.dataset.filter==='text')b.textContent=L.filterText;
    else if(b.dataset.filter==='image')b.textContent=L.filterImage;
  });
  document.querySelectorAll('.label').forEach(l=>{
    const txt=l.textContent.trim();
    if(txt==='标题'||txt==='Title')l.textContent=L.labelTitle;
    else if(txt==='模型'||txt==='Model')l.textContent=L.labelModel;
    else if(txt==='提示词'||txt==='Prompt')l.textContent=L.labelPrompt;
    else if(txt==='生成图'||txt==='Generated'||txt==='Output Image')l.textContent=L.labelGenerated;
    else if(txt==='原图'||txt==='Source'||txt==='Input Image')l.textContent=L.labelSource;
  });
  const title=$('title');if(title)title.placeholder=L.placeholderTitle;
  const prompt=$('prompt');if(prompt)prompt.placeholder=L.placeholderPrompt;
  const model=$('modelName');if(model)model.placeholder=L.placeholderModel;
  const clearImage=$('clearImageBtn');if(clearImage)clearImage.textContent=L.clearImage;
  const clearSource=$('clearSourceBtn');if(clearSource)clearSource.textContent=L.clearSource;
  const deleteBtn=$('deleteBtn');if(deleteBtn)deleteBtn.textContent=L.deleteBtn;
  const saveBtn=document.querySelector('.actions button[type=submit]');if(saveBtn)saveBtn.textContent=L.saveBtn;
  const stageCopySpan=document.querySelector('#stageCopyBtn span');if(stageCopySpan)stageCopySpan.textContent=L.copyBtn;
  const copyToastSpan=document.querySelector('#copyToast span');if(copyToastSpan)copyToastSpan.textContent=L.copied;
  const saveToastSpan=document.querySelector('#saveToast span');if(saveToastSpan)saveToastSpan.textContent=L.saved;
  const statItems=document.querySelector('.sideStats span');if(statItems&&statItems.closest('.sideStats')){
    const divs=statItems.closest('.sideStats').querySelectorAll('span');
    if(divs[0])divs[0].textContent=L.statItems;
    if(divs[1])divs[1].textContent=serverMode?L.statLocal:L.statBrowser;
  }
  const langBtn=$('langBtn');if(langBtn)langBtn.textContent=currentLang==='zh'?'中':'En';
  const lightboxDownload=$('lightboxDownload');if(lightboxDownload)lightboxDownload.textContent=L.download;
  /* Update model dropdown custom text */
  const customItem=document.querySelector('#modelDrop .custom');if(customItem)customItem.textContent=L.custom;
  /* Update upload box text based on current state */
  const uploadTitle=$('uploadTitle');if(uploadTitle){const p=current();const imgs=imagesOf(p);uploadTitle.textContent=imgs.length?`${imgs.length} ${imgs.length===1?L.imgUploaded:L.imgsUploaded}`:L.uploadImage;}
  const sourceTitle=$('sourceTitle');if(sourceTitle){const p=current();const srcs=sourceImagesOf(p);sourceTitle.textContent=srcs.length?`${srcs.length} ${srcs.length===1?L.srcUploaded:L.srcsUploaded}`:L.uploadSource;}
  const imageName=$('imageName');if(imageName){const p=current();const has=imagesOf(p).length;imageName.textContent=has?L.clickPreview:L.noImage;}
  const sourceName=$('sourceName');if(sourceName){const p=current();const has=sourceImagesOf(p).length;sourceName.textContent=has?L.clickPreview:L.noSource;}
  const uploadHint=$('uploadHint');if(uploadHint){const p=current();const has=imagesOf(p).length;uploadHint.textContent=has?L.clickContinueImage:L.uploadHint;}
  const sourceHint=$('sourceHint');if(sourceHint){const p=current();const has=sourceImagesOf(p).length;sourceHint.textContent=has?L.clickContinueSource:L.uploadHint;}
  const status=$('statusDot');if(status)setDot(!status.classList.contains('off'));
  renderList();
}
$('langBtn').onclick=()=>{
  currentLang=currentLang==='zh'?'en':'zh';
  localStorage.setItem(LANG_KEY,currentLang);
  applyLang();
};
if(currentLang!=='zh')applyLang();
$('search').oninput=renderList;
$('title').oninput=()=>{const p=current(),value=$('title').value.trim();if(!saved(p))p.title=value;updateDraftBrand(value);layoutHeroTitle(value||'MYP')};
document.querySelectorAll('.filterBtn').forEach(btn=>btn.onclick=()=>transitionView(async()=>{
  listFilter=btn.dataset.filter;
  const first=prompts.find(p=>matchList(p));
  if(first&&first.id!==currentId){restoreSavedPrompt(currentId);resetPromptBeforeSwitch();if(draft&&draft.id!==first.id)draft=null;currentId=first.id;await renderForm()}
  else renderList();
}));
$('modelName').onfocus=()=>{const r=$('modelName').getBoundingClientRect();const d=$('modelDrop');d.style.left=r.left+'px';d.style.top=r.bottom+2+'px';d.style.width=r.width+'px';d.classList.add('open')};
$('modelDrop').onmousedown=e=>e.preventDefault();
$('modelDrop').onclick=e=>{const item=e.target.closest('[data-v],.custom');if(!item)return;const v=item.dataset.v;if(v){$('modelName').value=v;$('modelDrop').classList.remove('open')}else if(item.classList.contains('custom')){$('modelDrop').classList.remove('open');$('modelName').focus()}};
$('modelName').onblur=()=>setTimeout(()=>$('modelDrop').classList.remove('open'),200);
$('promptExpandBtn').onclick=()=>setPromptExpanded(!$('promptField').classList.contains('expanded'));
$('form').onsubmit=async e=>{e.preventDefault();try{if(await saveCurrent())showSaveToast()}catch(err){reportError('save prompt',err)}};
$('stageCopyBtn').onclick=async e=>{e.stopPropagation();try{await copyPrompt()}finally{showCopyToast()}};
document.querySelector('.stage').onclick=previewStage;
$('uploadBox').onclick=()=>$('imageInput').click();
$('uploadBox').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('imageInput').click()}};
$('uploadBox').ondragover=e=>{e.preventDefault();$('uploadBox').classList.add('drag')};
$('uploadBox').ondragleave=()=>$('uploadBox').classList.remove('drag');
$('uploadBox').ondrop=async e=>{e.preventDefault();$('uploadBox').classList.remove('drag');try{await uploadFiles(e.dataTransfer.files)}catch(err){reportError('upload output image',err)}};
$('imageInput').onchange=async()=>{try{await uploadFiles($('imageInput').files)}catch(err){reportError('upload output image',err)}};
$('sourceBox').onclick=()=>$('sourceInput').click();
$('sourceBox').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('sourceInput').click()}};
$('sourceBox').ondragover=e=>{e.preventDefault();$('sourceBox').classList.add('drag')};
$('sourceBox').ondragleave=()=>$('sourceBox').classList.remove('drag');
$('sourceBox').ondrop=async e=>{e.preventDefault();$('sourceBox').classList.remove('drag');try{await uploadFiles(e.dataTransfer.files,'source')}catch(err){reportError('upload input image',err)}};
$('sourceInput').onchange=async()=>{try{await uploadFiles($('sourceInput').files,'source')}catch(err){reportError('upload input image',err)}};
$('clearImageBtn').onclick=()=>confirmButton($('clearImageBtn'),clearGeneratedImages);
$('clearSourceBtn').onclick=()=>confirmButton($('clearSourceBtn'),clearOriginalImages);
$('deleteBtn').onclick=()=>confirmButton($('deleteBtn'),deleteCurrentProject);
$('lightboxPrev').onclick=e=>{e.stopPropagation();stepLightbox(-1)};
$('lightboxNext').onclick=e=>{e.stopPropagation();stepLightbox(1)};
$('lightboxClose').onclick=closeLightbox;
$('lightboxDownload').onclick=e=>{e.stopPropagation();downloadLightboxImage().catch(err=>reportError('download image',err))};
$('lightbox').onclick=e=>{if(e.target.id==='lightbox')closeLightbox()};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeLightbox();return}
  if(!$('lightbox').classList.contains('on'))return;
  if(e.key==='ArrowLeft'){e.preventDefault();stepLightbox(-1)}
  if(e.key==='ArrowRight'){e.preventDefault();stepLightbox(1)}
});
window.addEventListener('resize',()=>{layoutHeroTitle();positionLightboxTools();fitPromptExpand();scheduleMediaFit()});
if(document.fonts)document.fonts.ready.then(()=>layoutHeroTitle());

(async()=>{
  try{
    prompts=await api('/api/prompts');
    if(!Array.isArray(prompts))prompts=[];
    let modelChanged=false;
    prompts=prompts.map(p=>{const x={...blank(),...p,id:p.id||id()};setImages(x,imagesOf(x));setSourceImages(x,sourceImagesOf(x));delete x.tags;const m=normalizeModelName(x.model);if(m!==x.model){x.model=m;modelChanged=true}return x});
    sortPrompts();
    if(modelChanged)await saveAll();
    else setSavedSnapshot();
    if(prompts.length){currentId=prompts[0].id}else{draft=blank();currentId=draft.id}
    renderForm();
    setDot(serverMode);
  }catch(err){serverMode=false;setDot(false);reportError('load prompts',err)}
})();

/* ── Heartbeat: keep server alive while page is open ── */
setInterval(()=>{if(serverMode)fetch('/api/health').catch(()=>{})},5000);
