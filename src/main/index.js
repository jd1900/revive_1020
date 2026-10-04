const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { InstallationManager } = require('./InstallationManager');
const { PrintManager } = require('./PrintManager');

let mainWindow = null;
let installationManager = null;
let printManager = null;

function getResourcesPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bundled_resources');
  }
  return path.join(__dirname, '../../bundled_resources');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 760,
    minWidth: 850,
    minHeight: 680,
    title: 'HP LaserJet 1020 Setup & Print',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0e17',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const resourcesPath = getResourcesPath();
  console.log(`[Main] Using resources path: ${resourcesPath}`);

  // Initialize Managers
  installationManager = new InstallationManager(resourcesPath, (progressData) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('setup-progress', progressData);
    }
  });

  printManager = new PrintManager(resourcesPath, (printData) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('print-progress', printData);
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('printer:get-status', async () => {
  return installationManager.getState();
});

ipcMain.handle('printer:start-setup', async () => {
  return await installationManager.startSetup();
});

ipcMain.handle('printer:print-file', async (event, { filePath, copies }) => {
  return await printManager.printFile(filePath, copies);
});

ipcMain.handle('printer:get-logs', async () => {
  const installLogs = installationManager.getLogs();
  const printLogs = printManager.getLogs();
  return { installLogs, printLogs };
});

ipcMain.handle('dialog:open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select PDF or PostScript Document',
    properties: ['openFile'],
    filters: [
      { name: 'Printable Documents', extensions: ['pdf', 'ps'] },
      { name: 'PDF Documents', extensions: ['pdf'] },
      { name: 'PostScript Files', extensions: ['ps'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
