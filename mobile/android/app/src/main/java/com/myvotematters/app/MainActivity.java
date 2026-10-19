package com.myvotematters.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {

    private String shim = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try (InputStream in = getAssets().open("mvm-shim.js")) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
            shim = buf.toString(StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {}

        WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(new NativeBridge(), "MVMNative");
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                view.evaluateJavascript(shim, null);
            }
        });
    }

    /** Called from mvm-shim.js for the web app's Print and download buttons. */
    private class NativeBridge {
        @JavascriptInterface
        public void print() {
            runOnUiThread(() -> {
                WebView webView = getBridge().getWebView();
                PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                printManager.print("MyVoteMatters", webView.createPrintDocumentAdapter("MyVoteMatters"), null);
            });
        }

        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            try {
                File dir = new File(getCacheDir(), "shared");
                dir.mkdirs();
                File file = new File(dir, name.replaceAll("[^A-Za-z0-9._-]", "_"));
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(Base64.decode(base64, Base64.DEFAULT));
                }
                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
                Intent send = new Intent(Intent.ACTION_SEND)
                    .setType(mime)
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(send, "Save or share " + file.getName())));
            } catch (Exception ignored) {}
        }
    }
}
