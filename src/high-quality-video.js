/* High resolution recorder for Quay video. Photo capture remains native. */
(() => {
  'use strict';
  if (window.__vlHQRecorder) return;
  const original=document.getElementById('captureVideo');
  if(!original)return;
  window.__vlHQRecorder=true;
  const state={stream:null,recorder:null,chunks:[],file:null,url:null,recording:false,
    started:0,timer:null,request:0,folder:null,ready:false};
  const css=[
    '#vlHQModal[hidden]{display:none!important}',
    '#vlHQModal{position:fixed;inset:0;z-index:2147483000;background:rgba(8,15,29,.90);display:flex;align-items:center;justify-content:center;padding:14px;color:#162235;font-family:system-ui,sans-serif}',
    '#vlHQModal *{box-sizing:border-box}',
    '#vlHQModal .panel{width:min(100%,560px);max-height:94dvh;overflow:auto;background:#fff;border-radius:17px;padding:14px;box-shadow:0 12px 42px #0005}',
    '#vlHQModal .head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}',
    '#vlHQModal .head strong{font-size:17px;color:#01adee}',
    '#vlHQModal .head small{display:block;color:#64748b;font-size:12px;margin-top:3px}',
    '#vlHQModal button{border:1px solid #d7e0eb;border-radius:10px;padding:10px 13px;background:white;font-weight:650;cursor:pointer}',
    '#vlHQModal button:disabled{opacity:.5;cursor:not-allowed}',
    '#vlHQModal .stage{height:min(53dvh,420px);min-height:190px;background:#101827;border-radius:12px;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center}',
    '#vlHQModal video{width:100%;height:100%;object-fit:contain}',
    '#vlHQModal video[hidden],#vlHQModal button[hidden],#vlHQModal span[hidden]{display:none!important}',
    '#vlHQModal .rec{position:absolute;left:12px;top:12px;border-radius:8px;background:#dc2626;color:white;padding:6px 10px;font-weight:700;font-size:12px}',
    '#vlHQModal .tools{display:flex;align-items:center;gap:12px;margin-top:12px}',
    '#vlHQModal .tools label{font-weight:650;font-size:13px;white-space:nowrap}',
    '#vlHQModal select{flex:1;min-width:0;border:1px solid #cbd5e1;border-radius:10px;padding:10px;background:#fff;font:inherit;font-size:13px}',
    '#vlHQModal .actual{font-weight:650;margin-top:10px;font-size:13px}',
    '#vlHQModal .message{font-size:12px;color:#475569;line-height:1.5;margin-top:6px}',
    '#vlHQModal .message[data-warning="1"]{color:#b91c1c}',
    '#vlHQModal .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}',
    '#vlHQModal .actions button{flex:1}',
    '#vlHQModal .primary{background:#01adee;color:white;border-color:#01adee}',
    '#vlHQModal .danger{background:#db1010;color:white;border-color:#db1010}',
    '#vlHQModal .choose{width:100%;margin-top:10px;font-size:13px}',
    '#vlHQModal .hint{margin:8px 2px 2px;color:#64748b;font-size:11px;line-height:1.5}'
  ].join('\n');
  const style=document.createElement('style');
  style.textContent=css;document.head.appendChild(style);
  const modal=document.createElement('div');
  modal.id='vlHQModal';modal.hidden=true;
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label','Quay video chất lượng cao');
  modal.innerHTML=[
    '<div class="panel">',
    '<div class="head"><div><strong>Quay video chất lượng cao</strong><small>Giữ nguyên file khi tải lên Drive</small></div><button type="button" data-act="close" aria-label="Đóng">✕</button></div>',
    '<div class="stage"><video id="vlHQLive" autoplay muted playsinline></video><video id="vlHQReview" controls playsinline hidden></video><span id="vlHQRec" class="rec" hidden>● REC <span id="vlHQTime">00:00</span></span></div>',
    '<div class="tools"><label for="vlHQQuality">Chất lượng</label><select id="vlHQQuality"><option value="1080">1080p / 30 FPS</option><option value="2160">4K / 30 FPS (nếu hỗ trợ)</option></select></div>',
    '<div id="vlHQActual" class="actual">Đang khởi động camera…</div>',
    '<div id="vlHQMessage" class="message" aria-live="polite"></div>',
    '<div class="actions"><button type="button" id="vlHQStart" class="primary" data-act="start" disabled>Bắt đầu quay</button><button type="button" id="vlHQStop" class="danger" data-act="stop" hidden>Dừng quay</button><button type="button" id="vlHQRetake" data-act="retake" hidden>Quay lại</button><button type="button" id="vlHQUpload" class="primary" data-act="upload" hidden>Up lên Drive</button></div>',
    '<button type="button" class="choose" data-act="choose">Chọn video đã quay bằng Camera điện thoại</button>',
    '<p class="hint">Camera gốc của iPhone có thể cho chất lượng cao hơn trình duyệt. Nếu camera web không cấp 1080p, hãy quay bằng Camera rồi chọn video từ thư viện.</p>',
    '</div>'
  ].join('');
  document.body.appendChild(modal);
  const by=id=>document.getElementById(id);
  const live=by('vlHQLive'),preview=by('vlHQReview'),quality=by('vlHQQuality');
  const startBtn=by('vlHQStart'),stopBtn=by('vlHQStop'),againBtn=by('vlHQRetake'),upBtn=by('vlHQUpload');
  const actual=by('vlHQActual'),msg=by('vlHQMessage'),badge=by('vlHQRec'),clock=by('vlHQTime');
  function setMessage(value,warn=false){msg.textContent=value;msg.dataset.warning=warn?'1':'0';}
  function stopTimer(){if(state.timer)clearInterval(state.timer);state.timer=null;}
  function releaseCamera(){
    const stream=state.stream;state.stream=null;
    if(stream)stream.getTracks().forEach(track=>{try{track.stop();}catch(_){}});
    live.pause();live.srcObject=null;
  }
  function clearRecorded(){
    state.file=null;preview.pause();preview.onloadedmetadata=null;preview.removeAttribute('src');preview.load();
    if(state.url){URL.revokeObjectURL(state.url);state.url=null;}
    preview.hidden=true;live.hidden=false;againBtn.hidden=true;upBtn.hidden=true;
  }
  const supported=()=>!!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  function mime(){
    for(const type of ['video/mp4','video/webm;codecs=vp8,opus','video/webm']){
      if(window.MediaRecorder.isTypeSupported?.(type))return type;
    }
    return '';
  }
  function folder(){
    try{return typeof currentFolderId!=='undefined'?currentFolderId:window.currentFolderId;}
    catch(_){return window.currentFolderId;}
  }
  function open(){
    if(!modal.hidden)return;
    state.folder=folder();
    modal.hidden=false;
    const fab=by('fabMenu');fab?.classList.add('hidden');fab?.classList.remove('flex');
    const icon=by('fabIcon');if(icon)icon.style.transform='rotate(0deg)';
    quality.value='1080';
    void startCamera();
  }
  async function startCamera(){
    const request=++state.request;
    releaseCamera();clearRecorded();
    state.ready=false;
    badge.hidden=true;startBtn.disabled=true;startBtn.hidden=false;stopBtn.hidden=true;
    quality.disabled=false;
    if(!supported()){
      actual.textContent='Camera chất lượng cao không được hỗ trợ';
      setMessage('Hãy sử dụng Camera điện thoại rồi chọn video từ thư viện.',true);
      return;
    }
    actual.textContent='Đang xin quyền camera và microphone…';
    const preferred=Number(quality.value);
    let stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:'environment'},
          width:{ideal:preferred===2160?3840:1920},
          height:{ideal:preferred},frameRate:{ideal:30,max:30}},
        audio:true
      });
      if(request!==state.request || modal.hidden){stream.getTracks().forEach(t=>t.stop());return;}
      state.stream=stream;live.srcObject=stream;
      try{await live.play();}catch(_){}
      const settings=stream.getVideoTracks()[0]?.getSettings?.()||{};
      const w=settings.width||live.videoWidth||0;
      const h=settings.height||live.videoHeight||0;
      const fps=settings.frameRate||0;
      actual.textContent='Camera thực tế: '+(w&&h?w+' × '+h:'không xác định')+
        (fps?' · '+Math.round(fps)+' FPS':'');
      if(Math.min(w,h)<1080 || Math.max(w,h)<1920){
        setMessage('Camera web chưa cấp đủ 1080p. Để tránh video bị vỡ, ứng dụng không cho quay ở độ phân giải thấp. Hãy dùng Camera điện thoại rồi chọn video đã quay.',true);
        return;
      }
      state.ready=true;startBtn.disabled=false;
      if(Math.min(w,h)<preferred*.93)
        setMessage('Trình duyệt không cấp đủ '+(preferred===2160?'4K':'1080p')+'. Có thể quay ở độ phân giải thực tế bên trên hoặc chọn video từ Camera gốc.',true);
      else setMessage('Camera sẵn sàng. Video sẽ được ghi trực tiếp, không giảm kích thước trước khi tải lên.');
    }catch(e){
      stream?.getTracks().forEach(t=>t.stop());
      if(request!==state.request||modal.hidden)return;
      actual.textContent='Không mở được camera';
      setMessage('Không thể dùng camera hoặc micro: '+(e.message||e)+'. Hãy quay bằng Camera điện thoại rồi chọn video.',true);
    }
  }
  function record(){
    if(!state.stream||!state.ready||state.recording)return;
    const options={videoBitsPerSecond:quality.value==='2160'?24000000:14000000,audioBitsPerSecond:128000};
    const type=mime();if(type)options.mimeType=type;
    let recorder;
    try{recorder=new MediaRecorder(state.stream,options);}
    catch(_){try{recorder=new MediaRecorder(state.stream);}catch(e){setMessage('Không thể ghi video: '+e.message,true);return;}}
    state.recorder=recorder;state.chunks=[];
    recorder.ondataavailable=e=>{if(e.data?.size)state.chunks.push(e.data);};
    recorder.onerror=e=>setMessage('Lỗi ghi video: '+(e.error?.message||'Không xác định'),true);
    recorder.onstop=()=>{
      state.recording=false;stopTimer();badge.hidden=true;stopBtn.hidden=true;quality.disabled=false;
      const durationMs=Math.max(1000,Date.now()-state.started);
      releaseCamera();
      const chunks=state.chunks;state.chunks=[];
      if(!chunks.some(x=>x.size)){setMessage('Không tạo được file video. Vui lòng quay lại.',true);againBtn.hidden=false;return;}
      const contentType=(recorder.mimeType||chunks[0].type||'video/mp4').split(';')[0];
      const blob=new Blob(chunks,{type:contentType});
      const ext=contentType.includes('webm')?'webm':'mp4';
      const name='VinhLoc_'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+ext;
      state.file=new File([blob],name,{type:contentType,lastModified:Date.now()});
      state.url=URL.createObjectURL(blob);
      // The final MP4/WebM encoder may output a LOWER resolution than the
      // live camera track. Read actual encoded dimensions before upload.
      preview.onloadedmetadata=()=>{
        const w=preview.videoWidth,h=preview.videoHeight;
        if(!w||!h)return;
        actual.textContent+=' · Video gốc '+w+' × '+h;
        if(Math.min(w,h)<1080 || Math.max(w,h)<1920)
          setMessage('File video xuất ra chỉ có '+w+' × '+h+'. Trình duyệt đã ghi dưới 1080p. Hãy quay bằng ứng dụng Camera điện thoại và chọn file từ thư viện để tránh video bị vỡ.',true);
      };
      preview.src=state.url;preview.hidden=false;live.hidden=true;
      startBtn.hidden=true;againBtn.hidden=false;upBtn.hidden=false;
      const bitrate=(blob.size*8/durationMs/1000);
      actual.textContent+=' · '+(blob.size/1048576).toFixed(1)+' MB · ~'+bitrate.toFixed(1)+' Mbps';
      if(bitrate<3)
        setMessage('Bitrate thực tế khá thấp. Video có thể thiếu chi tiết dù camera đạt 1080p. Bạn nên quay bằng ứng dụng Camera điện thoại rồi chọn file gốc.',true);
      else setMessage('Hãy xem lại video trước khi chọn tải lên Drive. Video không được nén lại trong ứng dụng.');
    };
    try{recorder.start(1000);}
    catch(e){state.recorder=null;setMessage('Không bắt đầu ghi hình được: '+e.message,true);return;}
    state.recording=true;state.started=Date.now();
    quality.disabled=true;startBtn.hidden=true;stopBtn.hidden=false;badge.hidden=false;
    state.timer=setInterval(()=>{
      const seconds=Math.floor((Date.now()-state.started)/1000);
      clock.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    },500);
  }
  function stopRecording(){
    if(!state.recording)return;
    state.recording=false;stopTimer();
    try{if(state.recorder?.state!=='inactive')state.recorder.stop();}
    catch(e){setMessage('Không kết thúc ghi hình được: '+e.message,true);}
  }
  function close(force=false){
    if(state.recording&&!force&&!window.confirm('Đang quay. Dừng và bỏ video này?'))return;
    state.request++;
    if(state.recorder?.state==='recording'){
      state.recorder.onstop=null;state.recorder.ondataavailable=null;
      try{state.recorder.stop();}catch(_){}
    }
    state.recording=false;state.recorder=null;state.chunks=[];stopTimer();releaseCamera();clearRecorded();
    modal.hidden=true;quality.disabled=false;
  }
  function chooseFile(){
    // File picker has NO capture attribute; it preserves recordings made
    // with the phone's native Camera and its configured 4K/HDR settings.
    const input=document.createElement('input');
    input.type='file';input.accept='video/*,.mov,.mp4';input.hidden=true;
    document.body.appendChild(input);
    input.addEventListener('change',()=>{
      const file=input.files?.[0];input.remove();
      if(!file)return;
      if(typeof window.vlUploadFiles==='function'){
        close(true);void window.vlUploadFiles([file]);
      }else setMessage('Hàng đợi upload không sẵn sàng. Không tải file lên.',true);
    },{once:true});
    input.click();
  }
  modal.addEventListener('click',event=>{
    const act=event.target.closest('[data-act]')?.dataset.act;
    if(!act)return;
    event.preventDefault();
    if(act==='close')close();
    else if(act==='start')record();
    else if(act==='stop')stopRecording();
    else if(act==='retake')void startCamera();
    else if(act==='choose')chooseFile();
    else if(act==='upload'){
      if(!state.file)return;
      if(folder()!==state.folder){setMessage('Đã đổi folder. Hãy trở lại folder gốc trước khi tải video.',true);return;}
      if(typeof window.vlUploadFiles!=='function'){setMessage('Hàng đợi upload chưa sẵn sàng.',true);return;}
      const file=state.file;
      void window.vlUploadFiles([file]);
      close(true);
    }
  });
  quality.addEventListener('change',()=>{if(!state.recording)void startCamera();});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden){e.preventDefault();close();}});
  window.addEventListener('pagehide',()=>{if(!modal.hidden)close(true);});
  // Capture BEFORE legacy onclick and the implicit label->file input click.
  window.addEventListener('click',e=>{
    if(e.target===original)return;
    const label=e.target?.closest?.('label');
    if(!label||!label.contains(original))return;
    e.preventDefault();e.stopImmediatePropagation();open();
  },true);
  window.vlHQVideo={open,close};
})();