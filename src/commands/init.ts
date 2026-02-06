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
  RequiredSecret,
  WorkflowSetup,
} from '../utils/detection';
import {
  generateCraftConfig,
  generateReleaseWorkflow,
  generateChangelogPreviewWorkflow,
  TemplateContext,
} from '../utils/templates';
import { createGitClient, getGitHubInfoFromRemote } from '../utils/git';
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
  const git = createGitClient(rootDir);
  const githubInfo = await getGitHubInfoFromRemote(git);
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

  // Aggregate workflow setup from detected targets
  const workflowSetup: WorkflowSetup = {};
  for (const target of detectedTargets) {
    if (target.workflowSetup?.node && !workflowSetup.node) {
      workflowSetup.node = target.workflowSetup.node;
      logger.info(
        `✓ Detected Node.js project (${workflowSetup.node.packageManager})`,
      );
    }
    if (target.workflowSetup?.python && !workflowSetup.python) {
      workflowSetup.python = target.workflowSetup.python;
      logger.info(
        `✓ Detected Python project${workflowSetup.python.version ? ` (${workflowSetup.python.version})` : ''}`,
      );
    }
  }

  // Aggregate required secrets from detected targets
  const requiredSecrets: RequiredSecret[] = [];
  const seenSecrets = new Set<string>();
  for (const target of detectedTargets) {
    for (const secret of target.requiredSecrets || []) {
      if (!seenSecrets.has(secret.name)) {
        seenSecrets.add(secret.name);
        requiredSecrets.push(secret);
      }
    }
  }

  // Build template context
  const templateContext: TemplateContext = {
    githubOwner: githubInfo?.owner || 'YOUR_ORG',
    githubRepo: githubInfo?.repo || 'YOUR_REPO',
    targets: detectedTargets.map(r => r.config),
    workflowSetup:
      workflowSetup.node || workflowSetup.python ? workflowSetup : undefined,
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
      }
    }
  }

  logger.info('\nDone! Next steps:');
  logger.info('1. Review the generated configuration');
  if (requiredSecrets.length > 0) {
    logger.info('2. Set up required secrets in your GitHub repository:');
    for (const secret of requiredSecrets) {
      logger.info(`   - ${secret.name}: ${secret.description}`);
    }
    logger.info(
      '3. Configure publishing in your publish repository (see docs for details)',
    );
    logger.info('4. Run `craft validate` to verify your configuration');
  } else {
    logger.info(
      '2. Configure publishing in your publish repository (see docs for details)',
    );
    logger.info('3. Run `craft validate` to verify your configuration');
  }
}
