/* One-time Admin action: discover folders/images, rank photos by metadata,
   then save Drive appProperties.vlCoverImageId in small resumable batches. */
(() => {
  'use strict';
  if(window.__vlAutoFolderCoverInstalled)return;
  window.__vlAutoFolderCoverInstalled=true;
  const API='/api/bulk-folder-covers';
  const ROOT='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
  const VERSION=1;
  const el=id=>document.getElementById(id);
  const email=()=>String(localStorage.getItem('vinhloc_authenticated_email')||'').trim().toLowerCase();
  const admin=()=>document.body.dataset.vlAccountRole==='admin' && !window.vlShareScope;
  const key=()=> 'vl:auto-folder-covers:v1:'+email();
  let running=false,stop=false,st=null,notice='';
  const cleanCount=x=>Number(x||0).toLocaleString('vi-VN');

  async function readState(){
    try{return await window.localforage?.getItem(key())||null;}
    catch(error){console.warn('[QL Ảnh] Không đọc được tiến độ thumbnail',error);return null;}
  }
  async function saveState(){
    if(!window.localforage)throw Error('Bộ nhớ IndexedDB chưa sẵn sàng, không thể lưu tiến độ');
    await window.localforage.setItem(key(),st);
  }
  async function send(action,extra={}){
    const response=await fetch(API,{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,...extra})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.success!==true){
      const error=new Error(result.message||'Máy chủ không phản hồi');
      error.status=response.status;
      throw error;
    }
    return result;
  }
  function fresh(overwrite){
    return {v:VERSION,owner:email(),overwrite,phase:'folders',
      folders:{},best:{},folderCursor:null,imageCursor:null,
      scanFolders:0,scanImages:0,totalFolders:0,eligible:0,empty:0,
      skippedExisting:0,queue:[],index:0,written:0,already:0,
      failures:[],errors:[],updatedAt:Date.now()};
  }
  function inApp(id){
    if(!id||!st)return false;
    const visited=new Set();
    for(let depth=0;depth<60;depth++){
      if(id===ROOT)return true;
      if(visited.has(id))return false;
      visited.add(id);
      const node=st.folders[id];
      if(!node?.parentId)return false;
      id=node.parentId;
    }
    return false;
  }
  // Heuristic rather than computer vision: resolution, file size, usable
  // aspect ratio and meaningful filenames; no pixels are downloaded.
  function scorePhoto(image){
    const w=Number(image.width)||0,h=Number(image.height)||0;
    const bytes=Number(image.size)||0;
    const pixels=w*h;
    const ratio=w>0&&h>0?w/h:1;
    let score=0;
    score+=Math.log2(1+Math.min(pixels,30000000)/500000)*11;
    score+=Math.log2(1+Math.min(bytes,30000000)/50000)*3.5;
    score+=ratio>=0.8&&ratio<=2?15:ratio>=0.6&&ratio<=2.7?6:-15;
    if(w&&h&&Math.min(w,h)<480)score-=28;
    else if(w&&h&&Math.min(w,h)>=1080)score+=9;
    const mime=String(image.mimeType||'');
    if(/image\/(jpeg|jpg|webp)/i.test(mime))score+=8;
    else if(/image\/png/i.test(mime))score+=3;
    else if(/image\/(gif|svg\+xml)/i.test(mime))score-=25;
    const name=String(image.name||'').toLowerCase();
    if(/(cover|banner|main|chinh|đại diện|thiet.bi|thiết bị|photo|ảnh)/i.test(name))score+=8;
    if(/(thumb|thumbnail|icon|logo|qr|watermark|screenshot|screen.?shot|zalo|avatar|small|preview)/i.test(name))score-=30;
    return Math.round(score*100)/100;
  }
  function choose(image){
    if(!image?.parentId||!inApp(image.parentId) || image.parentId===ROOT)return;
    if(!st.overwrite && st.folders[image.parentId]?.hasCover)return;
    const s=scorePhoto(image);
    const old=st.best[image.parentId];
    if(!old||s>old.score||(s===old.score&&image.id<old.id)){
      st.best[image.parentId]={id:image.id,score:s};
    }
  }
  function prepare(){
    const all=Object.keys(st.folders).filter(id=>id!==ROOT&&inApp(id));
    const queue=[];
    let empty=0,hasCover=0,withImage=0;
    for(const id of all){
      const folder=st.folders[id];
      if(folder.hasCover&&!st.overwrite){hasCover++;continue;}
      const pick=st.best[id];
      if(pick?.id){
        queue.push({folderId:id,imageId:pick.id});
        withImage++;
      }else empty++;
    }
    st.totalFolders=all.length;
    st.skippedExisting=hasCover;
    st.eligible=withImage;
    st.empty=empty;
    st.queue=queue;
    st.index=0;
    st.phase='apply';
    // Free large scan payload before writing: the compact pending list
    // survives page reloads without keeping every file's metadata.
    st.folders={};
    st.best={};
  }
  function info(){
    if(!st)return 'Chưa chạy lần nào.';
    const phaseName={folders:'Đang quét thư mục',images:'Đang đánh giá chất lượng ảnh',
      apply:'Đang gán thumbnail',done:'Đã hoàn tất'};
    const pieces=[phaseName[st.phase]||st.phase,
      'Đã quét '+cleanCount(st.scanFolders)+' thư mục',
      'Đã kiểm tra '+cleanCount(st.scanImages)+' ảnh',
      'Đã gán '+cleanCount(st.written)+' thumbnail'];
    if(st.phase==='apply'||st.phase==='done'){
      pieces.push('Xử lý '+cleanCount(st.index)+'/'+cleanCount(st.queue.length));
      pieces.push('Bỏ qua đã có '+cleanCount(st.skippedExisting+st.already));
      pieces.push('Không có ảnh '+cleanCount(st.empty));
      if(st.failures.length)pieces.push('Lỗi '+cleanCount(st.failures.length));
    }
    return pieces.join(' · ');
  }
  function paint(){
    const start=el('vlCoverAutoStart'),pause=el('vlCoverAutoPause');
    const label=el('vlCoverAutoStats'),text=el('vlCoverAutoMessage');
    const progress=el('vlCoverAutoProgress'),replace=el('vlCoverAutoOverwrite');
    if(!start)return;
    const can=admin()&&!!email();
    start.disabled=!can||running;
    start.textContent=running?'Đang chạy…':!st?'Chạy một lần':
      st.phase==='done'?(st.failures.length?'Thử lại folder lỗi':'Chạy lại'):'Tiếp tục';
    pause.disabled=!running;
    replace.disabled=running||!!st&&st.phase!=='done';
    label.textContent=info();
    text.textContent=notice||(!can?'Chức năng chỉ dành cho Admin đã xác thực.':
      st?.phase==='done'?(st.failures.length?
        'Có folder lỗi, nhấn Thử lại folder lỗi để xử lý tiếp.':
        'Đã xử lý toàn bộ folder trong kho ảnh.'): 'Bạn có thể tạm dừng và tiếp tục mà không mất tiến độ.');
    text.classList.toggle('vl-error',notice.startsWith('Lỗi'));
    if(st?.phase==='apply'||st?.phase==='done'){
      progress.max=Math.max(1,st.queue.length);
      progress.value=st.index;
    }else progress.removeAttribute('value');
    progress.hidden=!st;
  }
  async function work(){
    while(!stop&&admin()&&st&&st.owner===email()){
      if(st.phase==='folders'){
        const response=await send('folders',{pageToken:st.folderCursor||''});
        for(const folder of response.items||[]){
          st.folders[folder.id]={parentId:folder.parentId,
            name:folder.name,hasCover:!!folder.hasCover};
        }
        st.scanFolders+=(response.items||[]).length;
        st.folderCursor=response.nextPageToken||null;
        if(!st.folderCursor)st.phase='images';
      }else if(st.phase==='images'){
        const response=await send('images',{pageToken:st.imageCursor||''});
        for(const image of response.items||[])choose(image);
        st.scanImages+=(response.items||[]).length;
        st.imageCursor=response.nextPageToken||null;
        if(!st.imageCursor)prepare();
      }else if(st.phase==='apply'){
        if(st.index>=st.queue.length){st.phase='done';continue;}
        const batch=st.queue.slice(st.index,st.index+4);
        const response=await send('apply',{items:batch,overwrite:st.overwrite});
        const results=response.results||[];
        if(results.length!==batch.length)throw Error('Máy chủ trả về thiếu kết quả, chưa thể chuyển sang đợt tiếp');
        for(let i=0;i<results.length;i++){
          const result=results[i];
          if(result.folderId!==batch[i].folderId)throw Error('Kết quả xử lý không đúng thứ tự folder');
          if(result.status==='written')st.written++;
          else if(result.status==='existing')st.already++;
          else if(result.status==='failed'){
            st.failures.push(batch[i]);
            if(st.errors.length<12)st.errors.push(result.message||'Lỗi lưu ảnh');
          }else throw Error('Trạng thái lưu thumbnail không hợp lệ');
        }
        st.index+=batch.length;
      }else if(st.phase==='done'){break;}
      else throw Error('Tiến độ không hợp lệ; cần tạo đợt quét mới');
      st.updatedAt=Date.now();
      await saveState();
      paint();
    }
    if(st?.phase==='done'){
      await saveState();
      window.dispatchEvent(new Event('vl:bulk-covers-saved'));
      notice=st.failures.length?'Một số folder chưa ghi được. Có thể thử lại riêng các folder lỗi.':
        'Hoàn tất. Thumbnail đã lưu trên Google Drive, không tạo file ảnh mới.';
    }
  }
  async function start(){
    if(running||!admin()||!email())return;
    if(!st||st.owner!==email() || st.phase==='done'&&!st.failures.length){
      const replace=el('vlCoverAutoOverwrite')?.checked===true;
      const detail=replace?
        'Chạy lại và có thể THAY THẾ cả thumbnail đang có. Tiếp tục?':
        'Quét toàn bộ folder trong kho ảnh, tự chọn ảnh chất lượng và chỉ điền những thumbnail còn thiếu?';
      if(!window.confirm(detail))return;
      st=fresh(replace);
      await saveState();
    }else if(st.phase==='done'&&st.failures.length){
      st.queue=st.failures.slice();
      st.failures=[];
      st.errors=[];
      st.index=0;
      st.phase='apply';
      await saveState();
    }
    running=true;stop=false;notice='';
    paint();
    try{await work();}
    catch(error){notice='Lỗi: '+(error.message||String(error))+
      '. Tiến độ đã lưu; nhấn Tiếp tục để chạy lại đợt này.';
      console.warn('[QL Ảnh] Gán thumbnail hàng loạt bị tạm dừng',error);
    }finally{running=false;paint();}
  }
  async function mount(){
    if(el('vlCoverAutoCard'))return;
    const shell=document.querySelector('#vlAdminPage .vl-admin-shell');
    if(!shell)return;
    const card=document.createElement('div');
    card.id='vlCoverAutoCard';
    card.className='vl-admin-card';
    card.innerHTML=[
      '<h3 class="vl-admin-heading">Tự động gán thumbnail cho folder</h3>',
      '<p class="vl-admin-intro">Chạy một lần cho tất cả thư mục con trong kho ảnh. Chọn ảnh nằm trực tiếp trong từng folder, ưu tiên độ phân giải, dung lượng, tỷ lệ và tên file. Chỉ lưu ID ảnh vào Google Drive appProperties.vlCoverImageId; không tải ảnh về hoặc ghi Sheet LOẠI.</p>',
      '<label class="vl-cover-auto-choice"><input id="vlCoverAutoOverwrite" type="checkbox"> Ghi đè cả thumbnail đã có (không khuyến nghị)</label>',
      '<div class="vl-cover-auto-actions"><button type="button" id="vlCoverAutoStart" class="vl-admin-submit">Chạy một lần</button>',
      '<button type="button" id="vlCoverAutoPause" class="vl-admin-reload" disabled>Tạm dừng</button></div>',
      '<progress id="vlCoverAutoProgress" class="vl-cover-auto-progress" hidden></progress>',
      '<p id="vlCoverAutoStats" class="vl-admin-count" aria-live="polite"></p>',
      '<p id="vlCoverAutoMessage" class="vl-admin-message" aria-live="polite"></p>',
      '<p class="vl-admin-count">Nếu rời ứng dụng giữa chừng, hãy quay lại tab Quản lý và nhấn Tiếp tục. Không cần dịch vụ mới, nhưng các lượt gọi API vẫn sử dụng hạn mức Google Drive/Vercel hiện có.</p>'
    ].join('');
    shell.appendChild(card);
    el('vlCoverAutoStart').addEventListener('click',()=>void start());
    el('vlCoverAutoPause').addEventListener('click',()=>{
      stop=true;
      notice='Đang tạm dừng sau đợt hiện tại; tiến độ sẽ được giữ lại.';
      paint();
    });
    st=await readState();
    if(st?.v!==VERSION||st?.owner!==email())st=null;
    paint();
    window.addEventListener('vl:account-role',async()=>{
      if(running && !admin())stop=true;
      if(!running){
        st=await readState();
        if(st?.v!==VERSION||st?.owner!==email())st=null;
      }
      paint();
    });
    window.addEventListener('storage',e=>{
      if(e.key==='vinhloc_authenticated_email'&&!running){
        void readState().then(x=>{st=x?.owner===email()?x:null;paint();});
      }
    });
  }
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',()=>void mount(),{once:true});
  else void mount();
})();
