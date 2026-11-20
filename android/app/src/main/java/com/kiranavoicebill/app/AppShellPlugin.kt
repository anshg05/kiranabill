package com.kiranavoicebill.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** KB-425 (D123): set once the web app has drawn its first real screen; MainActivity holds the splash until then (at most 5 s). */
object AppShellState {
    @Volatile
    var ready = false
}

/**
 * KB-425 (owner, 20 Nov 2026; D123) - the web side is src/data/appShell.ts.
 * - ready: the first real screen (Home, Sign in, setup) is on screen - the splash may go.
 * - permissionState: microphone / nearby (Bluetooth search; location on Android 11 and older) - granted, and whether Android would still
 *   show its prompt (canAsk). Not granted + cannot ask + asked before = "Don't allow" for good: the app offers Open Settings.
 * - openSettings: this app's own page in Android's Settings.
 * It asks for nothing itself: the mic prompt still comes from the recording, the Bluetooth one from the printer search.
 */
@CapacitorPlugin(name = "AppShell")
class AppShellPlugin : Plugin() {
    @PluginMethod
    fun ready(call: PluginCall) {
        AppShellState.ready = true
        call.resolve()
    }

    private fun permissionsFor(name: String?): Array<String>? = when (name) {
        "microphone" -> arrayOf(Manifest.permission.RECORD_AUDIO)
        "nearby" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        else -> null
    }

    @PluginMethod
    fun permissionState(call: PluginCall) {
        val perms = permissionsFor(call.getString("name")) ?: return call.reject("unknown permission")
        val granted = perms.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
        val canAsk = perms.any { ActivityCompat.shouldShowRequestPermissionRationale(activity, it) }
        call.resolve(JSObject().put("granted", granted).put("canAsk", canAsk))
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }
}
