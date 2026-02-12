import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { Argv } from 'yargs';

import { logger } from '../logger';
import {
  CONFIG_FILE_NAME,
  SMART_DEFAULTS_MIN_VERSION,
  findConfigFile,
  getConfigFileDir,
  validateConfiguration,
} from '../config';
import { getAllTargetNames } from '../targets';
import { stringToRegexp } from '../utils/filters';
import { ConfigurationError } from '../utils/errors';
import { parseVersion, versionGreaterOrEqualThan } from '../utils/version';

export const command = ['validate'];
export const description = 'Validate Craft configuration and workflows';

interface ValidateArgs {
  'skip-workflows'?: boolean;
}

export const builder = (yargs: Argv) =>
  yargs.option('skip-workflows', {
    describe: 'Skip validating GitHub Actions workflow files',
    type: 'boolean',
    default: false,
  });

interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
}

/**
 * Validate the .craft.yml configuration file
 */
function validateCraftConfig(configPath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Read raw config
  let rawConfig: Record<string, unknown>;
  try {
    const content = readFileSync(configPath, 'utf-8');
    rawConfig = load(content) as Record<string, unknown>;
  } catch (error) {
    issues.push({
      level: 'error',
      message: `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      file: configPath,
    });
    return issues;
  }

  // Validate schema
  try {
    validateConfiguration(rawConfig);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      issues.push({
        level: 'error',
        message: error.message,
        file: configPath,
      });
      return issues;
    }
    throw error;
  }

  // Validate targets
  const validTargetNames = new Set(getAllTargetNames());
  const targets =
    (rawConfig.targets as Array<{ name: string; id?: string }>) || [];
  const seenIds = new Set<string>();

  for (const target of targets) {
    if (!target.name) {
      issues.push({
        level: 'error',
        message: 'Target missing required "name" field',
        file: configPath,
      });
      continue;
    }

    if (!validTargetNames.has(target.name)) {
      issues.push({
        level: 'error',
        message: `Unknown target "${target.name}". Valid targets: ${Array.from(validTargetNames).join(', ')}`,
        file: configPath,
      });
    }

    // Check for duplicate IDs
    const id = target.id || target.name;
    if (seenIds.has(id)) {
      issues.push({
        level: 'error',
        message: `Duplicate target ID "${id}". Use the "id" field to distinguish multiple targets of the same type.`,
        file: configPath,
      });
    }
    seenIds.add(id);
  }

  // Validate regex patterns
  const regexFields = ['includeNames', 'excludeNames'] as const;
  for (const target of targets) {
    for (const field of regexFields) {
      const value = target[field as keyof typeof target];
      if (typeof value === 'string') {
        try {
          stringToRegexp(value);
        } catch {
          issues.push({
            level: 'error',
            message: `Invalid regex pattern in target "${target.name}": ${field}="${value}"`,
            file: configPath,
          });
        }
      }
    }
  }

  // Validate requireNames patterns
  const requireNames = rawConfig.requireNames as string[] | undefined;
  if (requireNames) {
    for (const pattern of requireNames) {
      try {
        stringToRegexp(pattern);
      } catch {
        issues.push({
          level: 'error',
          message: `Invalid regex pattern in requireNames: "${pattern}"`,
          file: configPath,
        });
      }
    }
  }

  // Check for deprecated fields
  if (rawConfig.changelogPolicy !== undefined) {
    issues.push({
      level: 'warning',
      message:
        'The "changelogPolicy" field is deprecated. Use "changelog.policy" instead.',
      file: configPath,
    });
  }

  // Recommend minVersion >= SMART_DEFAULTS_MIN_VERSION for smart defaults
  const minVersion = rawConfig.minVersion as string | undefined;
  if (!minVersion) {
    issues.push({
      level: 'warning',
      message: `Consider adding minVersion: "${SMART_DEFAULTS_MIN_VERSION}" to enable smart defaults`,
      file: configPath,
    });
  } else {
    const parsedMinVersion = parseVersion(minVersion);
    const parsedSmartDefaultsVersion = parseVersion(SMART_DEFAULTS_MIN_VERSION);
    if (
      parsedMinVersion &&
      parsedSmartDefaultsVersion &&
      !versionGreaterOrEqualThan(parsedMinVersion, parsedSmartDefaultsVersion)
    ) {
      issues.push({
        level: 'warning',
        message: `Consider updating minVersion to "${SMART_DEFAULTS_MIN_VERSION}" or later for smart defaults`,
        file: configPath,
      });
    }
  }

  return issues;
}

/**
 * Validate GitHub Actions workflow files
 *
 * Scans all workflow files and validates those that use the Craft action.
 */
function validateWorkflows(rootDir: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const workflowsDir = join(rootDir, '.github', 'workflows');

  if (!existsSync(workflowsDir)) {
    issues.push({
      level: 'warning',
      message:
        'No .github/workflows directory found. Consider running `craft init` to generate workflows.',
    });
    return issues;
  }

  // Scan all workflow files
  let workflowFiles: string[];
  try {
    workflowFiles = readdirSync(workflowsDir).filter(
      f => f.endsWith('.yml') || f.endsWith('.yaml'),
    );
  } catch {
    issues.push({
      level: 'error',
      message: 'Failed to read workflows directory',
      file: workflowsDir,
    });
    return issues;
  }

  if (workflowFiles.length === 0) {
    issues.push({
      level: 'warning',
      message:
        'No workflow files found. Consider running `craft init` to generate workflows.',
      file: workflowsDir,
    });
    return issues;
  }

  // Validate each workflow that uses Craft
  let craftWorkflowCount = 0;
  for (const file of workflowFiles) {
    const filePath = join(workflowsDir, file);
    const workflowIssues = validateCraftWorkflow(filePath);

    // Only count and report issues for workflows that use Craft
    if (workflowIssues.usesCraft) {
      craftWorkflowCount++;
      issues.push(...workflowIssues.issues);
    }
  }

  if (craftWorkflowCount === 0) {
    issues.push({
      level: 'warning',
      message:
        'No workflows using getsentry/craft action found. Consider running `craft init` to generate workflows.',
      file: workflowsDir,
    });
  }

  return issues;
}

/**
 * Validate a workflow file that may use Craft
 */
function validateCraftWorkflow(filePath: string): {
  usesCraft: boolean;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
    // Parse to validate YAML syntax
    load(content);
  } catch {
    // If we can't parse the file, skip it (might not be a valid YAML)
    return { usesCraft: false, issues: [] };
  }

  // Check if this workflow uses Craft
  const usesCraft = content.includes('getsentry/craft');
  if (!usesCraft) {
    return { usesCraft: false, issues: [] };
  }

  // Check if workflow uses reusable workflow vs composite action
  const usesReusableWorkflow = content.includes(
    'getsentry/craft/.github/workflows/',
  );
  const usesCompositeAction = /uses:\s*['"]?getsentry\/craft@/.test(content);

  // If only using reusable workflow (e.g., changelog-preview.yml), skip validation
  // Reusable workflows are self-contained and handle their own checkout
  if (usesReusableWorkflow && !usesCompositeAction) {
    return { usesCraft: true, issues: [] };
  }

  // Check for proper checkout with fetch-depth (only for composite action usage)
  const hasFetchDepth =
    content.includes('fetch-depth: 0') || content.includes('fetch-depth: "0"');
  if (!hasFetchDepth) {
    issues.push({
      level: 'warning',
      message:
        'Checkout step should use "fetch-depth: 0" for Craft to access full git history',
      file: filePath,
    });
  }

  return { usesCraft: true, issues };
}

export async function handler(args: ValidateArgs = {}): Promise<void> {
  const configPath = findConfigFile();

  if (!configPath) {
    logger.error(
      `No ${CONFIG_FILE_NAME} found. Run \`craft init\` to create one.`,
    );
    process.exitCode = 1;
    return;
  }

  const rootDir = getConfigFileDir() || process.cwd();
  const issues: ValidationIssue[] = [];

  logger.info(`Validating ${configPath}...`);
  issues.push(...validateCraftConfig(configPath));

  if (!args['skip-workflows']) {
    logger.info('Validating GitHub workflows...');
    issues.push(...validateWorkflows(rootDir));
  }

  // Report results
  const errors = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warning');

  console.log('');

  if (errors.length > 0) {
    console.log('Errors:');
    for (const issue of errors) {
      const location = issue.file
        ? issue.line
          ? `${issue.file}:${issue.line}`
          : issue.file
        : '';
      console.log(`  ✗ ${issue.message}${location ? ` (${location})` : ''}`);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const issue of warnings) {
      const location = issue.file
        ? issue.line
          ? `${issue.file}:${issue.line}`
          : issue.file
        : '';
      console.log(`  ⚠ ${issue.message}${location ? ` (${location})` : ''}`);
    }
    console.log('');
  }

  // Summary
  if (errors.length === 0 && warnings.length === 0) {
    logger.info('✓ Configuration is valid');
  } else {
    logger.info(
      `Found ${errors.length} error(s) and ${warnings.length} warning(s)`,
    );
  }

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}
