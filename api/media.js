import { createPublicKey, createHmac, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { Readable } from 'node:stream';

// A first-party media gateway: Google ID token -> Shared Drive membership ->
// Drive API with the app service token. No public Drive permissions, no URL tokens.
const CLIENT_ID = '1034177686409-1fhm0m0tqmf58qjj1p0r2ifo018eh8o2.apps.googleusercontent.com';
const SHARED_DRIVE_ID = '0AMLRHzF05fTFUk9PVA';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx3xI-bNWfeffsEH-iIc0yYfF9bHYvAiKZKWIfco6j7Z7GOtOAv7Q8WE1_y9xjen7c/exec';
const COOKIE = 'vl_verified_media';
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
    sub:identity.sub,email:identity.email,exp:Math.min(identity.exp,Math.floor(Date.now()/1000)+3300)
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

function cookie(req) {
  const raw = String(req.headers.cookie || '').split(';').map(x=>x.trim());
  const item = raw.find(x=>x.startsWith(COOKIE+'='));
  return item ? item.slice(COOKIE.length + 1) : '';
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
  const sealed=readSignedSession(stored);
  if (sealed) return sealed;
  const identity = await verifyGoogleIdToken(stored);
  const cacheKey = identity.sub + ':' + identity.email;
  if ((authorized.get(cacheKey) || 0) < Date.now()) {
    // Only email extracted from a verified, Google-signed ID token is checked.
    await callScript('verifyUser', {email:identity.email});
    if (authorized.size > 300) authorized.clear();
    authorized.set(cacheKey, Date.now() + 90000);
  }
  return identity;
}
async function driveToken() {
  if (driveAuth && Date.now() < driveAuthUntil) return driveAuth;
  const result = await callScript('getToken');
  if (!result.token) throw new Error('Không nhận được quyền Drive');
  driveAuth = result.token; driveAuthUntil = Date.now() + 60000;
  return driveAuth;
}
function filenameSafe(s) { return String(s||'file').replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,120); }
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
    try {
      const identity = await verifyGoogleIdToken(body.credential);
      await callScript('verifyUser',{email:identity.email});
      const life = Math.min(3300, Math.max(1,identity.exp - Math.floor(Date.now()/1000) - 10));
      const session=sealSession(identity) || body.credential;
      res.setHeader('Set-Cookie',[
        COOKIE+'=; HttpOnly; Secure; SameSite=Strict; Path=/api/media; Max-Age=0',
        COOKIE+'='+session+'; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age='+life
      ]);
      authorized.set(identity.sub+':'+identity.email,Date.now()+90000);
      return res.status(200).json({success:true, email:identity.email,expiresAt:identity.exp});
    } catch (e) { return error(res,401,'Không thể xác thực tài khoản: '+e.message); }
  }
  if (req.method !== 'GET') return error(res,405,'Phương thức không hỗ trợ');
  let identity;
  try { identity = await requireAccount(req); }
  catch (e) { return error(res,401,'Cần đăng nhập lại Google để xem ảnh: '+e.message); }
  if (req.query.status === '1') return res.status(200).json({success:true,email:identity.email});
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
    // Never let the Apps Script owner's OAuth token access unrelated My Drive files.
    if (info.driveId !== SHARED_DRIVE_ID || info.trashed)
      return error(res,403,'Tệp không thuộc Shared Drive của QL Ảnh');
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
    res.setHeader('Content-Disposition','inline; filename="'+filenameSafe(info.name)+'"');
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
