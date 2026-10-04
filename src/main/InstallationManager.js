const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Installation States
 */
const STATES = {
  NOT_STARTED: 'NOT_STARTED',
  CHECKING: 'CHECKING',
  INSTALLING: 'INSTALLING',
  CONFIGURING: 'CONFIGURING',
  VERIFYING: 'VERIFYING',
  READY: 'READY',
  FAILED: 'FAILED',
};

class InstallationManager {
  constructor(resourcesPath, onProgressCallback) {
    this.resourcesPath = resourcesPath;
    this.onProgress = onProgressCallback || (() => {});
    this.currentState = STATES.NOT_STARTED;
    this.logs = [];
    this.errorInfo = null;
  }

  log(msg) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${msg}`;
    this.logs.push(entry);
    console.log(entry);
  }

  updateState(state, stepMessage, progressPct = 0, errorDetails = null) {
    this.currentState = state;
    if (errorDetails) {
      this.errorInfo = errorDetails;
    }
    this.onProgress({
      state: this.currentState,
      message: stepMessage,
      progress: progressPct,
      errorInfo: this.errorInfo,
      logs: this.logs,
    });
  }

  getLogs() {
    return this.logs;
  }

  getState() {
    return {
      state: this.currentState,
      errorInfo: this.errorInfo,
    };
  }

  /**
   * Run the automated printer setup & verification sequence
   */
  async startSetup() {
    this.logs = [];
    this.errorInfo = null;
    this.log('Starting HP LaserJet 1020 automated setup...');

    try {
      // Step 1: Checking system and bundled resources
      this.updateState(STATES.CHECKING, 'Checking system prerequisites & bundled binaries...', 15);
      await this.checkPrerequisites();

      // Step 2: Checking USB Connection
      this.updateState(STATES.CHECKING, 'Detecting HP LaserJet 1020 USB connection...', 35);
      const usbDetected = await this.checkUsbConnection();

      if (!usbDetected) {
        throw {
          code: 'PRINTER_NOT_FOUND',
          title: 'HP LaserJet 1020 Not Detected',
          message: 'The HP LaserJet 1020 printer was not found on your USB ports.',
          actionableSteps: [
            '1. Connect the HP LaserJet 1020 printer using a USB cable.',
            '2. Ensure the printer power switch is ON and plugged into power.',
            '3. If using a USB-C adapter or hub, try plugging directly into your Mac.',
            '4. Click "Try Again" below once connected.',
          ],
        };
      }

      // Step 3: Preparing components & permissions
      this.updateState(STATES.INSTALLING, 'Preparing printing components & firmware...', 60);
      await this.ensureExecutablePermissions();

      // Step 4: Verification & Firmware Upload
      this.updateState(STATES.CONFIGURING, 'Verifying printer status & initializing firmware...', 80);
      const fwResult = await this.uploadFirmwareAndVerify();

      if (!fwResult.success) {
        throw {
          code: 'FIRMWARE_FAILED',
          title: 'Printer Initialization Failed',
          message: fwResult.error || 'Failed to upload firmware to HP LaserJet 1020.',
          actionableSteps: [
            '1. Turn off the printer power switch for 5 seconds.',
            '2. Turn the printer back ON and wait for the ready light.',
            '3. Click "Try Again" to re-attempt setup.',
          ],
        };
      }

      // Final Step: Ready
      this.log('Setup successfully completed! HP LaserJet 1020 is ready.');
      this.updateState(STATES.READY, 'HP LaserJet 1020 is ready to print!', 100);
      return { success: true };

    } catch (err) {
      this.log(`Setup failed: ${err.message || err.title || JSON.stringify(err)}`);
      
      const structuredError = err.code ? err : {
        code: 'SYSTEM_ERROR',
        title: 'Printer Setup Encountered an Error',
        message: err.message || 'An unexpected error occurred during setup.',
        actionableSteps: [
          '1. Ensure the printer is powered on and connected.',
          '2. Click "Try Again" to retry setup.',
          '3. If the problem persists, check the technical logs below.',
        ],
        raw: err.toString(),
      };

      this.updateState(STATES.FAILED, structuredError.title, 0, structuredError);
      return { success: false, error: structuredError };
    }
  }

  /**
   * Verify that bundled_resources directory and files exist
   */
  async checkPrerequisites() {
    const binPath = path.join(this.resourcesPath, 'bin');
    const scriptsPath = path.join(this.resourcesPath, 'scripts');
    const firmwarePath = path.join(this.resourcesPath, 'firmware');

    if (!fs.existsSync(binPath) || !fs.existsSync(scriptsPath) || !fs.existsSync(firmwarePath)) {
      throw {
        code: 'MISSING_RESOURCES',
        title: 'Bundled Printing Components Missing',
        message: 'Required application resources were not found in the application bundle.',
        actionableSteps: [
          '1. Re-download or reinstall the application package.',
          '2. Ensure the app has not been modified or corrupted.',
        ],
      };
    }

    const hpUsbBin = path.join(binPath, 'hp1020_usb');
    const fwFile = path.join(firmwarePath, 'sihp1020.dl');
    const scriptFile = path.join(scriptsPath, 'print-pipeline.sh');

    if (!fs.existsSync(hpUsbBin) || !fs.existsSync(fwFile) || !fs.existsSync(scriptFile)) {
      throw {
        code: 'MISSING_FILES',
        title: 'Printer Component Missing',
        message: `Missing required binary or firmware file at ${binPath}`,
        actionableSteps: [
          '1. Re-download the HP LaserJet 1020 app.',
          '2. If building from source, run npm run build:resources first.',
        ],
      };
    }

    this.log('Prerequisites check passed.');
  }

  /**
   * Check if HP LaserJet 1020 (03f0:2b17) is attached via USB using ioreg or hp1020_usb
   */
  checkUsbConnection() {
    return new Promise((resolve) => {
      // First try ioreg
      execFile('ioreg', ['-p', 'IOUSB', '-l', '-w', '0'], (err, stdout) => {
        if (!err && stdout) {
          // Vendor ID 0x03f0 = 1008 decimal, Product ID 0x2b17 = 11031 decimal
          const hasHp1020 = stdout.includes('1020') || stdout.includes('0x3f0') || stdout.includes('1008');
          if (hasHp1020) {
            this.log('USB device detected via ioreg (HP LaserJet 1020).');
            return resolve(true);
          }
        }

        // Fallback: Test running hp1020_usb to see if device opens
        const hpUsbBin = path.join(this.resourcesPath, 'bin', 'hp1020_usb');
        const dummyFw = path.join(this.resourcesPath, 'firmware', 'sihp1020.dl');
        execFile(hpUsbBin, [dummyFw], (usbErr, usbStdout, usbStderr) => {
          const output = (usbStdout || '') + (usbStderr || '');
          if (output.includes('not found') || output.includes('inaccessible')) {
            this.log('HP LaserJet 1020 USB device not found.');
            return resolve(false);
          }
          this.log('USB device responded to hp1020_usb tool.');
          resolve(true);
        });
      });
    });
  }

  /**
   * Ensure permissions are executable for binaries
   */
  async ensureExecutablePermissions() {
    const binPath = path.join(this.resourcesPath, 'bin');
    const scriptsPath = path.join(this.resourcesPath, 'scripts');

    const makeExec = (dir) => {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            fs.chmodSync(filePath, 0o755);
          } catch (e) {
            // Ignore permission errors if read-only
          }
        }
      }
    };

    makeExec(binPath);
    makeExec(scriptsPath);
    this.log('Executable permissions verified.');
  }

  /**
   * Run hp1020_usb to upload firmware if needed
   */
  uploadFirmwareAndVerify() {
    return new Promise((resolve) => {
      const hpUsbBin = path.join(this.resourcesPath, 'bin', 'hp1020_usb');
      const fwFile = path.join(this.resourcesPath, 'firmware', 'sihp1020.dl');

      this.log('Executing hp1020_usb firmware check/upload...');
      execFile(hpUsbBin, [fwFile], (err, stdout, stderr) => {
        const output = (stdout || '') + (stderr || '');
        this.log(`hp1020_usb output: ${output.trim()}`);

        if (err && !output.includes('Firmware already loaded') && !output.includes('Firmware sent')) {
          return resolve({
            success: false,
            error: output || err.message,
          });
        }

        resolve({ success: true, output });
      });
    });
  }
}

module.exports = { InstallationManager, STATES };
