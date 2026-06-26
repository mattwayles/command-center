const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

function createWindow() {
  const win = new BrowserWindow({
    width: 500,
    height: 650,
    minWidth: 500,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('renderer/index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const LOGIN_SHELL = process.env.SHELL || '/bin/zsh';

ipcMain.handle('trivia:run', (event, amount) => {
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || n < 1 || n > 50) return Promise.reject(new Error('Invalid amount'));
  return new Promise((resolve, reject) => {
    const proc = spawn(
      LOGIN_SHELL,
      ['-lc', `claude -p "/trivia ${n}" --dangerously-skip-permissions`],
      { cwd: app.getPath('home') }
    );
    let output = '';
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { output += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(output);
      else reject(new Error(`claude exited with code ${code}`));
    });
    proc.on('error', reject);
  });
});

ipcMain.handle('standup:run', () => {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      LOGIN_SHELL,
      ['-lc', 'claude -p "/standup" --dangerously-skip-permissions'],
      { cwd: app.getPath('home'), stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let output = '';
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { output += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(output);
      else reject(new Error(`claude exited with code ${code}`));
    });
    proc.on('error', reject);
  });
});
