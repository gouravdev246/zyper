import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export interface WhitelistedApp {
  id: string;
  name: string;
  executable: string;
  args?: string[];
  description: string;
}

export const WHITELISTED_APPS: Record<string, WhitelistedApp> = {
  notepad: {
    id: 'notepad',
    name: 'Notepad',
    executable: 'notepad.exe',
    description: 'Windows text editor',
  },
  calculator: {
    id: 'calculator',
    name: 'Calculator',
    executable: 'calc.exe',
    description: 'Windows Calculator',
  },
  vscode: {
    id: 'vscode',
    name: 'Visual Studio Code',
    executable: 'code.cmd',
    description: 'Code editor',
  },
  terminal: {
    id: 'terminal',
    name: 'Windows Terminal / PowerShell',
    executable: 'powershell.exe',
    description: 'Windows command shell',
  },
  browser: {
    id: 'browser',
    name: 'Default Web Browser',
    executable: 'cmd.exe',
    args: ['/c', 'start', 'https://www.google.com'],
    description: 'Default web browser',
  },
  explorer: {
    id: 'explorer',
    name: 'File Explorer',
    executable: 'explorer.exe',
    description: 'Windows file explorer',
  },
  spotify: {
    id: 'spotify',
    name: 'Spotify',
    executable: 'cmd.exe',
    args: ['/c', 'start', 'spotify:'],
    description: 'Spotify desktop client',
  },
};

export interface ApprovedFolder {
  id: string;
  name: string;
  path: string;
  description: string;
}

export type MediaAction = 'play_pause' | 'next_track' | 'prev_track' | 'volume_up' | 'volume_down' | 'mute';

export interface SearchResultItem {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface FolderSearchResult {
  totalFound: number;
  folderId: string;
  folderPath: string;
  query: string;
  results: SearchResultItem[];
}

// In-memory fallback device state for dev & tests
let memoryPaired = true;
let memoryRevoked = false;

export class WindowsCompanionService {
  private defaultUserId = '00000000-0000-0000-0000-000000000001';

  /**
   * Retrieves configured user-approved directory roots.
   */
  getApprovedFolders(): Record<string, ApprovedFolder> {
    const userProfile = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Default';

    // Locate monorepo root if executed from an inner workspace directory (e.g. apps/api)
    let workspaceRoot = process.cwd();
    if (fs.existsSync(path.resolve(workspaceRoot, '..', '..', 'PRD.md'))) {
      workspaceRoot = path.resolve(workspaceRoot, '..', '..');
    } else if (fs.existsSync(path.resolve(workspaceRoot, '..', 'PRD.md'))) {
      workspaceRoot = path.resolve(workspaceRoot, '..');
    }

    return {
      documents: {
        id: 'documents',
        name: 'Documents',
        path: path.join(userProfile, 'Documents'),
        description: 'Personal documents directory',
      },
      downloads: {
        id: 'downloads',
        name: 'Downloads',
        path: path.join(userProfile, 'Downloads'),
        description: 'Downloaded files directory',
      },
      desktop: {
        id: 'desktop',
        name: 'Desktop',
        path: path.join(userProfile, 'Desktop'),
        description: 'User desktop directory',
      },
      workspace: {
        id: 'workspace',
        name: 'Zyper Workspace',
        path: workspaceRoot,
        description: 'Current active Zyper application workspace',
      },
    };
  }

