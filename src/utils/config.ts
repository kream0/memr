import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { Config } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';

let cachedConfig: Config | null = null;
let configPath: string | null = null;

export function getConfigPath(projectDir?: string): string {
  if (configPath) return configPath;

  const baseDir = projectDir || process.cwd();
  configPath = join(baseDir, '.memorai', 'config.json');
  return configPath;
}

export function getDataDir(projectDir?: string): string {
  const baseDir = projectDir || process.cwd();
  return join(baseDir, '.memorai');
}

export function loadConfig(projectDir?: string): Config {
  if (cachedConfig) return cachedConfig;

  const path = getConfigPath(projectDir);

  let config: Config;
  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8');
      config = { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } catch {
      config = { ...DEFAULT_CONFIG };
    }
  } else {
    config = { ...DEFAULT_CONFIG };
  }

  // Override with environment variables
  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  }

  config.dataDir = getDataDir(projectDir);
  cachedConfig = config;

  return config;
}

export function saveConfig(config: Partial<Config>, projectDir?: string): void {
  const path = getConfigPath(projectDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const current = loadConfig(projectDir);
  const updated = { ...current, ...config };

  // Don't save sensitive data or computed paths
  const { anthropicApiKey, dataDir, ...toSave } = updated;

  writeFileSync(path, JSON.stringify(toSave, null, 2));
  cachedConfig = updated;
}

export function ensureDataDir(projectDir?: string): string {
  const dataDir = getDataDir(projectDir);

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Create subdirectories
  const chromaDir = join(dataDir, 'chroma');
  if (!existsSync(chromaDir)) {
    mkdirSync(chromaDir, { recursive: true });
  }

  return dataDir;
}

export function resetConfig(): void {
  cachedConfig = null;
  configPath = null;
}
