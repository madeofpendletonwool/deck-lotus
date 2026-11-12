package com.collinpendleton.decklotus.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class Account(
    val serverUrl: String,
    val username: String,
    val accessToken: String,
    val refreshToken: String,
)

/**
 * Where the signed-in account lives. Tokens are encrypted with an AES key
 * that never leaves the Android Keystore, so a copy of the app's files
 * isn't a copy of the login.
 */
class AuthStore(context: Context) {
    private val prefs = context.getSharedPreferences("auth", Context.MODE_PRIVATE)

    @Volatile private var cached: Account? = load()

    val account: Account? get() = cached

    /** Kept after sign-out so the login form is pre-filled. */
    val lastServer: String get() = prefs.getString(KEY_SERVER, null) ?: DEFAULT_SERVER
    val lastUsername: String get() = prefs.getString(KEY_USER, null).orEmpty()

    fun save(a: Account) {
        prefs.edit()
            .putString(KEY_SERVER, a.serverUrl)
            .putString(KEY_USER, a.username)
            .putString(KEY_ACCESS, encrypt(a.accessToken))
            .putString(KEY_REFRESH, encrypt(a.refreshToken))
            .apply()
        cached = a
    }

    fun updateTokens(access: String, refresh: String) {
        val a = cached ?: return
        save(a.copy(accessToken = access, refreshToken = refresh))
    }

    fun clear() {
        prefs.edit().remove(KEY_ACCESS).remove(KEY_REFRESH).apply()
        cached = null
    }

    private fun load(): Account? = try {
        val server = prefs.getString(KEY_SERVER, null)
        val user = prefs.getString(KEY_USER, null)
        val access = prefs.getString(KEY_ACCESS, null)?.let(::decrypt)
        val refresh = prefs.getString(KEY_REFRESH, null)?.let(::decrypt)
        if (server != null && user != null && access != null && refresh != null) Account(server, user, access, refresh) else null
    } catch (_: Exception) {
        // Key lost (e.g. restored onto a new phone): sign in again.
        null
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(plain.toByteArray())
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String {
        val raw = Base64.decode(stored, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12))
        return String(c.doFinal(raw, 12, raw.size - 12))
    }

    companion object {
        const val DEFAULT_SERVER = "https://mtg.collinpendleton.com"
        private const val KEY_ALIAS = "deck-lotus-auth"
        private const val KEY_SERVER = "server"
        private const val KEY_USER = "username"
        private const val KEY_ACCESS = "access"
        private const val KEY_REFRESH = "refresh"
    }
}
