const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

console.log('===============================================================');
console.log('   🚀 MT5 AI JOURNAL ANALYZER - UNIFIED STARTUP ORCHESTRATOR   ');
console.log('===============================================================');

// 1. Terminate any lingering zombie processes on application ports
function cleanupPort(port) {
  try {
    const stdout = execSync(`netstat -ano | findstr LISTENING | findstr :${port}`, { encoding: 'utf8' });
    const lines = stdout.trim().split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(pid) && parseInt(pid) > 0 && parseInt(pid) !== process.pid) {
        console.log(`[CLEANUP] Port ${port} is currently occupied by PID ${pid}. Terminating...`);
        try {
          execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' });
        } catch (e) {}
      }
    }
  } catch (e) {
    // Port is free
  }
}

console.log('[1/4] Ensuring ports 5173, 3000, 4000, 4500 are clear...');
cleanupPort(5173);
cleanupPort(3000);
cleanupPort(4000);
cleanupPort(4500);

// Helper to poll an HTTP URL until it returns any HTTP response
function waitForHttp(url, timeoutMs = 90000, intervalMs = 1000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url} after ${timeoutMs / 1000}s`));
        } else {
          process.stdout.write('.');
          setTimeout(check, intervalMs);
        }
      });
      req.end();
    };
    check();
  });
}

const processes = [];

function registerProcess(proc, name) {
  processes.push({ proc, name });
  proc.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn(`[WARN] Process ${name} exited with code ${code}`);
    }
  });
}

function shutdown() {
  console.log('\n\n[SHUTDOWN] Stopping all MT5 Analyzer services...');
  for (const { proc, name } of processes) {
    if (proc && proc.pid) {
      console.log(`Stopping ${name} (PID: ${proc.pid})...`);
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /PID ${proc.pid} /T`, { stdio: 'ignore' });
        } else {
          proc.kill('SIGTERM');
        }
      } catch (e) {}
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  try {
    // 2. Start NestJS Backend
    console.log('\n[2/4] Starting NestJS Backend (port 4000)...');
    const backendProc = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'start:dev'],
      {
        cwd: path.join(__dirname, 'backend'),
        shell: true,
        stdio: 'inherit'
      }
    );
    registerProcess(backendProc, 'NestJS Backend');

    process.stdout.write('Waiting for Backend to initialize & connect to database');
    await waitForHttp('http://127.0.0.1:4000/api/v1/auth/me', 90000);
    console.log('\n✅ Backend is ONLINE at http://localhost:4000/api/v1');

    // 3. Start MT5 Python Connector
    console.log('\n[3/4] Starting MT5 Python Connector (port 4500)...');
    const venvPython = path.join(__dirname, 'mt5-connector', '.venv', 'Scripts', 'python.exe');
    const pythonExe = fs.existsSync(venvPython) ? venvPython : 'python';

    const connectorProc = spawn(
      pythonExe,
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '4500', '--reload'],
      {
        cwd: path.join(__dirname, 'mt5-connector'),
        shell: false,
        stdio: 'inherit'
      }
    );
    registerProcess(connectorProc, 'MT5 Python Connector');

    process.stdout.write('Waiting for Python Connector to initialize');
    await waitForHttp('http://127.0.0.1:4500/docs', 30000);
    console.log('\n✅ MT5 Python Connector is ONLINE at http://localhost:4500');

    // 4. Start Vite Frontend Dashboard
    console.log('\n[4/4] Starting Vite Frontend Dev Server (port 5173)...');
    const frontendProc = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['vite', '--host', '0.0.0.0', '--port', '5173'],
      {
        cwd: path.join(__dirname, 'frontend'),
        shell: true,
        stdio: 'inherit'
      }
    );
    registerProcess(frontendProc, 'Vite Frontend');

    process.stdout.write('Waiting for Frontend to initialize');
    await waitForHttp('http://127.0.0.1:5173', 30000);
    console.log('\n✅ Frontend Dashboard is ONLINE at http://localhost:5173');

    // Also listen on port 3000 to redirect requests to 5173 so both ports work
    try {
      const redirectServer = http.createServer((req, res) => {
        res.writeHead(302, { Location: `http://localhost:5173${req.url}` });
        res.end();
      });
      redirectServer.listen(3000, '0.0.0.0', () => {
        console.log('✅ Port 3000 alias enabled (redirects to http://localhost:5173)');
      });
    } catch (e) {}

    console.log('\n===============================================================');
    console.log('   🎉 ALL SERVICES ARE RUNNING AND READY TO USE!              ');
    console.log('===============================================================');
    console.log('   🟢 Web Portal:       http://localhost:5173  (or :3000)      ');
    console.log('   🟢 Backend API:      http://localhost:4000/api/v1           ');
    console.log('   🟢 MT5 Connector:    http://localhost:4500                  ');
    console.log('===============================================================');
    console.log('   Default Admin Credentials:                                 ');
    console.log('   Email:     sankalpmisal007@gmail.com                        ');
    console.log('   Password:  password123                                      ');
    console.log('===============================================================');
    console.log('   Press Ctrl+C at any time to gracefully stop all services.   \n');

  } catch (err) {
    console.error('\n❌ Startup failed:', err.message);
    shutdown();
  }
})();
