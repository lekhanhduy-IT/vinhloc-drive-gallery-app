/* One neutral verification screen after Google returns an ID credential.
   This does not change Google's native button, account chooser, or iframe. */
(() => {
  'use strict';
  if(window.vlAuthWait)return;
  const overlay=document.createElement('div');
  overlay.id='vlAuthWait';
  overlay.hidden=true;
  overlay.setAttribute('role','status');
  overlay.setAttribute('aria-live','polite');
  overlay.setAttribute('aria-label','Đang xác thực tài khoản Google');
  const spinner=document.createElement('span');
  spinner.className='vl-auth-wait-ring';
  spinner.setAttribute('aria-hidden','true');
  overlay.appendChild(spinner);
  document.body.appendChild(overlay);

  let active=false;
  let timeout=null;
  let checkTimer=null;
  function resetTimer(){
    if(timeout!==null)clearTimeout(timeout);
    if(checkTimer!==null)clearInterval(checkTimer);
    timeout=null;checkTimer=null;
  }
  function finish(){
    active=false;
    resetTimer();
    overlay.hidden=true;
  }
  function shareMode(){return !!window.vlShareScope;}
  function isVisible(el){
    if(!el||!el.isConnected||el.hidden||el.classList.contains('hidden'))return false;
    return getComputedStyle(el).display!=='none';
  }
  function checkCompletion(){
    if(!active)return;
    if(shareMode()){
      if(window.vlShareScope.ready?.()===true){finish();return;}
      const warning=document.getElementById('vlShareAuthMessage');
      if(warning?.dataset.vlAuthFailed==='1')finish();
    } else {
      const auth=document.getElementById('auth-overlay');
      // The legacy app closes the login overlay only after its login flow
      // resolves; merely receiving the Google credential is NOT success.
      if(!auth||!isVisible(auth)){finish();return;}
      const error=document.getElementById('auth-error-msg');
      if(error && isVisible(error) && error.textContent?.trim())finish();
    }
  }
  function fail(message){
    finish();
    if(shareMode()){
      const warning=document.getElementById('vlShareAuthMessage');
      if(warning)warning.textContent=message||'Không thể xác thực tài khoản Google. Hãy thử lại.';
    }else{
      const error=document.getElementById('auth-error-msg');
      if(error && isVisible(document.getElementById('auth-overlay'))){
        error.textContent=message||'Không thể xác thực tài khoản Google. Hãy thử lại.';
        error.classList.remove('hidden');
      }
    }
  }
  function begin(){
    const target=shareMode()?
      document.getElementById('vl-share-login-gate'):
      document.getElementById('auth-overlay');
    if(!isVisible(target))return;
    resetTimer();
    active=true;
    overlay.hidden=false;
    // Never trap the user behind an infinite white screen if an API stalls.
    timeout=setTimeout(()=>{
      if(active)fail('Xác thực Google chưa hoàn tất. Hãy thử đăng nhập lại.');
    },45000);
    checkTimer=setInterval(checkCompletion,250);
    checkCompletion();
  }
  window.vlAuthWait={begin,finish,fail,isActive:()=>active};
  window.addEventListener('pageshow',()=>{
    if(active)checkCompletion();
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&active)checkCompletion();
  });
  // Shared-login gate is dynamically created/removed.
  new MutationObserver(()=>{if(active)checkCompletion()})
    .observe(document.body,{childList:true});
})();