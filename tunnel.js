// tunnel.js - Always-On Serveo Tunnel with Anti-Sleep Keep-Alive for SOCN-PDA
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const LOCAL_PORT = process.env.PORT || 5001;
const SUBDOMAIN = process.env.SUBDOMAIN || 'SOCN-PDA';
const SSH_KEY = 'C:\\Users\\SPXTH71637\\.ssh\\id_ed25519';
const PING_INTERVAL_MS = 30 * 1000; // Ping every 30 seconds to keep Serveo 100% active
const RECONNECT_DELAY_MS = 3000;

let currentPublicUrl = null;
let pingTimer = null;
let activeSshProcess = null;
let isStopping = false;

console.clear();
console.log('==============================================================');
console.log(`  🌐 PDA Storage - Serveo Tunnel Manager [${SUBDOMAIN}]`);
console.log('  🛡️ Anti-Sleep Active: SSH Keepalive + HTTP Heartbeat Ping');
console.log('==============================================================');
console.log('');

// Check if local server is running on target port
function checkLocalServer(callback) {
  let finished = false;
  const finish = (result) => {
    if (!finished) {
      finished = true;
      callback(result);
    }
  };

  const req = http.get(`http://127.0.0.1:${LOCAL_PORT}/api/stats`, (res) => {
    finish(res.statusCode === 200);
  });
  req.on('error', () => finish(false));
  req.setTimeout(2500, () => {
    req.destroy();
    finish(false);
  });
}

// Prevent Windows from sleeping while tunnel is active
function enableWindowsKeepAwake() {
  if (process.platform === 'win32') {
    try {
      const ps = spawn('powershell', [
        '-NoProfile',
        '-Command',
        `$code = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);';
         $type = Add-Type -MemberDefinition $code -Name "WinSleep" -Namespace "Win32" -PassThru;
         $type::SetThreadExecutionState(0x80000001);`
      ]);
      ps.on('error', () => {});
    } catch (e) {}
  }
}

// Start HTTP heartbeat pinger to prevent Serveo idle disconnect
function startHeartbeatPing(publicUrl) {
  if (pingTimer) clearInterval(pingTimer);

  // Send first ping after 4s
  setTimeout(sendPing, 4000);

  pingTimer = setInterval(sendPing, PING_INTERVAL_MS);

  async function sendPing() {
    if (!currentPublicUrl || isStopping) return;
    const timeStr = new Date().toLocaleTimeString('th-TH');
    try {
      const pingUrl = `${currentPublicUrl}/api/stats`;
      const res = await fetch(pingUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        console.log(`[${timeStr}] 🟢 Anti-Sleep Ping: HTTP ${res.status} OK -> Serveo is Alive!`);
      } else {
        console.log(`[${timeStr}] 🟡 Anti-Sleep Ping: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(`[${timeStr}] ⚠️ Anti-Sleep Ping: ${err.message.slice(0, 45)}`);
    }
  }
}

function stopHeartbeatPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

// Connect to Serveo
function startServeoTunnel() {
  if (isStopping || activeSshProcess) return;

  console.log(`[${new Date().toLocaleTimeString('th-TH')}] 🔌 Establishing SSH tunnel (${SUBDOMAIN} -> localhost:${LOCAL_PORT})...`);

  const sshArgs = [
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=NUL'
  ];

  if (fs.existsSync(SSH_KEY)) {
    sshArgs.push('-i', SSH_KEY);
  }

  sshArgs.push('-R', `${SUBDOMAIN}:80:127.0.0.1:${LOCAL_PORT}`);
  sshArgs.push('serveo.net');

  activeSshProcess = spawn('ssh', sshArgs);

  activeSshProcess.stdout.on('data', (data) => {
    const text = data.toString();

    // Look for public URL: https://xxxx.serveousercontent.com
    const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.serveousercontent\.com/);
    if (match) {
      const url = match[0];
      if (url !== currentPublicUrl) {
        currentPublicUrl = url;
        console.log('');
        console.log('==============================================================');
        console.log(`🚀 PUBLIC SERVE URL: ${url}`);
        console.log('==============================================================');
        console.log(`📱 Admin Dashboard:  ${url}`);
        console.log(`📦 IB Kiosk:        ${url}/dept/IB`);
        console.log(`📦 MS Kiosk:        ${url}/dept/MS`);
        console.log(`📦 CBS Kiosk:       ${url}/dept/CBS`);
        console.log(`📦 MCBS Kiosk:      ${url}/dept/MCBS`);
        console.log(`📦 OBI Kiosk:       ${url}/dept/OBI`);
        console.log(`📦 OBS Kiosk:       ${url}/dept/OBS`);
        console.log(`📦 OBD Kiosk:       ${url}/dept/OBD`);
        console.log('==============================================================');
        console.log('🛡️ Keep this window OPEN. Anti-sleep ping runs every 30s.');
        console.log('');

        // Start HTTP Anti-Sleep Heartbeat
        startHeartbeatPing(url);
      }
    } else {
      const clean = text.replace(/Pseudo-terminal.*\n?/, '').trim();
      if (clean && !clean.includes('Permanently added') && !clean.includes('Tip')) {
        console.log(`[Serveo] ${clean}`);
      }
    }
  });

  activeSshProcess.stderr.on('data', (data) => {
    const text = data.toString();
    if (text.includes('Permanently added') || text.includes('Pseudo-terminal')) {
      return;
    }
    console.warn(`[Serveo SSH] ${text.trim()}`);
  });

  activeSshProcess.on('close', (code) => {
    stopHeartbeatPing();
    currentPublicUrl = null;
    activeSshProcess = null;

    if (!isStopping) {
      console.log('');
      console.log(`⚠️ Serveo tunnel disconnected (code: ${code}). Auto-reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
      setTimeout(startServeoTunnel, RECONNECT_DELAY_MS);
    }
  });

  activeSshProcess.on('error', (err) => {
    console.error(`❌ SSH process error: ${err.message}`);
    stopHeartbeatPing();
    currentPublicUrl = null;
    activeSshProcess = null;

    if (!isStopping) {
      console.log(`⏳ Retrying in ${RECONNECT_DELAY_MS / 1000}s...`);
      setTimeout(startServeoTunnel, RECONNECT_DELAY_MS);
    }
  });
}

// Initial checks & launch
enableWindowsKeepAwake();

checkLocalServer((isRunning) => {
  if (!isRunning) {
    console.warn(`⚠️ Warning: Local server on port ${LOCAL_PORT} is not responding yet.`);
    console.warn(`   Make sure "start.bat" (node server.js) is running!\n`);
  } else {
    console.log(`✅ Local server on http://localhost:${LOCAL_PORT} is ACTIVE.`);
  }

  startServeoTunnel();
});

// Handle graceful exit
process.on('SIGINT', () => {
  isStopping = true;
  stopHeartbeatPing();
  if (activeSshProcess) activeSshProcess.kill();
  console.log('\nStopping Serveo tunnel. Goodbye!');
  process.exit(0);
});

process.on('SIGTERM', () => {
  isStopping = true;
  stopHeartbeatPing();
  if (activeSshProcess) activeSshProcess.kill();
  process.exit(0);
});
