/* One continuous camera stream; each JPEG goes into the existing
 * verified Drive upload queue without closing the live preview. */
(() => {
  'use strict';
  if(window.vlContinuousCamera)return;
  const trigger=document.getElementById('vlContinuousCameraOpen');
  if(!trigger)return;
  const root=document.createElement('section');
  root.id='vlContinuousCamera';
  root.setAttribute('role','dialog');
  root.setAttribute('aria-modal','true');
  root.setAttribute('aria-label','Chụp ảnh liên tục');
  root.innerHTML='<div class="vl-camera-top"><strong>Chụp liên tục</strong>'+
    '<button class="vl-camera-close" type="button" aria-label="Đóng camera">Đóng ×</button></div>'+
    '<div class="vl-camera-preview"><video autoplay muted playsinline webkit-playsinline></video></div>'+
    '<div class="vl-camera-bottom"><span class="vl-camera-status" role="status">Đang mở camera…</span>'+
    '<button class="vl-camera-shutter" type="button" aria-label="Chụp và lưu ảnh vào Drive"></button>'+
    '<span class="vl-camera-status" data-role="count">0 ảnh đã chụp</span></div>';
  document.body.appendChild(root);
  const video=root.querySelector('video'),shutter=root.querySelector('.vl-camera-shutter');
  const closeButton=root.querySelector('.vl-camera-close'),status=root.querySelector('[role="status"]');
  const counter=root.querySelector('[data-role="count"]');
  let stream=null,folder=null,opening=false,seq=0,pending=0,success=0;
  const current=()=>{
    try{return typeof currentFolderId!=='undefined'?currentFolderId:window.currentFolderId;}
    catch(_){return window.currentFolderId;}
  };
  function toast(message,error=false){
    if(typeof window.showToast==='function')window.showToast(message,error);
    else console[error?'warn':'info']('[Camera]',message);
  }
  function count(){counter.textContent=seq+' đã chụp · '+success+' đã lưu · '+pending+' đang xử lý';}
  function close(){
    root.classList.remove('vl-camera-open');
    stream?.getTracks().forEach(track=>track.stop());
    stream=null;video.srcObject=null;folder=null;opening=false;
  }
  async function open(){
    if(opening||root.classList.contains('vl-camera-open'))return;
    if(!navigator.mediaDevices?.getUserMedia){toast('Không hỗ trợ camera liên tục. Cần HTTPS và quyền camera.',true);return;}
    if(typeof window.vlUploadFiles!=='function'){toast('Bộ tải lên chưa sẵn sàng.',true);return;}
    const target=current();
    if(!target||String(target).startsWith('temp_')){toast('Chọn thư mục hợp lệ trước khi chụp.',true);return;}
    folder=target;seq=0;pending=0;success=0;count();opening=true;
    root.classList.add('vl-camera-open');
    status.textContent='Đang xin quyền camera…';
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
      if(!root.classList.contains('vl-camera-open')){close();return;}
      video.srcObject=stream;
      await video.play();
      status.textContent='Nhấn nút tròn để chụp. Camera vẫn mở khi ảnh đang được tải lên.';
    }catch(error){
      toast('Không mở được camera: '+(error?.message||'hãy cấp quyền camera'),true);close();
    }finally{opening=false;}
  }
  async function capture(){
    if(!stream?.active||!video.videoWidth||shutter.disabled)return;
    if(folder!==current()){status.textContent='Thư mục đã thay đổi. Hãy đóng camera và mở lại.';return;}
    shutter.disabled=true;
    const canvas=document.createElement('canvas');
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx){shutter.disabled=false;status.textContent='Không tạo được ảnh.';return;}
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    try{
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
      if(!blob)throw Error('Không tạo được dữ liệu ảnh');
      const now=new Date();
      const stamp=now.getFullYear()+String(now.getMonth()+1).padStart(2,'0')+
        String(now.getDate()).padStart(2,'0')+'_'+String(now.getHours()).padStart(2,'0')+
        String(now.getMinutes()).padStart(2,'0')+String(now.getSeconds()).padStart(2,'0');
      const file=new File([blob],'Camera_'+stamp+'_'+String(seq+1).padStart(3,'0')+'.jpg',
        {type:'image/jpeg',lastModified:Date.now()});
      seq++;pending++;count();
      status.textContent='Đã chụp '+seq+' ảnh. Tiếp tục chụp trong khi tải lên…';
      // The upload queue captures currentFolderId synchronously.
      Promise.resolve(window.vlUploadFiles([file])).then(result=>{
        pending=Math.max(0,pending-1);
        if(result?.success>0)success++;
        else toast('Có ảnh chưa lưu thành công. Kiểm tra trạng thái tải lên.',true);
        count();
      }).catch(error=>{
        pending=Math.max(0,pending-1);count();
        toast('Lỗi tải ảnh: '+(error?.message||'không rõ'),true);
      });
    }catch(error){status.textContent='Lỗi chụp: '+error.message;}
    finally{canvas.width=0;canvas.height=0;shutter.disabled=false;}
  }
  trigger.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    if(typeof window.closeFab==='function')window.closeFab();
    void open();
  });
  closeButton.addEventListener('click',close);
  shutter.addEventListener('click',()=>void capture());
  addEventListener('pagehide',close);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&stream?.active)video.pause();
    else if(!document.hidden&&stream?.active)video.play().catch(()=>{});
  });
  window.vlContinuousCamera={open,close};
})();
