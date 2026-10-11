#!/usr/bin/env bash
# KB-407 (D75): ONE-TIME key setup for the encrypted backups. Run by the OWNER only, in his own Git Bash window -
# never by the assistant, so the private key never appears in anyone else's output.
#
#   bash scripts/backup/setup-key.sh "H:/My Drive/KiranaBill-Backups"
#   bash scripts/backup/setup-key.sh --reset        # undo a setup that did not finish (never touches a finished one)
#
# What it does, in plain words:
#   1. makes a LOCK-AND-KEY pair. The PUBLIC half (the lock) goes on this laptop: it can lock backups, never open them.
#      The PRIVATE half (the key) is protected by a passphrase YOU choose, saved to ONE file for your password manager,
#      and then deleted from this laptop.
#   2. proves you can open a locked test note with the key and passphrase.
#   3. ONLY THEN writes the settings file (with keyConfirmed: true). The backup refuses to run without that.
# If ANYTHING fails, everything this script made is removed again: the laptop is never left holding a lock whose key
# was not saved and proven. Nothing here is sent anywhere. The passphrase is typed into a gpg window, not this script.
set -euo pipefail

CONF="$(cygpath -u "$APPDATA")/KiranaBillBackup"
PUBHOME="$CONF/gnupg"
# NOT the Desktop (it can be redirected into OneDrive, which would upload the key file) - a local folder, opened for you.
EXPORT_DIR="$(cygpath -u "$LOCALAPPDATA")/KiranaBillBackup/key-export"
KEYFILE="$EXPORT_DIR/KiranaBill-BACKUP-PRIVATE-KEY.asc"

if [ "${1:-}" = "--reset" ]; then
  if [ -f "$CONF/config.json" ]; then
    echo "A finished setup exists ($CONF/config.json). I will NOT remove it - the old backups depend on it."
    exit 1
  fi
  rm -rf "$PUBHOME" "$EXPORT_DIR"
  echo "Reset done: the unfinished lock (public key) and any key-export folder are removed. Now run the setup again."
  exit 0
fi

DRIVE="${1:-}"
if [ -z "$DRIVE" ]; then
  echo 'Usage: bash scripts/backup/setup-key.sh "H:/My Drive/KiranaBill-Backups"'
  exit 2
fi

# ---- preflight: everything that can go wrong is checked BEFORE a key is made
if [ ! -d "$DRIVE" ]; then
  echo "I cannot find the folder: $DRIVE"
  echo "Open it once in File Explorer (is Google Drive for desktop running and signed in?), then run this again."
  exit 1
fi
if [ -f "$CONF/config.json" ]; then
  echo "A backup key is already set up here ($CONF/config.json)."
  echo "Do NOT make a second one - the old backups could not be opened with it. Stop here and ask for help if you need a new key."
  exit 1
fi
if [ -e "$PUBHOME" ]; then
  echo "An unfinished setup left a lock behind ($PUBHOME) whose key was never saved."
  echo "Run:  bash scripts/backup/setup-key.sh --reset    and then run this again."
  exit 1
fi
mkdir -p "$EXPORT_DIR"
if ! ( : > "$EXPORT_DIR/.write-test" ) 2>/dev/null; then
  echo "I cannot write to $EXPORT_DIR - nothing was changed."
  exit 1
fi
rm -f "$EXPORT_DIR/.write-test"
if ! command -v notepad.exe >/dev/null 2>&1; then
  echo "I cannot find Notepad (needed to show you the key file) - nothing was changed."
  exit 1
fi

# Short path on purpose: gpg-agent's socket path has a length limit on Windows.
TMPHOME="$(mktemp -d /tmp/kbkey.XXXXXX)"
chmod 700 "$TMPHOME"
TESTFILE="$TMPHOME/proof.txt"
DONE=0

cleanup() {
  code=$?
  if [ -f "$KEYFILE" ]; then
    # overwrite before deleting (best effort: an SSD may keep old blocks - which is why the file is passphrase-protected)
    head -c "$(stat -c %s "$KEYFILE")" /dev/urandom > "$KEYFILE" 2>/dev/null || true
    rm -f "$KEYFILE"
  fi
  rmdir "$EXPORT_DIR" 2>/dev/null || true
  gpgconf --homedir "$TMPHOME" --kill gpg-agent >/dev/null 2>&1 || true
  rm -rf "$TMPHOME"
  if [ "$DONE" != "1" ]; then
    # never leave a usable, unconfirmed lock behind
    rm -rf "$PUBHOME" "$CONF/config.json"
    echo
    echo "SETUP DID NOT FINISH (exit $code). Everything it made has been removed - the laptop holds no lock and no key."
    echo "Nothing was lost: no backup has been made. Just run the setup again from the start."
  fi
}
trap cleanup EXIT

