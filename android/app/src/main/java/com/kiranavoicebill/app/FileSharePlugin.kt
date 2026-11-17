package com.kiranavoicebill.app

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * KB-414 step 2 phone check (owner, 17 Nov 2026): the WebView has no share sheet (navigator.share is undefined) and drops downloads, so
 * the bill's Share / PDF / WhatsApp come here (the web side: src/data/nativeFileShare.ts).
 * - share: the file, written to the app's cache, into Android's share sheet through the app's FileProvider - or straight to one app
 *   (WhatsApp) when asked; that app missing = the share sheet, never an error.
 * - saveToDownloads: the PDF into Downloads through MediaStore (Android 10+, no storage permission); older Android answers saved=false
 *   and the web side opens the share sheet instead.
 */
@CapacitorPlugin(name = "FileShare")
class FileSharePlugin : Plugin() {
    private class Input(val name: String, val mime: String, val bytes: ByteArray)

    private fun input(call: PluginCall): Input? {
        // a name from the page is a file name only, never a path out of the cache folder
        val name = call.getString("name")?.substringAfterLast('/')?.substringAfterLast('\\')?.takeIf { it.isNotBlank() && it != "." && it != ".." }
        val mime = call.getString("mime")?.takeIf { it.isNotBlank() }
        val data = call.getString("data") ?: return null
        val bytes = try { Base64.decode(data, Base64.DEFAULT) } catch (e: IllegalArgumentException) { return null }
        return if (name == null || mime == null) null else Input(name, mime, bytes)
    }

    @PluginMethod
    fun share(call: PluginCall) {
        val file = input(call) ?: return call.reject("Missing file", "BAD_INPUT")
        try {
            val dir = File(context.cacheDir, "shared").apply { mkdirs() }
            val out = File(dir, file.name).apply { writeBytes(file.bytes) }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", out)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = file.mime
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newRawUri(file.name, uri) // the share sheet's preview and the receiving app may read it
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val app = call.getString("app")
            val direct = app?.let { pkg ->
                try {
                    activity.startActivity(Intent(send).setPackage(pkg))
                    true
                } catch (e: ActivityNotFoundException) {
                    false
                }
            } ?: false
            if (!direct) activity.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            call.resolve(JSObject().put("via", if (direct) "app" else "chooser"))
        } catch (e: Exception) {
            call.reject("Could not share", "SHARE_FAILED", e)
        }
    }

    @PluginMethod
    fun saveToDownloads(call: PluginCall) {
        val file = input(call) ?: return call.reject("Missing file", "BAD_INPUT")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return call.resolve(JSObject().put("saved", false))
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, file.mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return call.reject("Could not save", "SAVE_FAILED")
        try {
            resolver.openOutputStream(uri)?.use { it.write(file.bytes) } ?: throw IllegalStateException("no output stream")
        } catch (e: Exception) {
            resolver.delete(uri, null, null) // never a broken, empty file left in Downloads
            return call.reject("Could not save", "SAVE_FAILED", e)
        }
        call.resolve(JSObject().put("saved", true).put("uri", uri.toString()))
    }

    /** KB-414 step 3 phone check: "Open" after a save - the saved file in the phone's own viewer, read granted for it. No viewer: NO_APP. */
    @PluginMethod
    fun open(call: PluginCall) {
        val uri = call.getString("uri")?.takeIf { it.startsWith("content://") } ?: return call.reject("Missing file", "BAD_INPUT")
        val mime = call.getString("mime")?.takeIf { it.isNotBlank() } ?: return call.reject("Missing type", "BAD_INPUT")
        val view = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(Uri.parse(uri), mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            activity.startActivity(view)
            call.resolve()
        } catch (e: ActivityNotFoundException) {
            call.reject("No app can open this file", "NO_APP", e)
        }
    }
}
