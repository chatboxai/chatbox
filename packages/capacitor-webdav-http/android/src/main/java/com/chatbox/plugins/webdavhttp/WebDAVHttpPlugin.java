package com.chatbox.plugins.webdavhttp;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.Response;
import okhttp3.ResponseBody;

@CapacitorPlugin(name = "WebDAVHttp")
public class WebDAVHttpPlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final WebDAVHttpTransport transport = new WebDAVHttpTransport();

    @PluginMethod
    public void request(PluginCall call) {
        String baseUrl = call.getString("baseUrl");
        String url = call.getString("url");
        String method = call.getString("method");
        JSObject headerObject = call.getObject("headers", new JSObject());
        String body = call.getString("body");
        if (baseUrl == null || url == null || method == null) {
            call.reject("baseUrl, url, and method are required");
            return;
        }

        Map<String, String> headers = new HashMap<>();
        Iterator<String> keys = headerObject.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = headerObject.getString(key);
            if (value == null) {
                call.reject("WebDAV header values must be strings");
                return;
            }
            headers.put(key, value);
        }

        executor.execute(() -> {
            try (Response response = transport.execute(baseUrl, url, method, headers, body)) {
                JSObject result = new JSObject();
                JSObject responseHeaders = new JSObject();
                for (String name : response.headers().names()) {
                    responseHeaders.put(name, response.header(name, ""));
                }
                ResponseBody responseBody = response.body();
                result.put("status", response.code());
                result.put("headers", responseHeaders);
                result.put("body", responseBody == null ? "" : responseBody.string());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "WebDAV request failed" : error.getMessage(), error);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
