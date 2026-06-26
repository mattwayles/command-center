const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const DATA_FILE = path.join(app.getPath('userData'), 'tasks.json');

// One-time migration: the app was formerly named "todo-app", so its userData
// lived in ~/Library/Application Support/todo-app. After the rename to
// "command-center" the userData path changes; copy todos into the new location
// if not already present.
function migrateLegacyUserData() {
  const newDir = app.getPath('userData');
  const oldDir = path.join(app.getPath('appData'), 'todo-app');
  if (oldDir === newDir || !fs.existsSync(oldDir)) return;
  try {
    fs.mkdirSync(newDir, { recursive: true });
    const src = path.join(oldDir, 'todos.json');
    const dest = path.join(newDir, 'tasks.json');
    if (fs.existsSync(src) && !fs.existsSync(dest)) fs.copyFileSync(src, dest);
  } catch (err) {
    console.error('Legacy userData migration failed:', err.message);
  }
}

function loadTasks() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
    // One-time rename: todos.json → tasks.json within the same userData directory
    const oldFile = path.join(path.dirname(DATA_FILE), 'todos.json');
    if (fs.existsSync(oldFile)) {
      const data = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
      return data;
    }
  } catch {}
  return [];
}

function saveTasks(tasks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf8');
}

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
  migrateLegacyUserData();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('tasks:load', () => loadTasks());

ipcMain.handle('tasks:save', (_event, tasks) => {
  saveTasks(tasks);
  return true;
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
