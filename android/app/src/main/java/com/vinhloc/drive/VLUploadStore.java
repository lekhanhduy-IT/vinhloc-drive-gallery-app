package com.vinhloc.drive;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Private, crash-safe queue. Session URLs are capabilities; never store them in backups. */
final class UploadStore {
    private static File path(Context context) { return new File(context.getNoBackupFilesDir(), "vl-upload-queue.json"); }

    static synchronized JSONArray all(Context context) {
        File file=path(context);
        if(!file.isFile()) return new JSONArray();
        try(FileInputStream input=new FileInputStream(file)) {
            byte[] bytes=new byte[(int)Math.min(file.length(), 2_000_000)];
            int length=0, n;
            while(length<bytes.length && (n=input.read(bytes,length,bytes.length-length))>0) length+=n;
            return new JSONArray(new String(bytes,0,length,StandardCharsets.UTF_8));
        }catch(Exception error){ android.util.Log.e("VLUpload","Queue read failed",error); return new JSONArray(); }
    }

    private static void write(Context context,JSONArray records) throws Exception {
        File file=path(context), tmp=new File(file.getParentFile(),"vl-upload-queue.tmp");
        try(FileOutputStream output=new FileOutputStream(tmp)){
            output.write(records.toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        if(!tmp.renameTo(file)) throw new Exception("Cannot save background upload queue");
    }

    static synchronized void append(Context context,JSONArray jobs) throws Exception {
        JSONArray all=all(context);
        for(int i=0;i<jobs.length();i++) all.put(jobs.getJSONObject(i));
        write(context,all);
    }

    static synchronized void patch(Context context,String id,JSONObject values) throws Exception {
        JSONArray all=all(context);
        for(int i=0;i<all.length();i++){
            JSONObject item=all.getJSONObject(i);
            if(!id.equals(item.optString("id")))continue;
            java.util.Iterator<String> keys=values.keys();
            while(keys.hasNext()){String key=keys.next();item.put(key,values.get(key));}
            write(context,all);
            return;
        }
        throw new Exception("Upload job missing: "+id);
    }

    static JSONObject publicJob(JSONObject source) throws Exception {
        JSONObject result=new JSONObject();
        for(String key:new String[]{"id","name","mimeType","size","folderId","uploadKey","owner","status","bytesSent","fileId","error"}){
            if(source.has(key))result.put(key,source.get(key));
        }
        return result;
    }
}