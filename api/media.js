import { createPublicKey, createHmac, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { Readable } from 'node:stream';
import {readFolderGrant} from '../lib/share-capability.js';
import {verifiedRole} from '../lib/verified-role.js';

// A first-party media gateway: Google ID token -> Shared Drive membership ->
// Drive API with the app service token. No public Drive permissions, no URL tokens.
const CLIENT_ID = '1034177686409-1fhm0m0tqmf58qjj1p0r2ifo018eh8o2.apps.googleusercontent.com';
const SHARED_DRIVE_ID = '0AMLRHzF05fTFUk9PVA';
const GALLERY_ROOT_ID = '1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx3xI-bNWfeffsEH-iIc0yYfF9bHYvAiKZKWIfco6j7Z7GOtOAv7Q8WE1_y9xjen7c/exec';
const COOKIE = 'vl_verified_media';
// Same-device first-party internal session; each request still checks Drive role.
const INTERNAL_TTL_SECONDS = 7 * 24 * 60 * 60;
const SHARE_COOKIE='vl_share_scope';
const MAX_IMAGE = 40 * 1024 * 1024;
const MAX_VIDEO = 1024 * 1024 * 1024;
let keys = null, keysUntil = 0;
const authorized = new Map();
let driveAuth = null, driveAuthUntil = 0;

function error(res, status, message) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({success:false, message});
}
async function request(url, options = {}, ms = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, {...options, signal:controller.signal, redirect:'follow'}); }
  finally { clearTimeout(timeout); }
}
async function googleKeys() {
  if (keys && Date.now() < keysUntil) return keys;
  const response = await request('https://www.googleapis.com/oauth2/v3/certs');
  if (!response.ok) throw new Error('Không tải được khóa xác thực Google');
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error('Khóa Google không hợp lệ');
  keys = body.keys;
  const match = (response.headers.get('cache-control') || '').match(/max-age=(\d+)/);
  keysUntil = Date.now() + Math.min(3600, Math.max(120, Number(match?.[1] || 600))) * 1000;
  return keys;
}
async function verifyGoogleIdToken(token) {
  if (typeof token !== 'string' || token.length > 6000 ||
      !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error('Token Google không hợp lệ');
  const [headerB64, payloadB64, sigB64] = token.split('.');
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_) { throw new Error('Token Google không đọc được'); }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Thuật toán token không hợp lệ');
  const jwks = await googleKeys();
  const key = jwks.find(j => j.kid === header.kid && j.kty === 'RSA' && j.use === 'sig');
  if (!key) throw new Error('Không tìm thấy khóa Google');
  const publicKey = createPublicKey({key, format:'jwk'});
  const valid = verifySignature('RSA-SHA256',
    Buffer.from(headerB64 + '.' + payloadB64),
    publicKey, Buffer.from(sigB64, 'base64url'));
  if (!valid || payload.aud !== CLIENT_ID ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
      Number(payload.exp) < Math.floor(Date.now() / 1000) + 5 ||
      Number(payload.iat) > Math.floor(Date.now() / 1000) + 60 ||
      payload.email_verified !== true || !payload.email || !payload.sub)
    throw new Error('Token Google đã hết hạn hoặc không dành cho QL Ảnh');
  return {
    email: String(payload.email).trim().toLowerCase(),
    sub: payload.sub,
    exp: Number(payload.exp)
  };
}
// Prefer a signed first-party media session over repeated Google/GAS checks
// on every thumbnail. MEDIA_SESSION_SECRET is recommended; derive an isolated
// key from the project's existing private Upstash token as a fallback.
function signingKey() {
  const raw = process.env.MEDIA_SESSION_SECRET || process.env.UPSTASH_REDIS_REST_TOKEN;
  return raw ? createHmac('sha256',raw).update('vinhloc/private-media/session/v1').digest() : null;
}
function sealSession(identity) {
  const key = signingKey();
  if (!key) return null;
  const payload = Buffer.from(JSON.stringify({
    sub:identity.sub,email:identity.email,
    ...(identity.scopeRoot?{scopeRoot:identity.scopeRoot}:{}),
    member:identity.member===true,
    role:identity.role||'guest',
    // Shared-folder grants expire with the original Google credential.
    // Internal members use a signed session so PWA reopens retain owner rights.
    exp:identity.scopeRoot ? Math.min(identity.exp,Math.floor(Date.now()/1000)+3300) :
      Math.floor(Date.now()/1000)+INTERNAL_TTL_SECONDS
  })).toString('base64url');
  const signature = createHmac('sha256',key).update(payload).digest('base64url');
  return 'vl1.'+payload+'.'+signature;
}
function readSignedSession(value) {
  if (!value.startsWith('vl1.')) return null;
  const key=signingKey();
  if (!key) throw new Error('Phiên xem ảnh không còn hợp lệ');
  const [,body,sig]=value.split('.');
  if (!body || !sig || body.length>1200) throw new Error('Phiên xem ảnh bị hỏng');
  const expected=createHmac('sha256',key).update(body).digest();
  const actual=Buffer.from(sig,'base64url');
  if (expected.length!==actual.length || !timingSafeEqual(expected,actual))
    throw new Error('Phiên xem ảnh không hợp lệ');
  const data=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  if (!data.sub || !data.email || Number(data.exp)<Math.floor(Date.now()/1000)+5)
    throw new Error('Phiên xem ảnh đã hết hạn');
  return data;
}

