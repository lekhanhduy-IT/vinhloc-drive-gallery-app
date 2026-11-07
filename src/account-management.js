/* Admin-only account screen. Roles and mutations are decided by the server. */
(() => {
  'use strict';
  if(window.__vlAccountManagerInstalled)return;
  window.__vlAccountManagerInstalled=true;
  const API='/api/account-management';
  let role='guest',verifiedEmail='',known=false,viewing=false,checking=null,loadingList=false;
  let savedScroll=0,adminMenu=null,page=null;
  const authEmail=()=>String(localStorage.getItem('vinhloc_authenticated_email')||'').trim().toLowerCase();
  const share=()=>!!window.vlShareScope;
  const el=id=>document.getElementById(id);
  const create=(tag,klass,text)=>{
    const node=document.createElement(tag);
    if(klass)node.className=klass;
    if(text!==undefined)node.textContent=text;
    return node;
  };
  async function request(action,body){
    const posting=!!body;
    const url=API+(posting?'':'?action='+encodeURIComponent(action));
    const response=await fetch(url,{
      method:posting?'POST':'GET',credentials:'same-origin',cache:'no-store',
      ...(posting?{headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,...body})}:{})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.success!==true){
      const error=new Error(result.message||'Không thể kết nối máy chủ phân quyền');
      error.status=response.status;
      error.code=result.code||'';
      throw error;
    }
    return result;
  }
  function setRole(value){
    const email=String(value?.email||'').toLowerCase();
    const scope=!!value?.scopeRoot||share();
    const matched=!!email&&(!authEmail()||authEmail()===email);
    role=!scope&&matched&&['member','admin'].includes(value?.role)?value.role:'guest';
    verifiedEmail=email;
    known=role!=='guest'||scope;
    document.body.dataset.vlAccountRole=role;
    document.body.dataset.vlVerifiedAdmin=role==='admin'?'true':'false';
    window.vlAccountRole=role; // display only; backend never trusts this property
    const menu=el('menu-quanly');
    if(menu)menu.hidden=role!=='admin';
    if(viewing&&role!=='admin')close();
    window.dispatchEvent(new CustomEvent('vl:account-role',{detail:{role,email}}));
  }
  function installMenu(){
    if(el('menu-quanly'))return;
    const target=el('menu-ytuong');
    if(!target)return;
    adminMenu=create('div','sidebar-item','');
    adminMenu.id='menu-quanly';
    adminMenu.hidden=true;
    const icon=create('i','fas fa-users-cog w-6 text-center');
    adminMenu.append(icon,document.createTextNode(' Quản lý'));
    adminMenu.addEventListener('click',()=>{if(role==='admin')open();});
    target.insertAdjacentElement('afterend',adminMenu);
  }
  function message(text,error=false){
    const node=el('vlAdminMessage');
    if(!node)return;
    node.textContent=text||'';
    node.classList.toggle('vl-error',!!error);
  }
  function installPage(){
    if(page)return;
    const main=el('contentArea');
    if(!main)return;
    page=create('section');
    page.id='vlAdminPage';
    page.hidden=true;
    page.innerHTML=[
      '<div class="vl-admin-shell">',
      '<h2 class="vl-admin-title">Quản lý tài khoản</h2>',
      '<p class="vl-admin-intro">Cấp quyền truy cập và quản lý thành viên Google Shared Drive. Quyền được xác minh trực tiếp trên Google Drive.</p>',
      '<div class="vl-admin-card">',
      '<form id="vlAdminForm" class="vl-admin-form" autocomplete="off">',
      '<div class="vl-admin-field"><label for="vlAdminEmail">Tài khoản Gmail</label>',
      '<input id="vlAdminEmail" class="vl-admin-input" type="email" required maxlength="254" placeholder="name@gmail.com" autocomplete="off"></div>',
      '<div class="vl-admin-field"><label for="vlAdminRole">Loại tài khoản</label>',
      '<select id="vlAdminRole" class="vl-admin-select"><option value="member">Bộ nhớ dùng chung</option><option value="admin">Admin</option></select></div>',
      '<button id="vlAdminAdd" class="vl-admin-submit" type="submit">Thêm</button>',
      '</form><div id="vlAdminMessage" class="vl-admin-message" role="status" aria-live="polite"></div></div>',
      '<div class="vl-admin-card">',
      '<div class="vl-admin-toolbar"><div><h3 class="vl-admin-heading">Danh sách tài khoản</h3>',
      '<span id="vlAdminCount" class="vl-admin-count"></span></div>',
      '<button type="button" id="vlAdminRefresh" class="vl-admin-reload">Làm mới</button></div>',
      '<div class="vl-admin-table-wrap"><table>',
      '<thead><tr><th>Tài khoản Gmail</th><th>Loại tài khoản</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>',
      '<tbody id="vlAdminRows"><tr><td colspan="4" class="vl-admin-empty">Đang tải danh sách…</td></tr></tbody>',
      '</table></div></div></div>'
    ].join('');
    main.appendChild(page);
    const search=el('searchInput')?.closest('.sticky');
    if(search&&!search.id)search.id='vlGallerySearchBar';
    const fab=el('fabMain')?.parentElement;
    if(fab&&!fab.id)fab.id='vlGalleryFab';
    el('vlAdminForm')?.addEventListener('submit',event=>{event.preventDefault();void addAccount();});
    el('vlAdminRefresh')?.addEventListener('click',()=>void loadList());
  }
  function open(){
    if(role!=='admin')return;
    installPage();
    if(!page)return;
    if(!viewing){
      savedScroll=el('contentArea')?.scrollTop||0;
      viewing=true;
      document.body.dataset.vlAccountView='true';
      el('contentArea')?.classList.add('vl-admin-open');
      page.hidden=false;
      if(el('currentFolderName'))el('currentFolderName').textContent='Quản lý';
      el('btnBack')?.classList.add('hidden');
      el('btnMenu')?.classList.remove('hidden');
      el('menu-trienkhai')?.classList.remove('active');
      el('menu-ytuong')?.classList.remove('active');
      el('menu-quanly')?.classList.add('active');
      if(el('sidebar')?.classList.contains('open'))window.toggleSidebar?.();
      if(el('contentArea'))el('contentArea').scrollTop=0;
    }
    void loadList();
  }
  function close(){
    if(!viewing)return;
    viewing=false;
    document.body.dataset.vlAccountView='false';
    el('contentArea')?.classList.remove('vl-admin-open');
    if(page)page.hidden=true;
    el('menu-quanly')?.classList.remove('active');
    try{window.updateBreadcrumbs?.();}catch(_){}
    if(el('contentArea'))el('contentArea').scrollTop=savedScroll;
    const active=String(typeof currentCategory!=='undefined'?currentCategory:window.currentCategory||'Triển khai');
    el(active==='Ý tưởng'?'menu-ytuong':'menu-trienkhai')?.classList.add('active');
  }
  window.vlCloseAccountManagement=close;
  document.addEventListener('click',event=>{
    if(viewing&&event.target.closest?.('#menu-trienkhai,#menu-ytuong'))close();
  },true);
  window.addEventListener('popstate',close);
  function cell(value,klass){
    const td=create('td',klass||'');
    td.textContent=value===undefined?'':String(value);
    return td;
  }
  function draw(accounts,presenceAvailable){
    const tbody=el('vlAdminRows');
    if(!tbody)return;
    tbody.replaceChildren();
    el('vlAdminCount').textContent=accounts.length+' tài khoản được cấp quyền';
    if(!accounts.length){
      const row=create('tr'),td=cell('Chưa có tài khoản','vl-admin-empty');
      td.colSpan=4;row.appendChild(td);tbody.appendChild(row);return;
    }
    for(const account of accounts){
      const tr=create('tr');
      const email=cell(account.email,'vl-admin-email');
      email.title=account.email;
      const kind=create('td');
      const badge=create('span','vl-role'+(account.role==='admin'?' vl-role-admin':''),
        account.role==='admin'?'Admin':'Bộ nhớ dùng chung');
      kind.appendChild(badge);
      const state=create('td');
      const current=account.online;
      const indicator=create('span','vl-state'+(current===true?' vl-state-online':
        current===null?' vl-state-unknown':''),
        current===null?'Không xác định':current?'Online':'Offline');
      if(account.lastSeen)indicator.title='Hoạt động gần nhất: '+new Date(account.lastSeen).toLocaleString('vi-VN');
      else if(!presenceAvailable)indicator.title='Chưa cấu hình dịch vụ hiện diện';
      state.appendChild(indicator);
      const action=create('td');
      const remove=create('button','vl-admin-delete','Xóa tài khoản');
      remove.type='button';
      remove.disabled=account.email==='admin@tudonghoavinhloc.com'||account.email===verifiedEmail;
      if(remove.disabled)remove.title='Không thể xóa tài khoản Admin gốc hoặc chính mình';
      else remove.addEventListener('click',()=>void removeAccount(account,remove));
      action.appendChild(remove);
      tr.append(email,kind,state,action);
      tbody.appendChild(tr);
    }
  }
  async function loadList(){
    if(!viewing||role!=='admin'||loadingList)return;
    loadingList=true;
    const btn=el('vlAdminRefresh');
    if(btn)btn.disabled=true;
    try{
      const data=await request('list');
      if(viewing)draw(data.accounts||[],data.presenceAvailable);
    }catch(error){message(error.message,true);}
    finally{loadingList=false;if(btn)btn.disabled=false;}
  }
  async function addAccount(){
    if(role!=='admin')return;
    const input=el('vlAdminEmail'),button=el('vlAdminAdd');
    const email=String(input?.value||'').trim().toLowerCase();
    if(!input?.reportValidity())return;
    if(!email||email.length>254)return;
    button.disabled=true;
    message('Đang cập nhật quyền Google Drive…');
    try{
      const result=await request('upsert',{email,role:el('vlAdminRole')?.value});
      message(result.message+' — '+result.email);
      input.value='';
      await loadList();
    }catch(error){message(error.message,true);}
    finally{button.disabled=false;}
  }
  async function removeAccount(account,button){
    if(role!=='admin')return;
    if(!window.confirm('Xóa quyền truy cập Shared Drive của '+account.email+'? Tài khoản này sẽ chỉ còn truy cập qua liên kết chia sẻ hợp lệ.'))return;
    button.disabled=true;
    message('Đang thu hồi quyền…');
    try{
      const result=await request('remove',{email:account.email,permissionId:account.permissionId});
      message(result.message+' — '+account.email);
      await loadList();
    }catch(error){message(error.message,true);}
    finally{button.disabled=false;}
  }
  let revoking=false;
  async function loseAccess(){
    if(revoking)return;
    revoking=true;
    setRole(null);
    try{await fetch('/api/media',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});}
    catch(_){}
    try{localStorage.removeItem('vinhloc_authenticated_email');}catch(_){}
    alert('Quyền truy cập nội bộ đã được thu hồi. Vui lòng đăng nhập bằng liên kết chia sẻ thư mục hợp lệ.');
    location.reload();
  }
  async function check(force=false){
    if(checking)return checking;
    if(!authEmail()||share()){
      setRole(null);
      return false;
    }
    checking=(async()=>{
      try{
        const data=await request('me');
        setRole(data);
        return true;
      }catch(error){
        if(error.code==='ROLE_REVOKED'&&known&&!share())await loseAccess();
        else if(error.status===403&&known&&!share())await loseAccess();
        return false;
      }
    })();
    try{return await checking;}finally{checking=null;}
  }
  async function heartbeat(){
    if(!authEmail()||document.hidden||share())return;
    if(role==='guest'){await check();return;}
    try{
      const response=await request('heartbeat',{});
      if(response.role!==role||response.email!==verifiedEmail)setRole(response);
    }catch(error){
      if(error.code==='ROLE_REVOKED'||error.status===403)await loseAccess();
    }
  }
  function restoreDelegatedAdminUI(){
    if(role!=='admin'||verifiedEmail==='admin@tudonghoavinhloc.com')return;
    // Existing obfuscated patch checks the original admin mailbox; keep
    // its visual marker in sync with the server-verified Manager role.
    if(document.body.getAttribute('data-is-admin')!=='true')
      document.body.setAttribute('data-is-admin','true');
  }
  new MutationObserver(restoreDelegatedAdminUI).observe(document.body,{
    attributes:true,attributeFilter:['data-is-admin']
  });
  function start(){
    installMenu();
    installPage();
    document.body.dataset.vlAccountView='false';
    window.addEventListener('vl:media-authorized',()=>void check(true));
    window.addEventListener('focus',()=>{void check(true);void heartbeat();});
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden){void check(true);void heartbeat();}
    });
    window.addEventListener('storage',event=>{
      if(event.key==='vinhloc_authenticated_email')void check(true);
    });
    setTimeout(()=>void check(true),1600);
    setInterval(()=>{
      if(!document.hidden){void check();void heartbeat();if(viewing)void loadList();}
    },25000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
