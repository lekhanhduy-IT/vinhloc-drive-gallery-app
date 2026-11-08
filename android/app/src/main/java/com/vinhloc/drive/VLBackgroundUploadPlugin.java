package com.vinhloc.drive;

import android.app.Activity;
import android.content.Intent;
import android.content.ClipData;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.CookieManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

/** Native picker gives the service durable content URI permissions before JS can be suspended. */
@CapacitorPlugin(name="VLBackgroundUpload")
public class VLBackgroundUploadPlugin extends Plugin {
    @PluginMethod
    public void pickAndUpload(PluginCall call) {
        String origin=call.getString("origin","");
        String owner=call.getString("owner","");
        String folder=call.getString("folderId","");
        String accept=call.getString("accept","image");
        if(!origin.startsWith("https://") || origin.contains("@") ||
            !origin.matches("https://[A-Za-z0-9.-]+(:[0-9]+)?") ||
            !owner.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") ||
            !folder.matches("^[A-Za-z0-9_-]{10,180}$")){
            call.reject("Cấu hình máy chủ/tài khoản/thư mục upload không hợp lệ");
            return;
        }
        Uri active=Uri.parse(getBridge().getWebView().getUrl());
        String currentOrigin=active.getScheme()+"://"+active.getAuthority();
        if(!origin.equals(currentOrigin)){
            call.reject("Upload nền chỉ cho phép API cùng HTTPS origin đã đăng nhập");
            return;
        }
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("video".equals(accept)?"video/*":"image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call,intent,"pickedFiles");
    }

    @ActivityCallback
    private void pickedFiles(PluginCall call,ActivityResult result){
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null){
            call.resolve(new JSObject().put("jobs",new JSArray()));return;
        }
        try {
            Intent resultData=result.getData();
            String origin=call.getString("origin"),owner=call.getString("owner"),folder=call.getString("folderId");
            JSONArray pending=new JSONArray();
            ClipData clips=resultData.getClipData();
            int count=clips!=null?clips.getItemCount():resultData.getData()!=null?1:0;
            for(int i=0;i<count;i++){
                Uri uri=clips!=null?clips.getItemAt(i).getUri():resultData.getData();
                if(uri==null)continue;
                try {getContext().getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}
                catch(SecurityException ignored) {}
                String name="file-"+(i+1),type=getContext().getContentResolver().getType(uri);
                long size=0;
                try(Cursor cursor=getContext().getContentResolver().query(uri,null,null,null,null)){
                    if(cursor!=null && cursor.moveToFirst()){
                        int ni=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        int si=cursor.getColumnIndex(OpenableColumns.SIZE);
                        if(ni>=0)name=cursor.getString(ni);
                        if(si>=0&&!cursor.isNull(si))size=cursor.getLong(si);
                    }
                }
                if(size<=0 || size>5L*1024*1024*1024) continue;
                if(type==null || !(type.startsWith("image/")||type.startsWith("video/"))) continue;
                JSONObject job=new JSONObject();
                job.put("id",UUID.randomUUID().toString());
                job.put("uploadKey",UUID.randomUUID().toString().replace("-",""));
                job.put("uri",uri.toString());
                job.put("origin",origin);
                job.put("owner",owner.toLowerCase(java.util.Locale.ROOT));
                job.put("folderId",folder);
                job.put("name",name);
                job.put("size",size);
                job.put("mimeType",type);
                job.put("status","queued");
                job.put("bytesSent",0);
                pending.put(job);
            }
            if(pending.length()>0){
                UploadStore.append(getContext(),pending);
                VLUploadService.start(getContext());
            }
            JSArray publicJobs=new JSArray();
            for(int i=0;i<pending.length();i++)publicJobs.put(UploadStore.publicJob(pending.getJSONObject(i)));
            call.resolve(new JSObject().put("jobs",publicJobs));
        }catch(Exception error){call.reject("Không lưu được hàng đợi upload: "+error.getMessage());}
    }

    @PluginMethod
    public void getJobs(PluginCall call) {
        try{
            JSONArray all=UploadStore.all(getContext());
            JSArray output=new JSArray();
            for(int i=0;i<all.length();i++)output.put(UploadStore.publicJob(all.getJSONObject(i)));
            // Only the foreground UI may restart a paused Android foreground service.
            if(call.getBoolean("resume",false)){
                boolean work=false;
                for(int i=0;i<all.length();i++){
                    String status=all.getJSONObject(i).optString("status");
                    if("queued".equals(status)||"paused".equals(status)||"auth_required".equals(status)||"retrying".equals(status)||
                       "staging".equals(status)||"uploading".equals(status)){work=true;break;}
                }
                if(work)VLUploadService.start(getContext());
            }
            call.resolve(new JSObject().put("jobs",output));
        }catch(Exception error){call.reject(error.getMessage());}
    }
}