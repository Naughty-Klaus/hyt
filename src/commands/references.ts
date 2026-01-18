import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { execa } from 'execa';
import { loadConfig } from '../utils/config.js';
import { downloadFile, getCfrUrl, getVineflowerUrl } from '../utils/download.js';
import { startSpinner, success, error, info, warn } from '../utils/ui.js';
import { ConfigError, HytaleError } from '../utils/errors.js';
import { directoryExists } from '../utils/fs.js';

type Decompiler = 'cfr' | 'vineflower';

export function referencesCommand(): Command {
  return new Command('generate-references')
    .description('Generate decompiled reference sources from Hytale server JAR (takes ~10 minutes)')
    .option('--decompiler <type>', 'Decompiler to use: cfr or vineflower (default: cfr)', 'cfr')
    .action(async (options: { decompiler: string }) => {
      try {
        const decompiler = options.decompiler.toLowerCase() as Decompiler;
        if (decompiler !== 'cfr' && decompiler !== 'vineflower') {
          throw new HytaleError(
            `Invalid decompiler: ${options.decompiler}. Use 'cfr' or 'vineflower'`
          );
        }

        console.log(`\n📚 Generating reference sources with ${decompiler.toUpperCase()}...\n`);

        // Verify setup has been run
        const config = await loadConfig();
        if (!config) {
          throw new ConfigError(
            'HYT is not configured. Please run "hyt setup" first.'
          );
        }

        // Find project structure
        const cwd = process.cwd();
        
        // Try to locate Server directory and determine project root
        let serverDir: string | null = null;
        let projectDir: string | null = null;
        
        // Check if we're in project root with server/Server structure FIRST
        if (await directoryExists(path.join(cwd, 'server', 'Server'))) {
          projectDir = cwd;
          serverDir = path.join(cwd, 'server', 'Server');
        }
        // Check if we're in project root with Server directory
        else if (await directoryExists(path.join(cwd, 'Server'))) {
          projectDir = cwd;
          serverDir = path.join(cwd, 'Server');
        }
        // Check if we're in plugin directory
        else if (await directoryExists(path.join(cwd, 'app'))) {
          // We're in Server/Plugins/plugin-name/
          projectDir = path.resolve(cwd, '..', '..', '..');
          serverDir = path.resolve(cwd, '..', '..');
        }
        // Check if we're in Plugins directory
        else if (await directoryExists(path.join(cwd, '..', 'Server'))) {
          projectDir = path.resolve(cwd, '..', '..');
          serverDir = path.join(cwd, '..', 'Server');
        }
        // Check if we're in Server directory
        else if (await directoryExists(path.join(cwd, 'Plugins'))) {
          projectDir = path.resolve(cwd, '..');
          serverDir = cwd;
        }

        if (!serverDir || !projectDir) {
          throw new HytaleError(
            'Could not find Hytale server directory.\n' +
            'Run this command from your project root, Plugins directory, or plugin directory.'
          );
        }

        // Verify HytaleServer.jar exists
        const serverJarPath = path.join(serverDir, 'HytaleServer.jar');
        try {
          await fs.access(serverJarPath);
        } catch {
          throw new HytaleError(
            `HytaleServer.jar not found at: ${serverJarPath}\n` +
            'Make sure you ran "hyt init" to set up the project.'
          );
        }

        // Download decompiler if not present
        const decompilerFileName = `${decompiler}.jar`;
        const decompilerPath = path.join(serverDir, decompilerFileName);
        const decompilerUrl = decompiler === 'cfr' ? getCfrUrl() : getVineflowerUrl();
        const decompilerName = decompiler.toUpperCase();
        
        try {
          await fs.access(decompilerPath);
          info(`Using existing ${decompilerName} decompiler`);
        } catch {
          const downloadSpinner = startSpinner(`Downloading ${decompilerName} decompiler...`);
          try {
            await downloadFile(decompilerUrl, decompilerPath);
            downloadSpinner.succeed(`${decompilerName} decompiler downloaded`);
          } catch (err) {
            downloadSpinner.fail(`Failed to download ${decompilerName}`);
            throw new HytaleError(
              `Could not download ${decompilerName}: ${(err as Error).message}`
            );
          }
        }

        // Generate reference sources
        const srcRefDir = path.join(projectDir, 'src-ref');
        
        // Clear existing sources to ensure clean decompilation
        try {
          await fs.rm(srcRefDir, { recursive: true, force: true });
        } catch {
          // Directory doesn't exist yet, that's fine
        }
        
        await fs.mkdir(srcRefDir, { recursive: true });

        info('⏱️  This will take several minutes (typically 5-10 minutes)');
        info('💡 You can continue working in another terminal while this runs\n');

        const startTime = Date.now();
        const refSpinner = startSpinner('Generating reference sources...');

        // Update spinner text every second
        const timerInterval = setInterval(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const minutes = Math.floor(elapsed / 60);
          const seconds = elapsed % 60;
          const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
          refSpinner.text = `Generating reference sources... (${timeStr} elapsed)`;
        }, 1000);

        try {
          // CFR and Vineflower use different command-line arguments
          const decompileArgs = decompiler === 'cfr'
            ? ['-jar', decompilerPath, serverJarPath, '--outputdir', srcRefDir]
            : ['-jar', decompilerPath, serverJarPath, srcRefDir];
          
          await execa(config.javaPath, decompileArgs, {
            cwd: serverDir,
            stdio: 'pipe',
          });

          clearInterval(timerInterval);
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const minutes = Math.floor(elapsed / 60);
          const seconds = elapsed % 60;
          const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
          
          refSpinner.succeed(`Reference sources generated in ${timeStr}`);
          success(`\n✨ Reference sources available at: ${srcRefDir}`);
          console.log('\nYou can now explore the decompiled Hytale API to understand how to use it.\n');
        } catch (err) {
          clearInterval(timerInterval);
          refSpinner.fail('Failed to generate reference sources');
          throw new HytaleError(
            `${decompilerName} decompilation failed: ${(err as Error).message}`
          );
        }

        process.exit(0);

      } catch (err) {
        if (err instanceof ConfigError || err instanceof HytaleError) {
          error(err.message);
        } else {
          error(`Reference generation failed: ${(err as Error).message}`);
        }
        process.exit(1);
      }
    });
}