echo
echo "=============================================================="
echo " STEP 1 of 4 - choose your passphrase"
echo "=============================================================="
echo "A window will open and ask for a passphrase TWICE."
echo " * Pick a long one (4 random words is good). Do not reuse a password from anywhere else."
echo " * Put it in your password manager RIGHT NOW, before you type it here."
echo " * If you lose the passphrase OR the key file, EVERY BACKUP BECOMES UNREADABLE - for good. Nobody can recover it."
echo
read -r -p "Press Enter when the passphrase is saved in your password manager and you are ready... " _

gpg --homedir "$TMPHOME" --quick-generate-key "KiranaBill Backup <backup@kiranabill.invalid>" default default never
FPR="$(gpg --homedir "$TMPHOME" --list-keys --with-colons | awk -F: '/^fpr/{print $10; exit}')"
echo
echo "Key made. Its fingerprint (safe to share): $FPR"

echo
echo "=============================================================="
echo " STEP 2 of 4 - the lock goes on this laptop (not final until step 4)"
echo "=============================================================="
mkdir -p "$PUBHOME"
chmod 700 "$PUBHOME"
gpg --homedir "$TMPHOME" --export "$FPR" | gpg --homedir "$PUBHOME" --batch --import
echo "The public half (the lock) is now in: $PUBHOME"

echo
echo "=============================================================="
echo " STEP 3 of 4 - save the KEY to your password manager"
echo "=============================================================="
echo "A window will ask for your passphrase once more. Then Notepad opens the key file:"
echo "    $(cygpath -w "$KEYFILE")"
gpg --homedir "$TMPHOME" --armor --export-secret-keys "$FPR" > "$KEYFILE"
if ! grep -q "BEGIN PGP PRIVATE KEY BLOCK" "$KEYFILE"; then
  echo "The key file was not written properly - stopping."
  exit 1
fi
notepad.exe "$(cygpath -w "$KEYFILE")" &
echo
echo "NOW: in Notepad press Ctrl+A, then Ctrl+C, and save it in your password manager as a secure note called"
echo "'KiranaBill backup private key'. Keep the passphrase in the password manager too."
echo " * Use a password manager that is NOT the Google account that holds the backups."
echo " * Make sure you could paste it back out of the password manager."
echo
read -r -p "Type SAVED and press Enter once the key is in your password manager: " ANSWER
if [ "$ANSWER" != "SAVED" ]; then
  echo "Not confirmed."
  exit 1
fi

echo
echo "=============================================================="
echo " STEP 4 of 4 - prove it works"
echo "=============================================================="
echo "I will lock a small test note with the lock, then ask for your passphrase to open it with the key."
echo "kiranabill backup key test" > "$TESTFILE"
gpg --homedir "$PUBHOME" --batch --yes --trust-model always --recipient "$FPR" --output "$TESTFILE.gpg" --encrypt "$TESTFILE"
if ! gpg --homedir "$TMPHOME" --decrypt "$TESTFILE.gpg" 2>/dev/null | grep -q "kiranabill backup key test"; then
  echo "I could NOT open the test note with your key and passphrase."
  exit 1
fi
echo "Opened the test note - your passphrase works."

# ONLY now: the settings, marked confirmed (no secret in it: a folder and the public fingerprint)
DRIVE_WIN="$(cygpath -w "$DRIVE")"
PUB_WIN="$(cygpath -w "$PUBHOME")"
node -e '
const fs = require("fs");
const [file, drive, fpr, pub] = process.argv.slice(1);
fs.writeFileSync(file, JSON.stringify({ driveFolder: drive, recipient: fpr, gnupgHome: pub, gpgExe: "C:\\Program Files\\Git\\usr\\bin\\gpg.exe", keyConfirmed: true }, null, 2));
' "$CONF/config.json" "$DRIVE_WIN" "$FPR" "$PUB_WIN"
DONE=1

echo
echo "DONE. The key file and the temporary keyring are now deleted from this laptop (close Notepad without saving)."
echo "Settings written to: $CONF/config.json"
echo "Fingerprint to tell the assistant (it is public): $FPR"
