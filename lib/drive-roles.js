/* Central Shared Drive membership: never trust a client email or role flag. */
const DRIVE_ID='0AMLRHzF05fTFUk9PVA';
export const PRIMARY_ADMIN='admin@tudonghoavinhloc.com';
const API='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(DRIVE_ID)+'/permissions';
let cached=null, expires=0, pending=null;
const emailOK=value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function normalizeAccountEmail(value){
  const email=String(value||'').trim().toLowerCase();
  return emailOK(email)?email:null;
}
export function invalidateMembers(){cached=null;expires=0;pending=null;}
export function appRole(member){
  if(!member||member.deleted)return 'guest';
  return member.role==='organizer'||member.emailAddress?.toLowerCase()===PRIMARY_ADMIN?'admin':'member';
}
export async function driveRequest(url,token,options={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),16000);
  try{
    const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal,
      headers:{Authorization:'Bearer '+token,...(options.headers||{})}});
    if(!response.ok){
      const body=await response.json().catch(()=>null);
      const message=body?.error?.message||'Google Drive HTTP '+response.status;
      const error=new Error(message);
      error.status=response.status;
      throw error;
    }
    if(response.status===204)return {};
    return response.json();
  }finally{clearTimeout(timeout);}
}
export async function driveMembers(token,{fresh=false}={}){
  if(!fresh&&cached&&Date.now()<expires)return cached;
  if(pending&&!fresh)return pending;
  const task=(async()=>{
    const members=[];let pageToken='';
    for(let page=0;page<20;page++){
      const params=new URLSearchParams({supportsAllDrives:'true',pageSize:'100',
        fields:'nextPageToken,permissions(id,type,emailAddress,displayName,role,deleted)'});
      if(pageToken)params.set('pageToken',pageToken);
      const result=await driveRequest(API+'?'+params,token);
      for(const item of result.permissions||[]){
        if(item.type==='user'&&!item.deleted&&normalizeAccountEmail(item.emailAddress))
          members.push({...item,emailAddress:normalizeAccountEmail(item.emailAddress)});
      }
      pageToken=result.nextPageToken||'';
      if(!pageToken){cached=members;expires=Date.now()+10000;return members;}
    }
    throw new Error('Danh sách quyền Drive vượt giới hạn phân trang');
  })();
  pending=task;
  try{return await task;}finally{if(pending===task)pending=null;}
}
export async function memberForEmail(email,token,{fresh=false}={}){
  const normalized=normalizeAccountEmail(email);
  if(!normalized)return null;
  return (await driveMembers(token,{fresh})).find(item=>item.emailAddress===normalized)||null;
}
export async function roleForEmail(email,token,options={}){
  return appRole(await memberForEmail(email,token,options));
}
export function permissionsUrl(id){
  if(!/^[A-Za-z0-9_-]{3,180}$/.test(String(id||'')))throw new Error('Mã quyền không hợp lệ');
  return API+'/'+encodeURIComponent(id)+'?supportsAllDrives=true';
}
export {API as sharedDrivePermissionsUrl};
