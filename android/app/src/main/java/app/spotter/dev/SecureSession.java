package app.spotter.dev;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The Android half of secure session storage: AES-256-GCM under a key that
 * never leaves the Android Keystore, with the ciphertext parked in an ordinary
 * private SharedPreferences file.
 *
 * Not EncryptedSharedPreferences. Jetpack Security's crypto library was
 * deprecated in 1.1.0 with no further releases planned, and Google's own
 * guidance is now a Keystore key plus a storage layer of your choosing — which
 * is all that class ever was. Doing it here directly also costs the project
 * nothing: every class below is in the platform, so no new Gradle dependency
 * has to be resolved to build the app.
 *
 * The key is generated with the defaults that matter: randomised encryption, so
 * each write gets a fresh IV, and no user-authentication requirement, so the
 * token can be refreshed while the phone is in a pocket. Keystore material is
 * bound to this device and this app — it is not in any backup, and uninstall
 * takes it with the app, which is the Android equivalent of the iOS
 * AfterFirstUnlockThisDeviceOnly item.
 */
@CapacitorPlugin(name = "SecureSession")
public class SecureSession extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "app.spotter.session";
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final String FILE = "spotter_secure_session";
    private static final int TAG_BITS = 128;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        KeyStore.Entry entry = store.getEntry(ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }

    // iv:ciphertext, both base64, no wrapping. GCM needs the IV in the clear and
    // authenticates the ciphertext, so a tampered value fails to decrypt rather
    // than decrypting to something attacker-chosen.
    private String seal(String value) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORM);
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] sealed = cipher.doFinal(value.getBytes("UTF-8"));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP);
    }

    private String open(String stored) throws Exception {
        int split = stored.indexOf(':');
        if (split <= 0) throw new IllegalArgumentException("malformed");
        Cipher cipher = Cipher.getInstance(TRANSFORM);
        cipher.init(Cipher.DECRYPT_MODE, key(),
                new GCMParameterSpec(TAG_BITS, Base64.decode(stored.substring(0, split), Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(stored.substring(split + 1), Base64.NO_WRAP)), "UTF-8");
    }

    private void fail(PluginCall call) {
        // Never the key, never the exception: a stack trace from here would name
        // the storage key and the cipher state in a log anyone can read.
        call.reject("Secure sign-in storage is unavailable. Restart Spotter and try again.");
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key", "");
        if (key.isEmpty()) { fail(call); return; }
        String stored = prefs().getString(key, null);
        if (stored == null) { call.resolve(new JSObject()); return; }
        try {
            call.resolve(new JSObject().put("value", open(stored)));
        } catch (Exception failure) {
            // The Keystore key is gone or the blob no longer verifies — a wiped
            // keystore, a restore, a half-written value. There is no session to
            // recover, so drop the wreckage and answer "nothing here"; the page
            // then shows the sign-in screen instead of an error it cannot act on.
            prefs().edit().remove(key).apply();
            call.resolve(new JSObject());
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key", "");
        String value = call.getString("value");
        if (key.isEmpty() || value == null) { fail(call); return; }
        try {
            prefs().edit().putString(key, seal(value)).apply();
            call.resolve();
        } catch (Exception failure) { fail(call); }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key", "");
        if (key.isEmpty()) { fail(call); return; }
        prefs().edit().remove(key).apply();
        call.resolve();
    }

    @PluginMethod
    public void keys(PluginCall call) {
        List<String> held = new ArrayList<>(prefs().getAll().keySet());
        call.resolve(new JSObject().put("keys", new JSArray(held)));
    }
}
