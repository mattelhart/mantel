package dev.mantel.calendar.tv.store

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.store by preferencesDataStore("mantel_tv")

data class SavedConnection(val origin: String?, val token: String?)

/**
 * The server address is not a secret. The device token is: an AES key that
 * never leaves the Android Keystore encrypts it before it is written to DataStore.
 */
class SecureTokenStore(private val context: Context) {
    suspend fun read(): SavedConnection {
        val prefs = context.store.data.first()
        val token = prefs[TOKEN]?.let { runCatching { decrypt(it) }.getOrNull() }
        return SavedConnection(prefs[ORIGIN], token)
    }

    suspend fun saveOrigin(origin: String) {
        context.store.edit { it[ORIGIN] = origin }
    }

    suspend fun saveToken(token: String?) {
        context.store.edit { prefs ->
            if (token.isNullOrBlank()) prefs.remove(TOKEN) else prefs[TOKEN] = encrypt(token)
        }
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val body = Base64.encodeToString(cipher.doFinal(plain.toByteArray()), Base64.NO_WRAP)
        return "$iv:$body"
    }

    private fun decrypt(stored: String): String {
        val (iv, body) = stored.split(":", limit = 2)
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(
            Cipher.DECRYPT_MODE,
            key(),
            GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
        )
        return String(cipher.doFinal(Base64.decode(body, Base64.NO_WRAP)))
    }

    private fun key(): SecretKey {
        val keystore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keystore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ALIAS = "mantel_device_token"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val TRANSFORM = "AES/GCM/NoPadding"
        val ORIGIN = stringPreferencesKey("origin")
        val TOKEN = stringPreferencesKey("token")
    }
}
