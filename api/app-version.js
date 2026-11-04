// Per-deployment identity from Vercel system environment variables.
const APP_VERSION='3.1.11';
export default function handler(req,res){
  res.setHeader('Cache-Control','private, no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const build=String(process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_URL ||
    'version-3.0.0-first-release');
  return res.status(200).json({version:APP_VERSION,build:build.slice(0,180)});
}
