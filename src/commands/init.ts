import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import prompts from 'prompts';
import { Argv } from 'yargs';

import { logger } from '../logger';
import { CONFIG_FILE_NAME, findConfigFile, getConfigFileDir } from '../config';
import { TARGET_MAP } from '../targets';
import { BaseTarget } from '../targets/base';
import {
  DetectionContext,
  DetectionResult,
  fileExists,
  readJsonFile,
  readTextFile,
} from '../utils/detection';
import {
  generateCraftConfig,
  generateReleaseWorkflow,
  generateChangelogPreviewWorkflow,
  generatePublishWorkflow,
  TemplateContext,
  NodeSetup,
  PythonSetup,
} from '../utils/templates';
import { createGitClient } from '../utils/git';
import GitUrlParse from 'git-url-parse';
import { isDryRun, hasInput } from '../utils/helpers';

export const command = ['init'];
export const description = 'Initialize Craft configuration for a new project';

interface InitArgs {
  'skip-workflows'?: boolean;
  force?: boolean;
}

export const builder = (yargs: Argv) =>
  yargs
    .option('skip-workflows', {
      describe: 'Skip generating GitHub Actions workflow files',
      type: 'boolean',
      default: false,
    })
    .option('force', {
      describe: 'Overwrite existing files',
      type: 'boolean',
      default: false,
    });

/**
 * Detect GitHub repository information from git remote
 */
async function detectGitHubInfo(
  rootDir: string,
): Promise<{ owner: string; repo: string } | null> {
  try {
    const git = createGitClient(rootDir);
    const remotes = await git.getRemotes(true);
    const defaultRemote =
      remotes.find(remote => remote.name === 'origin') || remotes[0];

    if (!defaultRemote) {
      return null;
    }

    const remoteUrl = GitUrlParse(
      defaultRemote.refs.push || defaultRemote.refs.fetch,
    );

    if (remoteUrl?.source === 'github.com') {
      return {
        owner: remoteUrl.owner,
        repo: remoteUrl.name,
      };
    }
  } catch (error) {
    logger.debug('Error detecting GitHub info:', error);
  }

  return null;
}

/**
 * Detect Node.js project setup
 */
function detectNodeSetup(rootDir: string): NodeSetup | undefined {
  if (!fileExists(rootDir, 'package.json')) {
    return undefined;
  }

  const pkg = readJsonFile<{
    packageManager?: string;
    volta?: { node?: string };
    engines?: { node?: string };
  }>(rootDir, 'package.json');

  if (!pkg) {
    return undefined;
  }

  // Determine package manager
  let packageManager: 'npm' | 'pnpm' | 'yarn' = 'npm';
  let versionFile: string | undefined;

  if (pkg.packageManager?.startsWith('pnpm')) {
    packageManager = 'pnpm';
  } else if (pkg.packageManager?.startsWith('yarn')) {
    packageManager = 'yarn';
  } else if (fileExists(rootDir, 'pnpm-lock.yaml')) {
    packageManager = 'pnpm';
  } else if (fileExists(rootDir, 'yarn.lock')) {
    packageManager = 'yarn';
  }

  // Determine version file
  if (pkg.volta?.node) {
    versionFile = 'package.json';
  } else if (fileExists(rootDir, '.nvmrc')) {
    versionFile = '.nvmrc';
  } else if (fileExists(rootDir, '.node-version')) {
    versionFile = '.node-version';
  }

  return { packageManager, versionFile };
}

/**
 * Detect Python project setup
 */
