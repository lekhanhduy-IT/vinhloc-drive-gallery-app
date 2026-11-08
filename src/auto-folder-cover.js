/* Admin-only single-pass thumbnail assignment for the live gallery tree.
   Traverse direct children from 06. HÌNH ẢNH CONTENT, pick a thumbnail and
   write it before processing the next folder. Progress survives app restarts. */
(() => {
  'use strict';
  if(window.__vlAutoFolderCoverInstalled)return;
  window.__vlAutoFolderCoverInstalled=true;
  const API='/api/bulk-folder-covers';
  const ROOT='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
  const VERSION=2; // invalidate v1 full Shared Drive scan state
  const el=id=>document.getElementById(id);
  const email=()=>String(localStorage.getItem('vinhloc_authenticated_email')||'').trim().toLowerCase();
  const admin=()=>document.body.dataset.vlAccountRole==='admin' && !window.vlShareScope;
  const key=()=> 'vl:auto-folder-covers:v2:'+email();
  const fmt=n=>Number(n||0).toLocaleString('vi-VN');
  let running=false,stop=false,job=null,notice='';

  async function readState(){
    if(!window.localforage)return null;
    try{
      const data=await window.localforage.getItem(key());
      return data?.v===VERSION&&data?.owner===email()?data:null;
    }catch(error){
      console.warn('[QL Ảnh] Không đọc được tiến độ gán thumbnail',error);
      return null;
    }
  }
  async function saveState(){
    if(!window.localforage)throw Error('Bộ nhớ tiến độ chưa sẵn sàng');
    job.updatedAt=Date.now();
    await window.localforage.setItem(key(),job);
  }
  async function send(action,params={}){
    const response=await fetch(API,{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,...params})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.success!==true)
      throw new Error(data.message||'Không thể kết nối Google Drive');
    return data;
  }
  const isId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(x);
  function fresh(overwrite){
    return {v:VERSION,owner:email(),overwrite,queue:[ROOT],index:0,
      current:null,phase:'walk',found:1,scanned:0,images:0,
      written:0,existing:0,empty:0,failed:[],lastFolder:'',updatedAt:Date.now()};
  }
  // Evaluate only metadata. No full-size images are downloaded or duplicated.
  function score(image){
    const w=Number(image.width)||0, h=Number(image.height)||0;
    const bytes=Number(image.size)||0, pixels=w*h;
    const ratio=w&&h?w/h:1;
    let value=Math.log2(1+Math.min(pixels,30000000)/500000)*11;
    value+=Math.log2(1+Math.min(bytes,30000000)/50000)*3.5;
    value+=ratio>=.8&&ratio<=2?15:ratio>=.6&&ratio<=2.7?6:-15;
    if(w&&h&&Math.min(w,h)<480)value-=28;
    else if(w&&h&&Math.min(w,h)>=1080)value+=9;
    const mime=String(image.mimeType||'');
    if(/image\/(jpeg|jpg|webp)/i.test(mime))value+=8;
    else if(/image\/png/i.test(mime))value+=3;
    else if(/image\/(gif|svg\+xml)/i.test(mime))value-=25;
    const name=String(image.name||'').toLowerCase();
    if(/(cover|banner|main|chinh|đại diện|thiet.bi|thiết bị|photo|ảnh)/i.test(name))value+=8;
    if(/(thumb|thumbnail|icon|logo|qr|watermark|screenshot|screen.?shot|zalo|avatar|small|preview)/i.test(name))value-=30;
    return value;
  }
  function refreshVisible(){
    window.dispatchEvent(new Event('vl:bulk-covers-saved'));
  }
  function progress(){
    const done=job?.index||0, found=Math.max(1,job?.queue?.length||0);
    const pct=job?.phase==='done'?100:Math.min(99,Math.floor(100*done/found));
    return {done,found,pct};
  }
  function paint(){
    const start=el('vlCoverAutoStart'),pause=el('vlCoverAutoPause');
    if(!start)return;
    const can=admin()&&!!email();
    start.disabled=!can||running;
    start.textContent=running?'Đang xử lý…':!job?'Chạy một lần':
      job.phase==='done'?'Chạy lại':'Tiếp tục';
    pause.disabled=!running;
    el('vlCoverAutoOverwrite').disabled=running||!!job&&job.phase!=='done';

    const p=progress();
    const bar=el('vlCoverAutoProgress'),fill=el('vlCoverAutoProgressFill');
    bar.hidden=!job;
    bar.setAttribute('aria-valuemin','0');
    bar.setAttribute('aria-valuemax',String(p.found));
    bar.setAttribute('aria-valuenow',String(p.done));
    bar.classList.toggle('vl-cover-progress-running',running);
    fill.style.width=(job?p.pct:0)+'%';
    el('vlCoverAutoPercent').textContent=(job?p.pct:0)+'%';
    el('vlCoverAutoProgressCount').textContent=
      job?fmt(p.done)+' / '+fmt(p.found)+' folder đã tìm thấy':'Chưa bắt đầu';
    const msg=el('vlCoverAutoMessage');
    const status=el('vlCoverAutoStats');
    if(job){
      const current=job.current;
      const action=job.phase==='done'?'Đã hoàn tất':
        running?'Đang xử lý từng folder':'Đã tạm dừng';
      status.textContent=action+' · Đã kiểm tra '+fmt(job.images)+' ảnh'+
        ' · Đã gán '+fmt(job.written)+' thumbnail'+
        ' · Đã có '+fmt(job.existing)+
        ' · Không có ảnh '+fmt(job.empty)+
        (job.failed.length?' · Lỗi '+fmt(job.failed.length):'');
      el('vlCoverAutoCurrent').textContent=job.phase==='done'?
        'Đã duyệt xong toàn bộ thư mục hiện có dưới 06. HÌNH ẢNH CONTENT':
        'Đang duyệt: '+(current?.name||current?.id||job.queue[job.index]||'Đang chuẩn bị');
    }else{
      status.textContent='Chưa chạy lần nào trên cây thư mục này.';
      el('vlCoverAutoCurrent').textContent=
        'Chỉ duyệt 06. HÌNH ẢNH CONTENT và các thư mục con hiện hữu.';
    }
    msg.textContent=notice||(!can?'Chỉ tài khoản Admin được thao tác.':
      job?.phase==='done'?'Hoàn tất. ID ảnh được lưu vào Google Drive appProperties.vlCoverImageId.':
      'Chạy tới folder nào thì gán thumbnail ngay folder đó. Có thể tạm dừng và tiếp tục.');
    msg.classList.toggle('vl-error',notice.startsWith('Lỗi'));
  }

  async function step(){
    if(job.index>=job.queue.length){
      job.phase='done';job.current=null;
      await saveState();refreshVisible();return;
    }
    const id=job.queue[job.index];
    if(!job.current||job.current.id!==id){
      job.current={id,name:id,cursor:'',stage:'browse',best:null,
        hasCover:false,images:0,pages:0};
      await saveState();
    }
    const current=job.current;
    if(current.stage==='browse'){
      // Every page is strictly "folderId in parents AND trashed=false".
      const result=await send('browse',{folderId:id,pageToken:current.cursor||''});
      if(result.folderId!==id||!Array.isArray(result.items))
        throw Error('Danh sách con trả về không đúng folder');
      current.name=result.folderName||current.name;
      current.hasCover=!!result.hasCover;
      const newIds=[];
      for(const item of result.items){
        if(!isId(item.id))continue;
        if(item.kind==='folder'){
          // Prevent cycles or duplicates on unexpected Drive results.
          if(!job.queue.includes(item.id)&&!newIds.includes(item.id))newIds.push(item.id);
        }else if(item.kind==='image'){
          current.images++;job.images++;
          if(current.hasCover&&!job.overwrite)continue;
          const value=score(item);
          if(!current.best||value>current.best.value||
              (value===current.best.value&&item.id<current.best.id))
            current.best={id:item.id,value};
        }
      }
      if(newIds.length)job.queue.push(...newIds);
      job.found=job.queue.length;
      current.pages++;
      current.cursor=result.nextPageToken||'';
      if(!current.cursor)current.stage='apply';
      await saveState();
      paint();
      return;
    }
    if(current.stage!=='apply')throw Error('Tiến độ folder không hợp lệ');
    if(current.hasCover&&!job.overwrite){
      job.existing++;
    }else if(!current.best){
      job.empty++;
    }else{
      const response=await send('apply',{
        folderId:id,imageId:current.best.id,overwrite:!!job.overwrite
      });
      const result=response.result;
      if(!result||result.folderId!==id)throw Error('Máy chủ trả sai kết quả lưu thumbnail');
      if(result.status==='written'){
        job.written++;
        // At most one UI refresh per ten successful writes.
        if(job.written%10===0)refreshVisible();
      }else if(result.status==='existing')job.existing++;
      else if(result.status==='failed'){
        if(job.failed.length<500)job.failed.push({folderId:id,message:result.message||'Lỗi không rõ'});
      }else throw Error('Trạng thái thumbnail không hợp lệ');
    }
    job.scanned++;
    job.lastFolder=current.name;
    job.index++;
    job.current=null;
    await saveState();
    paint();
  }
  async function run(){
    while(!stop&&admin()&&job?.owner===email()&&job.phase!=='done'){
      await step();
    }
    if(stop&&job?.phase!=='done')notice='Đã tạm dừng, tiến độ được giữ lại trên thiết bị.';
    if(job?.phase==='done')notice=job.failed.length?
      'Hoàn tất với '+fmt(job.failed.length)+' folder lỗi. Có thể chạy lại để thử lại các folder chưa được gán.':
      'Đã gán xong thumbnail theo từng folder trong 06. HÌNH ẢNH CONTENT.';
    refreshVisible();
  }
  async function start(){
    if(running||!admin()||!email())return;
    const begin=!job||job.owner!==email()||job.phase==='done';
    if(begin){
      const overwrite=el('vlCoverAutoOverwrite').checked;
      if(!window.confirm(overwrite?
        'Chạy từ 06. HÌNH ẢNH CONTENT và GHI ĐÈ cả thumbnail đã có?':
        'Chỉ duyệt 06. HÌNH ẢNH CONTENT cùng các thư mục con, lưu thumbnail ngay khi đến từng folder và giữ ảnh bìa đã có?'))return;
      job=fresh(overwrite);
      try{await saveState();}
      catch(error){notice='Lỗi: '+error.message;paint();return;}
    }
    running=true;stop=false;notice='';
    paint();
    try{await run();}
    catch(error){
      notice='Lỗi: '+(error.message||String(error))+
        '. Đã giữ tiến độ, nhấn Tiếp tục để thử lại đúng folder này.';
      console.warn('[QL Ảnh] Dừng quét thumbnail',error);
    }finally{running=false;paint();}
  }
  async function mount(){
    if(el('vlCoverAutoCard'))return;
    const shell=document.querySelector('#vlAdminPage .vl-admin-shell');
    if(!shell)return;
    const card=document.createElement('section');
    card.id='vlCoverAutoCard';card.className='vl-admin-card';
    card.innerHTML=[
      '<h3 class="vl-admin-heading">Tự động gán thumbnail cho folder</h3>',
      '<p class="vl-admin-intro">Chỉ duyệt <strong>06. HÌNH ẢNH CONTENT</strong> và các folder con hiện hữu. Mở đến folder nào, chọn ảnh chất lượng nằm trực tiếp trong folder đó và ghi <code>vlCoverImageId</code> ngay trước khi duyệt tiếp. Không quét toàn bộ Shared Drive, không tính thùng rác.</p>',
      '<label class="vl-cover-auto-choice"><input id="vlCoverAutoOverwrite" type="checkbox"> Ghi đè thumbnail đã có (không khuyến nghị)</label>',
      '<div class="vl-cover-auto-actions"><button type="button" id="vlCoverAutoStart" class="vl-admin-submit">Chạy một lần</button>',
      '<button type="button" id="vlCoverAutoPause" class="vl-admin-reload" disabled>Tạm dừng</button></div>',
      '<div class="vl-cover-progress-head"><span>Tiến độ quét và gán thumbnail</span><strong id="vlCoverAutoPercent">0%</strong></div>',
      '<div id="vlCoverAutoProgress" class="vl-cover-progress" role="progressbar" aria-label="Tiến độ gán thumbnail" aria-valuemin="0" aria-valuenow="0" aria-valuemax="1" hidden><div id="vlCoverAutoProgressFill" class="vl-cover-progress-fill"></div></div>',
      '<div class="vl-cover-progress-meta"><span id="vlCoverAutoProgressCount">Chưa bắt đầu</span><span>06. HÌNH ẢNH CONTENT</span></div>',
      '<p id="vlCoverAutoCurrent" class="vl-cover-auto-current"></p>',
      '<p id="vlCoverAutoStats" class="vl-cover-auto-stats" aria-live="polite"></p>',
      '<p id="vlCoverAutoMessage" class="vl-admin-message" aria-live="polite"></p>',
      '<p class="vl-admin-count">Có thể tạm dừng, rồi quay lại nhấn Tiếp tục. Tiến độ lưu trên thiết bị; lượt gọi sử dụng hạn mức Google Drive/Vercel hiện có.</p>'
    ].join('');
    shell.appendChild(card);
    el('vlCoverAutoStart').addEventListener('click',()=>void start());
    el('vlCoverAutoPause').addEventListener('click',()=>{
      stop=true;
      notice='Đang dừng sau bước hiện tại, tiến độ sẽ được giữ lại.';
      paint();
    });
    job=await readState(); // v1 scan state is not imported or resumed
    if(!job)notice='Bắt đầu lượt quét mới, không sử dụng dữ liệu quét toàn Shared Drive của phiên bản cũ.';
    paint();
    window.addEventListener('vl:account-role',()=>{
      if(running&&!admin())stop=true;
      if(!running)void readState().then(saved=>{job=saved;paint();});
      else paint();
    });
    window.addEventListener('storage',event=>{
      if(event.key==='vinhloc_authenticated_email'&&!running)
        void readState().then(saved=>{job=saved;paint();});
    });
  }
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',()=>void mount(),{once:true});
  else void mount();
})();
