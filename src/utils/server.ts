import { execa } from 'execa';
import type { ResultPromise } from 'execa';
import path from 'path';
import { HytaleError } from './errors.js';

let serverProcess: ResultPromise | null = null;

export interface ServerOptions {
  javaPath: string;
  serverJarPath: string;
  assetsPath?: string;
  workingDir: string;
  jvmArgs?: string[]; // e.g., ['-Xmx2G', '-Xms1G']
}

/** Launch the Hytale server */
export function launchHytaleServer(options: ServerOptions): void {
  const { javaPath, serverJarPath, assetsPath, workingDir, jvmArgs = [] } = options;

  try {
    // Stop existing server if running
    if (serverProcess) {
      stopHytaleServer();
    }

    // Build command args - JVM args first, then -jar, then server args
    const args = [...jvmArgs, '-jar', serverJarPath];
    if (assetsPath) {
      args.push('--assets', assetsPath);
    }

    // Launch server with output streaming
    serverProcess = execa(
      javaPath,
      args,
      {
        cwd: workingDir,
        stdio: 'inherit', // Stream output to console
        cleanup: true,
        reject: false, // Don't reject promise on non-zero exit code
      }
    );

    // Handle server exit
    serverProcess.then((result) => {
      if (result.exitCode !== 0 && result.exitCode !== null) {
        console.log(`\n⚠️  Server exited with code ${result.exitCode}`);
      }
      serverProcess = null;
    }).catch((error) => {
      console.error(`\n❌ Server error: ${error.message}`);
      serverProcess = null;
    });
  } catch (error) {
    throw new HytaleError(`Failed to launch Hytale server: ${(error as Error).message}`);
  }
}

/** Stop the running Hytale server */
export async function stopHytaleServer(): Promise<void> {
  if (!serverProcess) {
    return;
  }

  try {
    // Send stop command to server console
    if (serverProcess.stdin) {
      serverProcess.stdin.write('stop\n');
    }

    // Wait for graceful shutdown (max 10 seconds)
    const timeout = setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
      }
    }, 10000);

    await serverProcess;
    clearTimeout(timeout);
    serverProcess = null;
  } catch {
    // Process might already be stopped
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGKILL');
    }
    serverProcess = null;
  }
}

/** Check if server is running */
export function isServerRunning(): boolean {
  return serverProcess !== null && !serverProcess.killed;
}

/** Restart the Hytale server */
export async function restartHytaleServer(options: ServerOptions): Promise<void> {
  await stopHytaleServer();
  // Wait a bit before restarting
  await new Promise(resolve => setTimeout(resolve, 2000));
  launchHytaleServer(options);
}
