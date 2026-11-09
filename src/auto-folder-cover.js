/* Admin-only single-pass thumbnail assignment for the live gallery tree.
   Traverse direct children from 06. HÌNH ẢNH CONTENT, pick a thumbnail and
   write it before processing the next folder. Progress survives app restarts. */
(() => {
  'use strict';
  if(window.__vlAutoFolderCoverInstalled)return;
  window.__vlAutoFolderCoverInstalled=true;
  const API='/api/bulk-folder-covers';
  const ROOT='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
  const VERSION=3; // v3: recursive descendant fallback and bottom-up assignment
  const el=id=>document.getElementById(id);
  const email=()=>String(localStorage.getItem('vinhloc_authenticated_email')||'').trim().toLowerCase();
  const admin=()=>document.body.dataset.vlAccountRole==='admin' && !window.vlShareScope;
  const key=()=> 'vl:auto-folder-covers:v3:'+email();
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
    if(!response.ok||data.success!==true){
      const error=new Error(data.message||'Không thể kết nối Google Drive');
      error.status=response.status;
      throw error;
    }
    return data;
  }
  const isId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(x);
  function fresh(overwrite){
    return {v:VERSION,owner:email(),overwrite,queue:[ROOT],index:0,
      current:null,phase:'scan',applyIndex:-1,
      nodes:{[ROOT]:{parent:null,name:'06. HÌNH ẢNH CONTENT',best:null,fallback:null,hasCover:false}},
      found:1,scanned:0,images:0,written:0,existing:0,empty:0,
      failed:[],lastFolder:'',updatedAt:Date.now()};
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
    const found=Math.max(1,job?.queue?.length||0);
    const scanned=job?.index||0;
    const applied=job?.phase==='apply'||job?.phase==='done'?
      Math.max(0,found-1-(job?.applyIndex??-1)):0;
    const pct=job?.phase==='done'?100:job?.phase==='apply'?
      Math.min(99,50+Math.floor(50*applied/found)):
      Math.min(49,Math.floor(50*scanned/found));
    return {done:scanned,applied,found,pct};
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
    el('vlCoverAutoProgressCount').textContent=job?
      fmt(p.done)+' đã duyệt · '+fmt(p.applied)+' đã xử lý / '+fmt(p.found)+' folder':'Chưa bắt đầu';
    const msg=el('vlCoverAutoMessage');
    const status=el('vlCoverAutoStats');
    if(job){
      const current=job.current;
      const action=job.phase==='done'?'Đã hoàn tất':
        running?(job.phase==='scan'?'Đang tìm ảnh trong tất cả folder con':
          'Đang gán ảnh từ folder con lên folder cha'):'Đã tạm dừng';
      status.textContent=action+' · Đã kiểm tra '+fmt(job.images)+' ảnh'+
        ' · Đã gán '+fmt(job.written)+' thumbnail'+
        ' · Đã có '+fmt(job.existing)+
        ' · Không có ảnh '+fmt(job.empty)+
        (job.skippedGone?' · Đã xóa '+fmt(job.skippedGone):'')+
        (job.failed.length?' · Lỗi '+fmt(job.failed.length):'');
      el('vlCoverAutoCurrent').textContent=job.phase==='done'?
        'Đã duyệt và gán xong từ folder con lên folder cha':
        'Đang xử lý: '+(current?.name||current?.id||
          (job.phase==='apply'?job.queue[job.applyIndex]:job.queue[job.index])||'Đang chuẩn bị');
    }else{
      status.textContent='Chưa chạy lần nào trên cây thư mục này.';
      el('vlCoverAutoCurrent').textContent=
        'Chỉ duyệt 06. HÌNH ẢNH CONTENT và các thư mục con hiện hữu.';
    }
    msg.textContent=notice||(!can?'Chỉ tài khoản Admin được thao tác.':
      job?.phase==='done'?'Hoàn tất. ID ảnh được lưu vào Google Drive appProperties.vlCoverImageId.':
      'Duyệt mọi cấp thư mục trước, rồi gán ảnh từ folder con lên cha nếu cha không có ảnh. Có thể tạm dừng và tiếp tục.');
    msg.classList.toggle('vl-error',notice.startsWith('Lỗi'));
  }

  // Phase 1 scans all descendants page by page. Phase 2 traverses the
  // discovered folder tree in reverse order to inherit child cover candidates.
  async function step(){
    if(job.phase==='scan'){
      if(job.index>=job.queue.length){
        job.phase='apply';job.applyIndex=job.queue.length-1;
        job.current=null;await saveState();paint();return;
      }
      const id=job.queue[job.index];
      if(!job.current||job.current.id!==id){
        job.current={id,name:job.nodes[id]?.name||id,cursor:'',
          best:null,hasCover:false,pages:0};
        await saveState();
      }
      const current=job.current;
      let result;
      try{
        result=await send('browse',{folderId:id,pageToken:current.cursor||''});
      }catch(error){
        if(error.status===404){
          job.scanned++;job.index++;job.current=null;
          job.skippedGone=(job.skippedGone||0)+1;
          job.nodes[id].gone=true;
          await saveState();paint();return;
        }
        throw error;
      }
      if(result.folderId!==id||!Array.isArray(result.items))
        throw Error('Danh sách con trả về không đúng folder');
      current.name=result.folderName||current.name;
      current.hasCover=!!result.hasCover;
      for(const item of result.items){
        if(!isId(item.id))continue;
        if(item.kind==='folder'){
          if(!job.nodes[item.id]){
            job.nodes[item.id]={parent:id,name:item.name||item.id,best:null,
              fallback:null,hasCover:false};
            job.queue.push(item.id);
          }
        }else if(item.kind==='image'){
          job.images++;
          const value=score(item);
          if(!current.best||value>current.best.value||
              (value===current.best.value&&item.id<current.best.id))
            current.best={id:item.id,value};
        }
      }
      job.found=job.queue.length;
      current.pages++;
      current.cursor=result.nextPageToken||'';
      if(!current.cursor){
        const node=job.nodes[id];
        node.best=current.best;node.hasCover=current.hasCover;
        node.name=current.name;
        job.scanned++;job.index++;job.current=null;
      }
      await saveState();paint();return;
    }
    if(job.phase!=='apply')throw Error('Tiến độ quét không hợp lệ');
    if(job.applyIndex<0){
      job.phase='done';job.current=null;
      await saveState();refreshVisible();paint();return;
    }
    const id=job.queue[job.applyIndex],node=job.nodes[id];
    job.current={id,name:node?.name||id};
    if(!node||node.gone){
      job.applyIndex--;job.current=null;await saveState();paint();return;
    }
    const chosen=node.best||node.fallback;
    // A folder prefers a direct photo; only an empty folder uses one of
    // its descendant images. Propagation still happens if its cover exists.
    if(chosen&&node.parent&&job.nodes[node.parent]){
      const parent=job.nodes[node.parent];
      if(!parent.fallback||chosen.value>parent.fallback.value||
          (chosen.value===parent.fallback.value&&chosen.id<parent.fallback.id))
        parent.fallback={...chosen};
    }
    if(node.hasCover&&!job.overwrite){
      job.existing++;
    }else if(!chosen){
      job.empty++;
    }else{
      const response=await send('apply',{
        folderId:id,imageId:chosen.id,overwrite:!!job.overwrite
      });
      const result=response.result;
      if(!result||result.folderId!==id)
        throw Error('Máy chủ trả sai kết quả lưu thumbnail');
      if(result.status==='written'){
        job.written++;
        if(job.written%10===0)refreshVisible();
      }else if(result.status==='existing')job.existing++;
      else if(result.status==='failed'){
        if(job.failed.length<500)job.failed.push({folderId:id,message:result.message||'Lỗi không rõ'});
      }else throw Error('Trạng thái thumbnail không hợp lệ');
    }
    job.lastFolder=node.name;
    job.applyIndex--;job.current=null;
    await saveState();paint();
  }
  async function run(){
    while(!stop&&admin()&&job?.owner===email()&&job.phase!=='done'){
      await step();
    }
    if(stop&&job?.phase!=='done')notice='Đã tạm dừng, tiến độ được giữ lại trên thiết bị.';
    if(job?.phase==='done')notice=job.failed.length?
      'Hoàn tất với '+fmt(job.failed.length)+' folder lỗi. Có thể chạy lại để thử lại các folder chưa được gán.':
      'Đã gán thumbnail từ ảnh trực tiếp hoặc ảnh ở mọi cấp folder con.';
    refreshVisible();
  }
  // Non-blocking, branded confirmation for the Admin's one-time cover job.
  // The job state is not touched until the user explicitly confirms.
  function confirmCoverRun(overwrite){
    return new Promise(resolve=>{
      const previous=document.activeElement;
      const dialog=document.createElement('div');
      dialog.id='vlCoverRunConfirm';
      dialog.setAttribute('role','presentation');
      dialog.innerHTML=
        '<section class="vl-cover-confirm-card" role="alertdialog" aria-modal="true" '+
        'aria-labelledby="vlCoverConfirmTitle" aria-describedby="vlCoverConfirmText">'+
        '<div class="vl-cover-confirm-icon" aria-hidden="true">✓</div>'+
        '<h2 id="vlCoverConfirmTitle">Xác nhận gán thumbnail</h2>'+
        '<p id="vlCoverConfirmText"></p>'+
        '<div class="vl-cover-confirm-actions">'+
        '<button type="button" data-cover-cancel>Hủy</button>'+
        '<button type="button" data-cover-approve>Xác nhận</button>'+
        '</div></section>';
      const message=dialog.querySelector('#vlCoverConfirmText');
      message.textContent=overwrite?
        'Chạy từ 06. HÌNH ẢNH CONTENT và GHI ĐÈ cả thumbnail đã có?':
        'Chỉ duyệt 06. HÌNH ẢNH CONTENT cùng các thư mục con, lưu thumbnail ngay khi đến từng folder và giữ ảnh bìa đã có?';
      const approve=dialog.querySelector('[data-cover-approve]');
      const cancel=dialog.querySelector('[data-cover-cancel]');
      approve.textContent=overwrite?'Ghi đè thumbnail':'Bắt đầu';
      if(overwrite)approve.classList.add('vl-cover-confirm-danger');
      let finished=false;
      const onKey=event=>{
        if(event.key==='Escape'){
          event.preventDefault();event.stopPropagation();finish(false);
        }else if(event.key==='Tab'){
          const current=document.activeElement;
          if(event.shiftKey&&current===cancel){
            event.preventDefault();approve.focus();
          }else if(!event.shiftKey&&current===approve){
            event.preventDefault();cancel.focus();
          }
        }
      };
      function finish(accepted){
        if(finished)return;
        finished=true;
        document.removeEventListener('keydown',onKey,true);
        dialog.remove();
        if(previous?.isConnected&&typeof previous.focus==='function')previous.focus();
        resolve(accepted);
      }
      dialog.addEventListener('click',event=>{
        if(event.target===dialog)finish(false);
      });
      cancel.addEventListener('click',()=>finish(false));
      approve.addEventListener('click',()=>finish(true));
      document.body.appendChild(dialog);
      document.addEventListener('keydown',onKey,true);
      cancel.focus();
    });
  }

  async function start(){
    if(running||!admin()||!email())return;
    const begin=!job||job.owner!==email()||job.phase==='done';
    if(begin){
      const overwrite=el('vlCoverAutoOverwrite').checked;
      if(!await confirmCoverRun(overwrite))return;
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
      '<p class="vl-admin-intro">Chỉ duyệt <strong>06. HÌNH ẢNH CONTENT</strong> và mọi cấp folder con. Ưu tiên ảnh trực tiếp trong mỗi folder; nếu folder trống, tự chọn ảnh phù hợp từ các folder cháu. Duyệt toàn cây rồi lưu từ folder sâu lên cha. Không quét toàn Shared Drive hay thùng rác.</p>',
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
    if(!job)notice='Bắt đầu quét mới hỗ trợ ảnh trong mọi cấp folder con; dữ liệu v2 không được tái sử dụng.';
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