function cookie(req,name=COOKIE) {
  const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim());
  const item=raw.find(x=>x.startsWith(name+'='));
  return item?item.slice(name.length+1):'';
}
async function callScript(action, payload={}) {
  const response = await request(SCRIPT_URL, {
    method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({action,...payload})
  }, 18000);
  if (!response.ok) throw new Error('Apps Script: HTTP ' + response.status);
  const data = await response.json();
  if (data?.success !== true) throw new Error(data?.message || data?.error || 'Apps Script không xác nhận');
  return data;
}
async function requireAccount(req) {
  const stored=cookie(req);
  if(!stored)throw Object.assign(new Error('Chưa có phiên xác thực Google'),{authFailure:true});
  // Always verify the actual current Drive role, even with a previously
  // signed HttpOnly session. Removing a member revokes protected API access.
  let identity;
  try{identity=readSignedSession(stored);}
  catch(error){error.authFailure=true;throw error;}
  if(!identity){
    try{identity=await verifyGoogleIdToken(stored);}
    catch(error){error.authFailure=true;throw error;}
    const share=cookie(req,SHARE_COOKIE);
    if(share){
      const grant=await readFolderGrant(share,await driveToken());
      if(!grant)throw new Error('Liên kết chia sẻ đã hết hạn hoặc bị thu hồi');
      identity.scopeRoot=grant.root;
    }
  }
  const role=await verifiedRole(identity.email,driveToken);
  identity.role=role;
  identity.member=role!=='guest';
  if(!identity.scopeRoot && role==='guest')
    throw Object.assign(new Error('Tài khoản không còn quyền nội bộ. Chỉ có thể truy cập bằng liên kết chia sẻ hợp lệ.'),{revoked:true});
  return identity;
}

