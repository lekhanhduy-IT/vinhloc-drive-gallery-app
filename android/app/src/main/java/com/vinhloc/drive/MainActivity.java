package com.vinhloc.drive;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(VLBackgroundUploadPlugin.class);
        super.onCreate(state);
    }
}
