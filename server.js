const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const frida = require('frida');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let session = null;
let script = null;

io.on('connection', (socket) => {
    console.log('Client connected');

    socket.on('start-hook', async (data) => {
        const { targetClass, mode } = data;
        try {
            socket.emit('log', { type: 'system', message: `[*] Menghubungkan ke perangkat USB...` });
            const device = await frida.getUsbDevice();
            
            socket.emit('log', { type: 'system', message: `[*] Mencari proses MLBB...` });
            // Kita bisa mencari berdasarkan package name atau pattern seperti di run.sh
            const processes = await device.enumerateProcesses();
            const targetProcess = processes.find(p => p.name.includes('UnityKillsMe') || p.name === 'com.mobile.legends');
            
            if (!targetProcess) {
                socket.emit('log', { type: 'danger', message: `[!] Proses tidak ditemukan. Pastikan game sudah terbuka.` });
                return;
            }

            socket.emit('log', { type: 'system', message: `[+] Menempel ke PID: ${targetProcess.pid}` });
            session = await device.attach(targetProcess.pid);
            
            const source = fs.readFileSync(path.join(__dirname, 'trace.js'), 'utf8');
            script = await session.createScript(source);

            script.message.connect((message, data) => {
                if (message.type === 'send') {
                    socket.emit('log', message.payload);
                } else if (message.type === 'error') {
                    socket.emit('log', { type: 'danger', message: `[Frida Error] ${message.stack}` });
                }
            });

            await script.load();
            socket.emit('log', { type: 'system', message: `[+] Script berhasil di-inject!` });

            // Panggil fungsi di Frida sesuai parameter dari Web
            if (mode === 'simple') {
                await script.exports.traceMethodCalls(targetClass);
            } else if (mode === 'full') {
                await script.exports.traceClassFull(targetClass);
            }

        } catch (err) {
            socket.emit('log', { type: 'danger', message: `[Error] ${err.message}` });
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
