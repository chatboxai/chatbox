# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Keep Retrofit and Gson classes
-keepattributes Signature
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keep class com.google.gson.** { *; }
-keep class xyz.chatboxapp.ce.network.** { *; }
-keep class xyz.chatboxapp.ce.data.model.** { *; }

# Keep AI model classes
-keep class xyz.chatboxapp.ce.data.model.AIModel { *; }
-keep class xyz.chatboxapp.ce.data.model.ChatMessage { *; }

# Keep network response classes
-keep class xyz.chatboxapp.ce.network.ModelsResponse { *; }
-keep class xyz.chatboxapp.ce.network.ModelData { *; }
-keep class xyz.chatboxapp.ce.network.ChatResponse { *; }

# Keep OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**