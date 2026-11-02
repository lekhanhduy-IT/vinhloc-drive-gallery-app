import {createHash,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';

// Each share link owns an unguessable 256-bit capability. Only its hash is
// stored privately in the shared folder's Drive appProperties, NOT in HTML,
// cookies or environment variables. Reissuing a link does not revoke others.
const API='https://www.googleapis.com/drive/v3/files';
const DRIVE='0AMLRHzF05fTFUk9PVA';
const ID=/^[A-Za-z0-9_-]{10,180}$/;
const tokenRe=/^[A-Za-z0-9_-]{40,64}$/;
const context='vinhloc/gallery-share/folder/v1';
const sharePrefix='vlshare_';
const maxGrants=25;
const dateSeconds=()=>Math.floor(Date.now()/1000);
const expiryDays=30;
const keyFor=token=>sharePrefix+createHash('sha256').update(token).digest('hex').slice(0,44);

async function metadata(id,token){
  if(!ID.test(String(id||''))||!token)throw new Error('Thông tin thư mục không hợp lệ');
  const uri=API+'/'+encodeURIComponent(id)+
    '?supportsAllDrives=true&fields=id,mimeType,driveId,trashed,appProperties';
  const response=await fetch(uri,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
  if(!response.ok)throw new Error('Google Drive không xác nhận thư mục: '+response.status);
  const data=await response.json();
  if(data.trashed||data.driveId!==DRIVE||data.mimeType!=='application/vnd.google-apps.folder')
    throw new Error('Không phải thư mục được chia sẻ hợp lệ');
  return data;
}
export async function signFolderGrant(folderId,accessToken){
  const data=await metadata(folderId,accessToken);
  const properties={...(data.appProperties||{})};
  // Preserve independent links; prune expired ones before issuing a new one.
  for(const key of Object.keys(properties)){
    if(key.startsWith(sharePrefix)&&Number(properties[key])<=dateSeconds())
      delete properties[key];
  }
  const active=Object.keys(properties).filter(key=>key.startsWith(sharePrefix));
  if(active.length>=maxGrants)
    throw new Error('Thư mục đã có nhiều liên kết. Hãy thu hồi liên kết cũ trước khi chia sẻ tiếp.');
  const secret=randomBytes(32).toString('base64url');
  const property=keyFor(secret);
  const expires=dateSeconds()+expiryDays*86400;
  properties[property]=String(expires);
  const url=API+'/'+encodeURIComponent(folderId)+
    '?supportsAllDrives=true&fields=id,appProperties';
  const response=await fetch(url,{
    method:'PATCH',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
    body:JSON.stringify({appProperties:properties}),cache:'no-store'
  });
  if(!response.ok)throw new Error('Không thể lưu quyền chia sẻ trên Drive: '+response.status);
  const updated=await response.json();
  if(updated.appProperties?.[property]!==String(expires))
    throw new Error('Google Drive chưa ghi nhận quyền chia sẻ');
  return 'vlsg2.'+folderId+'.'+secret;
}
export async function readFolderGrant(grant,accessToken){
  if(typeof grant!=='string'||grant.length>1024)return null;
  const parts=grant.split('.');
  if(parts[0]==='vlsg2'&&parts.length===3){
    const [,root,secret]=parts;
    if(!ID.test(root)||!tokenRe.test(secret))return null;
    try {
      const data=await metadata(root,accessToken);
      const until=Number(data.appProperties?.[keyFor(secret)]||0);
      if(!Number.isSafeInteger(until)||until<=dateSeconds()||
         until>dateSeconds()+expiryDays*86400)return null;
      return {root,exp:until};
    }catch(_){return null;}
  }
  // Previously issued v1 links are accepted only on deployments that already
  // had a signing key configured. Never substitute a public or hardcoded key.
  if(parts[0]!=='vlsg1'||parts.length!==3)return null;
  const raw=process.env.MEDIA_SESSION_SECRET||process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!raw)return null;
  const [,payload,signature]=parts;
  const key=createHmac('sha256',raw).update(context).digest();
  const expected=createHmac('sha256',key).update(payload).digest();
  const actual=Buffer.from(signature,'base64url');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
  try{
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return ID.test(data.root)&&Number.isSafeInteger(data.exp)&&data.exp>dateSeconds()?data:null;
  }catch(_){return null;}
}
