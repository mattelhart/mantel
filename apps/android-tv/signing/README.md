# Debug signing key

`mantel-debug.keystore` signs every TV and phone APK this repo builds, debug and release. The alias is `manteldebug`. The store password and key password are both `mantel-debug`.

It is committed on purpose. A cloud build and a laptop otherwise each invent a key under `~/.android/debug.keystore`, and Android then refuses to install the new APK over the old one (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). That uninstall wipes the saved server address and the pairing token.

This key is not a secret. Anyone with the repo can sign an APK the TV will accept as an update. That is acceptable for a family app that is sideloaded at home, and it is the wrong key for a Play Store listing. Do not reuse it for anything public.

The first install of an APK signed with this key, over an app that was signed with a machine-local debug key, still needs one uninstall. Every install after that can be `adb install -r`.