async function driveToken() {
  if (driveAuth && Date.now() < driveAuthUntil) return driveAuth;
  const result = await callScript('getToken');
  if (!result.token) throw new Error('Không nhận được quyền Drive');
  driveAuth = result.token; driveAuthUntil = Date.now() + 60000;
  return driveAuth;
}
async function scopedPath(targetId,scopeRoot,token){
  if(!scopeRoot)return true;
  const pattern=/^[A-Za-z0-9_-]{10,180}$/;
  if(!pattern.test(String(targetId||'')))return false;
  const visited=new Set();
  let cursor=targetId;
  for(let depth=0;depth<45;depth++){
    if(cursor===scopeRoot)return true;
    if(visited.has(cursor))return false;
    visited.add(cursor);
    const q='?supportsAllDrives=true&fields=id,parents,driveId,trashed';
    const response=await request('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(cursor)+q,{
      headers:{Authorization:'Bearer '+token}
    });
    if(!response.ok)return false;
    const meta=await response.json();
    if(meta.trashed||meta.driveId!==SHARED_DRIVE_ID)return false;
    const parents=meta.parents||[];
    if(parents.includes(scopeRoot))return true;
    if(parents.length!==1)return false;
    cursor=parents[0];
  }
  return false;
}
// Some older VinhLoc folders are under the configured gallery root but
// have no driveId (My Drive). Never allow arbitrary Drive files: trace
// every parent all the way to this exact configured root.
async function inManagedRoot(id,token){
  const seen=new Set();
  let cursor=id;
  for(let depth=0;depth<45;depth++){
    if(cursor===GALLERY_ROOT_ID)return true;
    if(seen.has(cursor))return false;
    seen.add(cursor);
    const path='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(cursor)+
      '?supportsAllDrives=true&fields=id,parents,trashed';
    const response=await request(path,{headers:{Authorization:'Bearer '+token}});
    if(!response.ok)return false;
    const item=await response.json();
    if(item.trashed||!Array.isArray(item.parents)||item.parents.length!==1)return false;
    cursor=item.parents[0];
  }
  return false;
}
// Node/Vercel HTTP headers are Latin-1 only. Never put a Vietnamese
// filename directly inside the quoted filename= parameter. RFC 5987's
// filename*=UTF-8'' form preserves the real Unicode Drive name.
function mediaContentDisposition(name) {
  const unicodeName=Array.from(String(name||'file').normalize('NFC')
    .replace(/[\\/\x00-\x1F\x7F]/g,'_'))
    .slice(0,160).join('')
    .replace(/[\uD800-\uDFFF]/g,'_') || 'file';
  const asciiName=unicodeName.normalize('NFKD')
    .replace(/\p{M}/gu,'')
    .replace(/đ/g,'d').replace(/Đ/g,'D')
    .replace(/[^A-Za-z0-9._ -]/g,'_')
    .slice(0,120) || 'file';
  const encoded=encodeURIComponent(unicodeName)
    .replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return 'inline; filename="'+asciiName+'"; filename*=UTF-8\'\''+encoded;
}
export const config = {maxDuration: 60};
// Reuse this verified, signed HttpOnly session for ownership-protected writes.
export async function verifiedAccount(req) {
  return requireAccount(req);
}
export async function serverDriveToken() {
  return driveToken();
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && new URL(origin).host !== host) return error(res,403,'Nguồn đăng nhập không hợp lệ');
    let body = req.body || {};
    if (typeof body === 'string') { try {body=JSON.parse(body)}catch(_){body={}} }
    if (body.action === 'logout') {
      res.setHeader('Set-Cookie',[
        COOKIE+'=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0',
        COOKIE+'=; HttpOnly; Secure; SameSite=Strict; Path=/api/media; Max-Age=0',
        SHARE_COOKIE+'=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0'
      ]);
      return res.status(200).json({success:true, message:'Đã đăng xuất khỏi phiên media'});
    }
    try {
      let identity;
      try{identity=await verifyGoogleIdToken(body.credential);}
      catch(error){error.authFailure=true;throw error;}
      const grant=body.shareGrant ? await readFolderGrant(body.shareGrant,await driveToken()):null;
      if(body.shareGrant && !grant)return error(res,403,'Liên kết chia sẻ không hợp lệ hoặc đã hết hạn');
      if(grant){
        const token=await driveToken();
        const url='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(grant.root)+
          '?supportsAllDrives=true&fields=id,mimeType,driveId,trashed';
        const raw=await request(url,{headers:{Authorization:'Bearer '+token}});
        if(!raw.ok)return error(res,403,'Thư mục chia sẻ không tồn tại');
        const folder=await raw.json();
        if(folder.driveId!==SHARED_DRIVE_ID||folder.trashed||
           folder.mimeType!=='application/vnd.google-apps.folder')
          return error(res,403,'Thư mục chia sẻ không được cấp quyền');
        identity.scopeRoot=grant.root;
      }
      // Google ID token identifies the human; the Drive ACL determines role.
      const currentRole=await verifiedRole(identity.email,driveToken,{fresh:true});
      identity.role=currentRole;
      identity.member=currentRole!=='guest';
      if(!grant && currentRole==='guest')
        return error(res,403,'Tài khoản chưa được cấp quyền Shared Drive. Vui lòng dùng liên kết chia sẻ hợp lệ.');
      const signed=sealSession(identity);
      // Never give a raw Google ID token an artificial seven-day lifetime.
      const life=signed && !identity.scopeRoot ? INTERNAL_TTL_SECONDS :
        Math.min(3300,Math.max(1,identity.exp-Math.floor(Date.now()/1000)-10));
      const session=signed || body.credential;
      res.setHeader('Set-Cookie',[
        COOKIE+'=; HttpOnly; Secure; SameSite=Strict; Path=/api/media; Max-Age=0',
        COOKIE+'='+session+'; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age='+life,
        SHARE_COOKIE+'='+(grant?body.shareGrant:'')+'; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age='+(grant?life:0)
      ]);
      authorized.set(identity.sub+':'+identity.email,Date.now()+90000);
      return res.status(200).json({success:true, email:identity.email,expiresAt:identity.exp,scopeRoot:identity.scopeRoot||null,isMember:identity.member===true,role:identity.role});
    } catch (e) { return error(res,e.authFailure?401:e.status===403?403:503,
      e.authFailure?'Không thể xác thực tài khoản: '+e.message:
      'Chưa kiểm tra được quyền Google Drive. Vui lòng thử lại sau: '+e.message); }
  }
  if (req.method !== 'GET') return error(res,405,'Phương thức không hỗ trợ');
  let identity;
  try { identity = await requireAccount(req); }
  catch (e) { return error(res,e.revoked?403:e.authFailure||!cookie(req)?401:
    e.status===401?401:503,
    e.revoked?'Quyền nội bộ đã bị thu hồi. Hãy sử dụng liên kết chia sẻ hợp lệ.':
    (e.authFailure||!cookie(req)?'Cần đăng nhập Google để xem ảnh: ':'Tạm thời không kiểm tra được quyền Google Drive: ')+e.message); }
  if (req.query.status === '1') return res.status(200).json({success:true,email:identity.email,scopeRoot:identity.scopeRoot||null,isMember:identity.member===true,role:identity.role});
  const id = req.query.fileId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,160}$/.test(id))
    return error(res,400,'ID tệp không hợp lệ');
  try {
    let token = await driveToken();
    const base='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id);
    async function fromDrive(url, headers={}) {
      let result=await request(url,{headers:{Authorization:'Bearer '+token,...headers}},20000);
      if (result.status === 401) {
        driveAuth=null; driveAuthUntil=0;
        token=await driveToken();
        result=await request(url,{headers:{Authorization:'Bearer '+token,...headers}},20000);
      }
      return result;
    }
    const metadata=await fromDrive(base+'?supportsAllDrives=true&fields=id,name,size,mimeType,driveId,thumbnailLink,trashed');
    if (!metadata.ok) return error(res,metadata.status===404?404:502,'Không thể đọc tệp trên Drive');
    const info=await metadata.json();
    // Do not allow the Apps Script service token to expose arbitrary Drive
    // files. A signed shared-link session is restricted to the official Shared
    // Drive and its granted subtree. Normal verified members may also read
    // files descended from the exact configured VinhLoc gallery root.
    if(info.trashed)return error(res,404,'Tệp đã ở trong thùng rác');
    if(identity.scopeRoot){
      if(info.driveId!==SHARED_DRIVE_ID ||
         !await scopedPath(id,identity.scopeRoot,token))
        return error(res,403,'Tệp nằm ngoài phạm vi thư mục được chia sẻ');
    }else if(info.driveId!==SHARED_DRIVE_ID &&
      !await inManagedRoot(id,token)){
      return error(res,403,'Tệp không nằm trong kho ảnh Vĩnh Lộc được cấp quyền');
    }
    const mime=String(info.mimeType||'');
    const image=mime.startsWith('image/');
    const video=mime.startsWith('video/');
    if (!image && !video) return error(res,415,'Không hỗ trợ loại tệp này');
    const size=Number(info.size||0);
    if (size > (image?MAX_IMAGE:MAX_VIDEO))
      return error(res,413,'Tệp vượt giới hạn truyền trực tiếp');
    const thumb=req.query.variant==='thumb';
    let content;
    if (thumb && info.thumbnailLink) {
      // Google's thumbnailLink is short-lived and may need authorization.
      const signed=await fromDrive(info.thumbnailLink);
      if (signed.ok && (signed.headers.get('content-type')||'').startsWith('image/'))
        content=signed;
      else await signed.body?.cancel().catch(()=>{});
    }
    if (!content && thumb && video) return error(res,404,'Drive chưa tạo thumbnail video');
    if (!content) {
      const range=String(req.headers.range||'');
      const headers={};
      if (video && /^bytes=\d*-\d*$/.test(range)) headers.Range=range;
      content=await fromDrive(base+'?alt=media&supportsAllDrives=true',headers);
      if (!content.ok) return error(res,502,'Drive không trả nội dung ('+content.status+')');
      if (video && range && content.status !== 206) {
        await content.body?.cancel().catch(()=>{});
        return error(res,502,'Drive không hỗ trợ tải từng đoạn video');
      }
    }
    const contentType=(thumb&&content.headers.get('content-type')?.startsWith('image/'))
      ? content.headers.get('content-type') : mime;
    res.status(content.status===206?206:200);
    res.setHeader('Content-Type',contentType);
    res.setHeader('Content-Disposition',mediaContentDisposition(info.name));
    res.setHeader('Accept-Ranges','bytes');
    for(const name of ['content-length','content-range']) {
      const val=content.headers.get(name);
      if(val) res.setHeader(name,val);
    }
    if (!content.body) return res.end();
    Readable.fromWeb(content.body).on('error',()=>{if(!res.writableEnded)res.end()}).pipe(res);
  } catch (e) {
    if (!res.headersSent) return error(res,502,'Không thể phát ảnh/video: '+e.message);
    res.end();
  }
}
