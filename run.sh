#!/bin/bash

echo "[*] Menunggu sub-proses UnityKillsMe..."

# Loop terus-menerus sampai PID ditemukan
while true; do
  PID=$(adb shell ps -A | grep ":UnityKillsMe" | awk '{print $2}')

  if [ ! -z "$PID" ]; then
    echo "[+] Menemukan UnityKillsMe dengan PID: $PID"
    break
  fi

  # Jeda 1 detik sebelum mengecek kembali agar tidak membebani CPU
  sleep 1
done

echo "[*] Menjalankan Frida..."
# Menjalankan Frida menggunakan PID yang ditemukan
frida -U -p $PID -l trace.js
