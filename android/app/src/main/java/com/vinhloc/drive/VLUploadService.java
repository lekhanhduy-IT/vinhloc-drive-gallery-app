package com.vinhloc.drive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Foreground dataSync service: runs without the WebView/JS event loop. */
public class VLUploadService extends Service {
    private static final String CHANNEL="vl_upload_background";
    private static final int NOTIFICATION=5317;
    private static final int CHUNK=5*1024*1024;
    private static final String DRIVE_PREFIX="https://www.googleapis.com/";
    private ExecutorService executor;
    private boolean draining;

    static void start(Context context){
        Intent intent=new Intent(context,VLUploadService.class);
        ContextCompat.startForegroundService(context,intent);
    }

    @Override public void onCreate(){
        super.onCreate();
        NotificationManager manager=getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel(CHANNEL,
            "Tải ảnh và video lên Drive",NotificationManager.IMPORTANCE_LOW));
        executor=Executors.newSingleThreadExecutor();
    }

    private void notifyProgress(String text,int percent){
        Notification n=new NotificationCompat.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Vĩnh Lộc Drive · Upload nền")
            .setContentText(text).setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100,Math.min(100,Math.max(0,percent)),false).build();
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION,n);
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        Notification notification=new NotificationCompat.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Vĩnh Lộc Drive").setContentText("Đang chuẩn bị upload nền")
            .setOngoing(true).build();
        if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notification,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NOTIFICATION,notification);
        synchronized(this){
            if(!draining){
                draining=true;
                executor.execute(()->{
                    try{drain();}finally{
                        synchronized(VLUploadService.this){draining=false;}
                        stopForeground(STOP_FOREGROUND_REMOVE);
                        stopSelf();
                    }
                });
            }
        }
        return START_REDELIVER_INTENT;
    }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){if(executor!=null)executor.shutdownNow();super.onDestroy();}
    @Override public void onTimeout(int startId,int fgsType){
        stopSelf(startId); // Android 15 6-hour dataSync budget
    }

    private static JSONObject fields(Object...pairs) throws Exception{
        JSONObject result=new JSONObject();
        for(int i=0;i<pairs.length;i+=2)result.put((String)pairs[i],pairs[i+1]);
        return result;
    }
    private void update(JSONObject job,Object...values)throws Exception{
        JSONObject patch=fields(values);
        UploadStore.patch(this,job.getString("id"),patch);
        // Keep the active in-memory object synchronized for retries in this service instance.
        java.util.Iterator<String> keys=patch.keys();
        while(keys.hasNext()){String key=keys.next();job.put(key,patch.get(key));}
    }
    private void drain(){
        JSONArray all=UploadStore.all(this);
        // Mint resumable sessions for the whole selected batch while the user's
        // authenticated cookie is still fresh. Subsequent Drive PUTs need no cookie.
        prepareSessions(all);
        for(int i=0;i<all.length()&&!Thread.currentThread().isInterrupted();i++){
            JSONObject job=all.optJSONObject(i);
            if(job==null)continue;
            String state=job.optString("status");
            if("complete".equals(state)||"failed".equals(state))continue;
            int attempts=0;
            while(attempts<5&&!Thread.currentThread().isInterrupted()){
                try {
                    upload(job);
                    break;
                }catch(Exception error){
                    attempts++;
                    String message=String.valueOf(error.getMessage());
                    if(message.contains("SESSION_EXPIRED")){
                        // Verify the key before creating a replacement session.
                        try{update(job,"session","","bytesSent",0);}catch(Exception ignored){}
                        job.remove("session");
                    }
                    try{update(job,"status",message.contains("AUTH_REQUIRED")?"auth_required":attempts>=5?"paused":"retrying","error",message);}
                    catch(Exception ignored){}
                    if(message.contains("AUTH_REQUIRED")||attempts>=5)break;
                    try{Thread.sleep(Math.min(30_000,2000L<<attempts));}
                    catch(InterruptedException e){Thread.currentThread().interrupt();break;}
                }
            }
        }
    }

    private void prepareSessions(JSONArray jobs){
        for(int i=0;i<jobs.length()&&!Thread.currentThread().isInterrupted();i++){
            JSONObject job=jobs.optJSONObject(i);
            if(job==null || "complete".equals(job.optString("status")) ||
               "failed".equals(job.optString("status")) ||
               job.optString("session").startsWith(DRIVE_PREFIX))continue;
            try {
                JSONObject created=api(job,"startUpload",fields(
                    "folderId",job.getString("folderId"),"name",job.getString("name"),
                    "mimeType",job.getString("mimeType"),"size",job.getLong("size"),
                    "uploadKey",job.getString("uploadKey"),"expectedOwner",job.getString("owner")));
                String session=created.getString("uploadUrl");
                if(!session.startsWith(DRIVE_PREFIX))throw new Exception("Địa chỉ phiên Google Drive không hợp lệ");
                update(job,"session",session,"bytesSent",0,"status","queued","error","");
            }catch(Exception error){
                try{update(job,"error",String.valueOf(error.getMessage()));}
                catch(Exception ignored){}
                // Existing prepared sessions are still transferable even if
                // a later startUpload request requires fresh authentication.
            }
        }
    }

    private static HttpURLConnection connection(String url,String method)throws Exception{
        URL parsed=new URL(url);
        if(!"https".equals(parsed.getProtocol()))throw new Exception("HTTPS required");
        HttpURLConnection conn=(HttpURLConnection)parsed.openConnection();
        conn.setRequestMethod(method);
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(20_000);
        conn.setReadTimeout(60_000);
        conn.setUseCaches(false);
        return conn;
    }
    private static String readResponse(HttpURLConnection conn)throws Exception{
        InputStream input=conn.getResponseCode()<400?conn.getInputStream():conn.getErrorStream();
        if(input==null)return "";
        try(InputStream src=input){
            byte[] buffer=new byte[8192];int n;java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
            while((n=src.read(buffer))!=-1&&out.size()<200_000)out.write(buffer,0,n);
            return out.toString("UTF-8");
        }
    }
    private JSONObject api(JSONObject job,String action,JSONObject data)throws Exception{
        String origin=job.getString("origin");
        String cookie=CookieManager.getInstance().getCookie(origin);
        if(cookie==null||cookie.isEmpty())throw new Exception("AUTH_REQUIRED: Mở app và đăng nhập lại");
        HttpURLConnection conn=connection(origin+"/api/owned-files","POST");
        try{
            conn.setRequestProperty("Cookie",cookie);
            conn.setRequestProperty("Content-Type","application/json; charset=utf-8");
            conn.setDoOutput(true);
            data.put("action",action);
            byte[] body=data.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(body.length);
            try(OutputStream out=conn.getOutputStream()){out.write(body);}
            int code=conn.getResponseCode();
            if(code==401||code==403)throw new Exception("AUTH_REQUIRED: Phiên tài khoản hết hạn hoặc mất quyền");
            String response=readResponse(conn);
            if(code>=400)throw new Exception("API "+code+" "+response.substring(0,Math.min(response.length(),140)));
            JSONObject result=new JSONObject(response);
            if(!result.optBoolean("success"))throw new Exception(result.optString("message","Drive API failed"));
            return result;
        }finally{conn.disconnect();}
    }

    private File staged(JSONObject job)throws Exception{
        File folder=new File(getNoBackupFilesDir(),"vl-upload-data");
        if(!folder.exists()&&!folder.mkdirs())throw new Exception("Cannot create upload staging directory");
        File file=new File(folder,job.getString("id")+".bin");
        if(file.exists()&&file.length()==job.getLong("size"))return file;
        File tmp=new File(folder,job.getString("id")+".tmp");
        try(InputStream source=getContentResolver().openInputStream(android.net.Uri.parse(job.getString("uri")));
            FileOutputStream target=new FileOutputStream(tmp)){
            if(source==null)throw new Exception("Không đọc được ảnh/video gốc");
            byte[] buffer=new byte[256*1024];int n;
            while((n=source.read(buffer))!=-1){
                if(Thread.currentThread().isInterrupted())throw new Exception("Bị hệ thống tạm dừng");
                target.write(buffer,0,n);
            }
            target.getFD().sync();
        }
        if(tmp.length()!=job.getLong("size"))throw new Exception("Dữ liệu file chưa sao chép đủ");
        if(!tmp.renameTo(file))throw new Exception("Không lưu được file trung gian");
        update(job,"staged",file.getAbsolutePath());
        return file;
    }

    private void upload(JSONObject job)throws Exception{
        String id=job.getString("id");
        update(job,"status","staging","error","");
        notifyProgress(job.optString("name"),0);
        File file=staged(job);
        String key=job.getString("uploadKey"),folder=job.getString("folderId");
        String session=job.optString("session");
        if(!session.startsWith(DRIVE_PREFIX)){
            // No live session: first check if Drive already committed this key.
            JSONObject completed=api(job,"confirmUpload",fields("folderId",folder,"uploadKey",key));
            if(completed.optBoolean("found")&&completed.optJSONObject("file")!=null){
                finish(job,completed.getJSONObject("file").getString("id"),file);
                return;
            }
            JSONObject response=api(job,"startUpload",fields("folderId",folder,"name",job.getString("name"),
                "mimeType",job.getString("mimeType"),"size",job.getLong("size"),
                "uploadKey",key,"expectedOwner",job.getString("owner")));
            session=response.getString("uploadUrl");
            if(!session.startsWith(DRIVE_PREFIX))throw new Exception("Drive upload URL invalid");
            update(job,"session",session,"bytesSent",0,"status","uploading");
        }
        long total=job.getLong("size"),offset=queryOffset(session,total);
        if(offset<0){
            JSONObject verify=api(job,"confirmUpload",fields("folderId",folder,"uploadKey",key));
            if(verify.optBoolean("found")){finish(job,verify.getJSONObject("file").getString("id"),file);return;}
            throw new Exception("Drive chưa xác nhận kết quả");
        }
        try(RandomAccessFile data=new RandomAccessFile(file,"r")){
            while(offset<total&&!Thread.currentThread().isInterrupted()){
                int bytes=(int)Math.min(CHUNK,total-offset);
                HttpURLConnection conn=connection(session,"PUT");
                try{
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type",job.getString("mimeType"));
                    conn.setRequestProperty("Content-Range","bytes "+offset+"-"+(offset+bytes-1)+"/"+total);
                    conn.setFixedLengthStreamingMode(bytes);
                    data.seek(offset);
                    try(OutputStream out=conn.getOutputStream()){
                        byte[] buffer=new byte[128*1024];int remaining=bytes;
                        while(remaining>0){
                            int read=data.read(buffer,0,Math.min(buffer.length,remaining));
                            if(read<0)throw new Exception("File source ended early");
                            out.write(buffer,0,read);remaining-=read;
                        }
                    }
                    int status=conn.getResponseCode();
                    if(status==200||status==201){
                        String response=readResponse(conn);
                        String fileId=new JSONObject(response).optString("id");
                        if(fileId.isEmpty())throw new Exception("Drive chưa trả ID file");
                        finish(job,fileId,file);
                        return;
                    }
                    if(status!=308)throw new Exception("Drive PUT HTTP "+status);
                    offset=parseOffset(conn.getHeaderField("Range"));
                    if(offset>total)throw new Exception("Drive offset exceeded file size");
                    update(job,"bytesSent",offset,"status","uploading");
                    notifyProgress(job.optString("name"),(int)(offset*100/total));
                }finally{conn.disconnect();}
            }
        }
        if(Thread.currentThread().isInterrupted())throw new Exception("Bị hệ thống tạm dừng");
        throw new Exception("Drive chưa xác nhận file đã hoàn tất");
    }
    /** 308 Range query is essential after a network error or process restart. */
    private long queryOffset(String session,long total)throws Exception{
        HttpURLConnection conn=connection(session,"PUT");
        try{
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Range","bytes */"+total);
            conn.setFixedLengthStreamingMode(0);
            int status=conn.getResponseCode();
            if(status==308)return parseOffset(conn.getHeaderField("Range"));
            if(status==200||status==201)return -1;
            if(status==404||status==410)throw new Exception("SESSION_EXPIRED: Phiên Drive hết hạn");
            throw new Exception("Drive chưa xác nhận trạng thái "+status);
        }finally{conn.disconnect();}
    }
    private static long parseOffset(String range)throws Exception{
        if(range==null||range.isEmpty())return 0;
        java.util.regex.Matcher match=java.util.regex.Pattern.compile("bytes=0-(\\d+)").matcher(range);
        if(!match.matches())throw new Exception("Drive Range không hợp lệ");
        return Long.parseLong(match.group(1))+1;
    }
    private void finish(JSONObject job,String driveFileId,File file)throws Exception{
        // Server validates parent, unique key AND the original authenticated uploader.
        api(job,"inspectUpload",fields("id",driveFileId,"folderId",job.getString("folderId"),
            "uploadKey",job.getString("uploadKey")));
        update(job,"status","complete","bytesSent",job.getLong("size"),"fileId",driveFileId,
            "session","","error","","staged","");
        if(file!=null)file.delete();
        notifyProgress("Đã lưu "+job.getString("name"),100);
    }
}