function detectPythonSetup(rootDir: string): PythonSetup | undefined {
  // Check for Python version file
  if (fileExists(rootDir, '.python-version')) {
    const version = readTextFile(rootDir, '.python-version')?.trim();
    return { version };
  }

  // Check for pyproject.toml with version
  if (fileExists(rootDir, 'pyproject.toml')) {
    const content = readTextFile(rootDir, 'pyproject.toml');
    if (content) {
      // Try to extract requires-python
      const match = content.match(/requires-python\s*=\s*["']>=?(\d+\.\d+)/);
      if (match) {
        return { version: match[1] };
      }
    }
    return {}; // Python project detected but version not specified
  }

  if (fileExists(rootDir, 'setup.py')) {
    return {}; // Python project detected but version not specified
  }

  return undefined;
}

/**
 * Detect all applicable targets for the project
 */
async function detectTargets(
  context: DetectionContext,
): Promise<DetectionResult[]> {
  const results: DetectionResult[] = [];

  for (const [_name, TargetClass] of Object.entries(TARGET_MAP)) {
    // Check if the target class has a detect method
    if (typeof (TargetClass as typeof BaseTarget).detect === 'function') {
      try {
        const result = await (TargetClass as typeof BaseTarget).detect!(
          context,
        );
        if (result) {
          results.push(result);
        }
      } catch (error) {
        logger.debug(`Error detecting target ${_name}:`, error);
      }
    }
  }

  // Sort by priority (lower priority values first, GitHub last)
  results.sort((a, b) => a.priority - b.priority);

  return results;
}

/**
 * Format detected targets for display
 */
function formatDetectedTargets(results: DetectionResult[]): string {
  return results
    .map(r => {
      const extras = Object.entries(r.config)
        .filter(([k]) => k !== 'name')
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return extras
        ? `  - ${r.config.name} (${extras})`
        : `  - ${r.config.name}`;
    })
    .join('\n');
}

export async function handler(args: InitArgs = {}): Promise<void> {
  const rootDir = getConfigFileDir() || process.cwd();
  const existingConfig = findConfigFile();

  // Check for existing config
  if (existingConfig && !args.force) {
    logger.error(`Configuration file already exists: ${existingConfig}`);
    logger.info('Use --force to overwrite existing files');
    process.exitCode = 1;
    return;
  }

  logger.info('Detecting project type...');

  // Detect GitHub info
  const githubInfo = await detectGitHubInfo(rootDir);
  if (githubInfo) {
    logger.info(
      `✓ Found GitHub repository: ${githubInfo.owner}/${githubInfo.repo}`,
    );
  } else {
    logger.warn('Could not detect GitHub repository from git remote');
  }

  // Build detection context
  const context: DetectionContext = {
    rootDir,
    githubOwner: githubInfo?.owner,
    githubRepo: githubInfo?.repo,
  };

  // Detect targets
  const detectedTargets = await detectTargets(context);

  if (detectedTargets.length === 0) {
    logger.warn('No publishable targets detected');
    logger.info('You can manually configure targets in .craft.yml');
  } else {
    logger.info(`✓ Detected ${detectedTargets.length} target(s):`);
    console.log(formatDetectedTargets(detectedTargets));
  }

  // Detect Node.js setup
  const nodeSetup = detectNodeSetup(rootDir);
  if (nodeSetup) {
    logger.info(`✓ Detected Node.js project (${nodeSetup.packageManager})`);
  }

  // Detect Python setup
  const pythonSetup = detectPythonSetup(rootDir);
  if (pythonSetup) {
    logger.info(
      `✓ Detected Python project${pythonSetup.version ? ` (${pythonSetup.version})` : ''}`,
    );
  }

  // Build template context
  const templateContext: TemplateContext = {
    githubOwner: githubInfo?.owner || 'YOUR_ORG',
    githubRepo: githubInfo?.repo || 'YOUR_REPO',
    targets: detectedTargets.map(r => r.config),
    nodeSetup,
    pythonSetup,
  };

  // Generate config preview
  const craftConfig = generateCraftConfig(templateContext);

  console.log('\nProposed .craft.yml:');
  console.log('─'.repeat(40));
  console.log(craftConfig);
  console.log('─'.repeat(40));

  // Ask for confirmation
  if (hasInput() && !isDryRun()) {
    const { proceed } = await prompts({
      type: 'confirm',
      name: 'proceed',
      message: 'Create .craft.yml?',
      initial: true,
    });

    if (!proceed) {
      logger.info('Aborted');
      return;
    }
  }

  // Write .craft.yml
  const craftConfigPath = join(rootDir, CONFIG_FILE_NAME);
  if (isDryRun()) {
    logger.info(`[dry-run] Would create ${craftConfigPath}`);
  } else {
    writeFileSync(craftConfigPath, craftConfig);
    logger.info(`✓ Created ${craftConfigPath}`);
  }

  // Generate workflows
  if (!args['skip-workflows'] && githubInfo) {
    const workflowsDir = join(rootDir, '.github', 'workflows');

    // Ask for confirmation for workflows
    let createWorkflows = true;
    if (hasInput() && !isDryRun()) {
      const { proceed } = await prompts({
        type: 'confirm',
        name: 'proceed',
        message: 'Generate GitHub Actions workflows?',
        initial: true,
      });
      createWorkflows = proceed;
    }

    if (createWorkflows) {
      if (isDryRun()) {
        logger.info('[dry-run] Would create GitHub Actions workflows');
      } else {
        // Ensure workflows directory exists
        if (!existsSync(workflowsDir)) {
          mkdirSync(workflowsDir, { recursive: true });
        }

        // Generate release workflow
        const releaseWorkflow = generateReleaseWorkflow(templateContext);
        const releaseWorkflowPath = join(workflowsDir, 'release.yml');
        if (!existsSync(releaseWorkflowPath) || args.force) {
          writeFileSync(releaseWorkflowPath, releaseWorkflow);
          logger.info(`✓ Created ${releaseWorkflowPath}`);
        } else {
          logger.info(`Skipped ${releaseWorkflowPath} (already exists)`);
        }

        // Generate changelog preview workflow
        const changelogWorkflow = generateChangelogPreviewWorkflow();
        const changelogWorkflowPath = join(
          workflowsDir,
          'changelog-preview.yml',
        );
        if (!existsSync(changelogWorkflowPath) || args.force) {
          writeFileSync(changelogWorkflowPath, changelogWorkflow);
          logger.info(`✓ Created ${changelogWorkflowPath}`);
        } else {
          logger.info(`Skipped ${changelogWorkflowPath} (already exists)`);
        }

        // Generate publish workflow
        const publishWorkflow = generatePublishWorkflow(templateContext);
        const publishWorkflowPath = join(workflowsDir, 'publish.yml');
        if (!existsSync(publishWorkflowPath) || args.force) {
          writeFileSync(publishWorkflowPath, publishWorkflow);
          logger.info(`✓ Created ${publishWorkflowPath}`);
        } else {
          logger.info(`Skipped ${publishWorkflowPath} (already exists)`);
        }
      }
    }
  }

  logger.info('\nDone! Next steps:');
  logger.info('1. Review the generated configuration');
  logger.info('2. Set up required secrets in your GitHub repository:');

  // List required secrets based on detected targets
  const hasNpm = detectedTargets.some(t => t.config.name === 'npm');
  const hasPypi = detectedTargets.some(t => t.config.name === 'pypi');
  const hasCrates = detectedTargets.some(t => t.config.name === 'crates');

  logger.info(
    '   - GH_RELEASE_PAT: GitHub Personal Access Token with repo scope',
  );
  if (hasNpm) {
    logger.info('   - NPM_TOKEN: npm access token for publishing');
  }
  if (hasPypi) {
    logger.info('   - PYPI_TOKEN: PyPI API token for publishing');
  }
  if (hasCrates) {
    logger.info('   - CRATES_IO_TOKEN: crates.io API token for publishing');
  }

  logger.info('3. Run `craft validate` to verify your configuration');
}
