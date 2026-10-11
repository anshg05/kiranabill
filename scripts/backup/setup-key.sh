#!/usr/bin/env bash
# KB-407 (D75): ONE-TIME key setup for the encrypted backups. Run by the OWNER only, in his own Git Bash window -
# never by the assistant, so the private key never appears in anyone else's output.
#
#   bash scripts/backup/setup-key.sh "H:/My Drive/KiranaBill-Backups"
#
# What it does, in plain words:
#   1. makes a LOCK-AND-KEY pair. The PUBLIC half (the lock) stays on this laptop: it can lock backups but can never
#      open them. The PRIVATE half (the key) is protected by a passphrase YOU choose, saved to ONE file for you to put
#      in your password manager, and then deleted from this laptop.
#   2. proves you can open a locked test file with the key and passphrase BEFORE anything is deleted.
#   3. writes the small settings file the backup reads (where Drive is, which lock to use).
#
# Nothing here is ever sent anywhere. The passphrase is typed into a gpg window, not into this script.
set -euo pipefail

DRIVE="${1:-}"
if [ -z "$DRIVE" ]; then
  echo 'Usage: bash scripts/backup/setup-key.sh "H:/My Drive/KiranaBill-Backups"'
  exit 2
fi
if [ ! -d "$DRIVE" ]; then
  echo "I cannot find the folder: $DRIVE"
  echo "Open it once in File Explorer (is Google Drive for desktop running and signed in?), then run this again."
  exit 1
fi

CONF="$(cygpath -u "$APPDATA")/KiranaBillBackup"
PUBHOME="$CONF/gnupg"
if [ -f "$CONF/config.json" ]; then
  echo "A backup key is already set up here ($CONF/config.json)."
  echo "Do NOT make a second one - the old backups could not be opened with it. Stop here and ask for help if you need a new key."
  exit 1
fi

# Short path on purpose: gpg-agent's socket path has a length limit on Windows.
TMPHOME="$(mktemp -d /tmp/kbkey.XXXXXX)"
chmod 700 "$TMPHOME"
KEYFILE="$(cygpath -u "$USERPROFILE")/Desktop/KiranaBill-BACKUP-PRIVATE-KEY.asc"
TESTFILE="$TMPHOME/proof.txt"

cleanup() {
  # Overwrite the exported private key before deleting it (best effort: an SSD may keep old blocks - which is why the
  # file is passphrase-protected in the first place).
  if [ -f "$KEYFILE" ] && [ "${KEEP_KEYFILE:-0}" != "1" ]; then
    head -c "$(stat -c %s "$KEYFILE")" /dev/urandom > "$KEYFILE" 2>/dev/null || true
    rm -f "$KEYFILE"
  fi
  gpgconf --homedir "$TMPHOME" --kill gpg-agent >/dev/null 2>&1 || true
  rm -rf "$TMPHOME"
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
echo " STEP 2 of 4 - the lock stays on this laptop"
echo "=============================================================="
mkdir -p "$PUBHOME"
chmod 700 "$PUBHOME"
gpg --homedir "$TMPHOME" --export "$FPR" | gpg --homedir "$PUBHOME" --batch --import
echo "The public half (the lock) is now in: $PUBHOME"

echo
echo "=============================================================="
echo " STEP 3 of 4 - save the KEY to your password manager"
echo "=============================================================="
echo "A window will ask for your passphrase once more, then a file appears on your Desktop:"
echo "    $KEYFILE"
gpg --homedir "$TMPHOME" --armor --export-secret-keys "$FPR" > "$KEYFILE"
echo
echo "NOW: open that file in Notepad, copy ALL of it, and save it in your password manager as a secure note"
echo "(name it 'KiranaBill backup private key'). Keep the passphrase in the password manager too."
echo " * Use a password manager that is NOT the Google account that holds the backups."
echo " * The file is protected by your passphrase, but treat it like a house key."
echo
read -r -p "Type SAVED and press Enter once the key is in your password manager and you could paste it back out: " ANSWER
if [ "$ANSWER" != "SAVED" ]; then
  echo "Not confirmed - I am keeping the Desktop file so you do not lose the key. Save it, then delete it yourself."
  KEEP_KEYFILE=1
  exit 1
fi

echo
echo "=============================================================="
echo " STEP 4 of 4 - prove it works, then clean up"
echo "=============================================================="
echo "I will lock a small test note with the lock, then ask you to open it with your passphrase."
echo "kiranabill backup key test" > "$TESTFILE"
gpg --homedir "$PUBHOME" --batch --yes --trust-model always --recipient "$FPR" --output "$TESTFILE.gpg" --encrypt "$TESTFILE"
if ! gpg --homedir "$TMPHOME" --decrypt "$TESTFILE.gpg" 2>/dev/null | grep -q "kiranabill backup key test"; then
  echo "I could NOT open the test note with your key and passphrase. Nothing was deleted from the Desktop - do not continue."
  KEEP_KEYFILE=1
  exit 1
fi
echo "Opened the test note - your passphrase works."

# the settings the backup reads (no secret in it: a folder and the public fingerprint)
DRIVE_WIN="$(cygpath -w "$DRIVE")"
PUB_WIN="$(cygpath -w "$PUBHOME")"
node -e '
const fs = require("fs");
const [file, drive, fpr, pub] = process.argv.slice(1);
fs.writeFileSync(file, JSON.stringify({ driveFolder: drive, recipient: fpr, gnupgHome: pub, gpgExe: "C:\\Program Files\\Git\\usr\\bin\\gpg.exe" }, null, 2));
' "$CONF/config.json" "$DRIVE_WIN" "$FPR" "$PUB_WIN"

echo
echo "DONE. The Desktop key file and the temporary keyring will now be deleted from this laptop."
echo "Settings written to: $CONF/config.json"
echo "Fingerprint to tell the assistant (it is public): $FPR"