  /**
   * Retrieves current companion device pairing and connection status.
   */
  async getConnectionStatus(): Promise<{
    connected: boolean;
    provider: string;
    status: 'PAIRED' | 'PENDING' | 'REVOKED';
    deviceName: string;
    scopes: string[];
    approvedFolders: string[];
    whitelistedApps: string[];
    lastSeenAt?: string;
  }> {
    const hostDeviceName = os.hostname() || 'Windows-Host';
    const approvedFolderKeys = Object.keys(this.getApprovedFolders());
    const whitelistedAppKeys = Object.keys(WHITELISTED_APPS);
    const scopes = ['desktop:app:launch', 'desktop:fs:search', 'desktop:media:control'];

    try {
      const device = await prisma.device.findFirst({
        where: {
          userId: this.defaultUserId,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (device) {
        const isPaired = device.status === 'PAIRED';
        return {
          connected: isPaired,
          provider: 'windows_companion',
          status: device.status as 'PAIRED' | 'PENDING' | 'REVOKED',
          deviceName: device.deviceName || hostDeviceName,
          scopes: isPaired ? scopes : [],
          approvedFolders: approvedFolderKeys,
          whitelistedApps: whitelistedAppKeys,
          lastSeenAt: device.lastSeenAt?.toISOString(),
        };
      }
    } catch {
      // Fallback to in-memory state
    }

    const currentStatus = memoryRevoked ? 'REVOKED' : memoryPaired ? 'PAIRED' : 'PENDING';
    const isConnected = currentStatus === 'PAIRED';

    return {
      connected: isConnected,
      provider: 'windows_companion',
      status: currentStatus,
      deviceName: hostDeviceName,
      scopes: isConnected ? scopes : [],
      approvedFolders: approvedFolderKeys,
      whitelistedApps: whitelistedAppKeys,
      lastSeenAt: new Date().toISOString(),
    };
  }

  /**
   * Pairs the local Windows host machine with the user's account.
   */
  async pairDevice(customDeviceName?: string): Promise<{ success: boolean; status: string; deviceName: string }> {
    const deviceName = customDeviceName || os.hostname() || 'Zyper-Windows-Host';
    memoryPaired = true;
    memoryRevoked = false;

    try {
      const existing = await prisma.device.findFirst({
        where: { userId: this.defaultUserId },
      });

      if (existing) {
        await prisma.device.update({
          where: { id: existing.id },
          data: {
            deviceName,
            status: 'PAIRED',
            registeredAt: new Date(),
            lastSeenAt: new Date(),
            revokedAt: null,
          },
        });
      } else {
        await prisma.device.create({
          data: {
            userId: this.defaultUserId,
            deviceName,
            status: 'PAIRED',
            registeredAt: new Date(),
            lastSeenAt: new Date(),
          },
        });
      }

      await prisma.toolConnection.upsert({
        where: {
          userId_provider: {
            userId: this.defaultUserId,
            provider: 'windows_companion',
          },
        },
        update: {
          status: 'CONNECTED',
          lastSyncAt: new Date(),
          revokedAt: null,
        },
        create: {
          userId: this.defaultUserId,
          provider: 'windows_companion',
          status: 'CONNECTED',
          lastSyncAt: new Date(),
        },
      });
    } catch (err) {
      logger.warn(`Failed to persist companion device pairing in database: ${err}`);
    }

    return {
      success: true,
      status: 'PAIRED',
      deviceName,
    };
  }

  /**
   * Revokes the companion device identity, instantly disabling remote command execution.
   */
  async revokeDevice(): Promise<{ success: boolean; status: string }> {
    memoryPaired = false;
    memoryRevoked = true;

    try {
      await prisma.device.updateMany({
        where: { userId: this.defaultUserId },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
        },
      });

      await prisma.toolConnection.updateMany({
        where: {
          userId: this.defaultUserId,
          provider: 'windows_companion',
        },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
        },
      });
    } catch (err) {
      logger.warn(`Failed to persist companion revocation in database: ${err}`);
    }

    return {
      success: true,
      status: 'REVOKED',
    };
  }

  /**
   * Sets mock connection state for automated tests.
   */
  setMockConnected(connected: boolean): void {
    memoryPaired = connected;
    memoryRevoked = !connected;
  }

  /**
   * Verifies that the companion device is paired and not revoked before executing any local action.
   */
  private async assertDeviceAuthorized(): Promise<void> {
    const status = await this.getConnectionStatus();
    if (!status.connected || status.status !== 'PAIRED') {
      throw new Error(
        `Windows Local Companion is ${status.status.toLowerCase()}. Local desktop command execution is disabled until paired.`
      );
    }
  }

  /**
   * Launches a whitelisted desktop application.
   * Strictly enforces application whitelist to prevent arbitrary shell injection.
   */
  async launchApp(appId: string): Promise<{
    success: boolean;
    appId: string;
    appName: string;
    status: string;
    launchedAt: string;
    pid?: number;
  }> {
    await this.assertDeviceAuthorized();

    const normalizedId = appId.toLowerCase().trim();
    const appConfig = WHITELISTED_APPS[normalizedId];

    if (!appConfig) {
      const allowed = Object.keys(WHITELISTED_APPS).join(', ');
      throw new Error(`Application "${appId}" is not permitted. Authorized applications: ${allowed}`);
    }

    const launchedAt = new Date().toISOString();

    // In non-Windows OS or testing, return safe simulated launch
    if (process.platform !== 'win32' || process.env.NODE_ENV === 'test') {
      return {
        success: true,
        appId: appConfig.id,
        appName: appConfig.name,
        status: 'LAUNCHED',
        launchedAt,
        pid: 12345,
      };
    }

    try {
      const child = spawn(appConfig.executable, appConfig.args || [], {
        detached: true,
        stdio: 'ignore',
        shell: false,
      });

      child.unref();

      return {
        success: true,
        appId: appConfig.id,
        appName: appConfig.name,
        status: 'LAUNCHED',
        launchedAt,
        pid: child.pid,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to launch application';
      logger.error(`Error launching application ${appConfig.name}: ${msg}`);
      throw new Error(`Failed to launch ${appConfig.name}: ${msg}`);
    }
  }

  /**
   * Controls basic Windows media playback and master volume.
   */
  async controlMedia(action: MediaAction): Promise<{
    success: boolean;
    action: MediaAction;
    status: string;
    executedAt: string;
  }> {
    await this.assertDeviceAuthorized();

    const validActions: MediaAction[] = [
      'play_pause',
      'next_track',
      'prev_track',
      'volume_up',
      'volume_down',
      'mute',
    ];

    if (!validActions.includes(action)) {
      throw new Error(`Unsupported media action "${action}". Allowed: ${validActions.join(', ')}`);
    }

    const executedAt = new Date().toISOString();

    // In non-Windows environment or test mode, return safe simulated result
    if (process.platform !== 'win32' || process.env.NODE_ENV === 'test') {
      return {
        success: true,
        action,
        status: 'EXECUTED',
        executedAt,
      };
    }

    // Windows Virtual Key codes for media controls:
    // VK_VOLUME_MUTE = 0xAD
    // VK_VOLUME_DOWN = 0xAE
    // VK_VOLUME_UP = 0xAF
    // VK_MEDIA_NEXT_TRACK = 0xB0
    // VK_MEDIA_PREV_TRACK = 0xB1
    // VK_MEDIA_PLAY_PAUSE = 0xCD
    const vkMap: Record<MediaAction, number> = {
      mute: 0xAD,
      volume_down: 0xAE,
      volume_up: 0xAF,
      next_track: 0xB0,
      prev_track: 0xB1,
      play_pause: 0xCD,
    };

    const vkCode = vkMap[action];
    const psScript = `
      $sig = '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);';
      $k = Add-Type -MemberDefinition $sig -Name Win32Key -Namespace Win32Audio -PassThru;
      $k::keybd_event(${vkCode}, 0, 0, 0);
      $k::keybd_event(${vkCode}, 0, 2, 0);
    `.trim();

    try {
      await new Promise<void>((resolve, reject) => {
        const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
          stdio: 'ignore',
        });
        ps.on('error', reject);
        ps.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`PowerShell media key command exited with code ${code}`));
        });
      });

      return {
        success: true,
        action,
        status: 'EXECUTED',
        executedAt,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to invoke media action';
      logger.error(`Media control execution error for ${action}: ${msg}`);
      throw new Error(`Media control action "${action}" failed: ${msg}`);
    }
  }

  /**
   * Searches for files within an explicitly user-approved directory.
   * Strictly blocks directory traversal ('..') to prevent unauthorized access.
   */
  async searchApprovedFolder(
    folderId: string,
    query: string,
    maxResults: number = 10
  ): Promise<FolderSearchResult> {
    await this.assertDeviceAuthorized();

    const approvedFolders = this.getApprovedFolders();
    const folderConfig = approvedFolders[folderId.toLowerCase()];

    if (!folderConfig) {
      const available = Object.keys(approvedFolders).join(', ');
      throw new Error(`Folder identifier "${folderId}" is not approved. Permitted folders: ${available}`);
    }

    // Security check: Query must not contain path navigation or backslash traversal
    if (query.includes('..') || query.includes('/') || query.includes('\\')) {
      throw new Error('Directory traversal attempt blocked. The search query must specify a filename or extension term.');
    }

    const rootPath = path.resolve(folderConfig.path);
    if (!fs.existsSync(rootPath)) {
      return {
        totalFound: 0,
        folderId: folderConfig.id,
        folderPath: rootPath,
        query,
        results: [],
      };
    }

    const results: SearchResultItem[] = [];
    const normalizedQuery = query.toLowerCase().trim();

    // Bounded breadth-first search up to maxDepth 3
    const queue: Array<{ dir: string; depth: number }> = [{ dir: rootPath, depth: 0 }];
    const maxDepth = 3;

    while (queue.length > 0 && results.length < maxResults) {
      const current = queue.shift();
      if (!current) break;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(current.dir, { withFileTypes: true });
      } catch {
        // Skip inaccessible folders
        continue;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        // Skip hidden/system directories
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '$RECYCLE.BIN') {
          continue;
        }

        const fullPath = path.join(current.dir, entry.name);

        // Security check: verify resolved path is strictly inside the approved root
        const relative = path.relative(rootPath, fullPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          continue;
        }

        const matches = entry.name.toLowerCase().includes(normalizedQuery);
        if (matches) {
          let sizeBytes: number | undefined;
          let modifiedAt: string | undefined;

          try {
            const stats = fs.statSync(fullPath);
            sizeBytes = stats.size;
            modifiedAt = stats.mtime.toISOString();
          } catch {
            // Stat may fail on system files
          }

          results.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            sizeBytes,
            modifiedAt,
          });
        }

        if (entry.isDirectory() && current.depth < maxDepth) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
      }
    }

    return {
      totalFound: results.length,
      folderId: folderConfig.id,
      folderPath: rootPath,
      query,
      results,
    };
  }
}

export const windowsCompanionService = new WindowsCompanionService();
