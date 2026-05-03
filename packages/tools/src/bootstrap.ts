import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { Tool, ToolContext, Progress } from '@pocket/core'
import { execInContainer, ensureContainer } from './sandbox.js'

const execAsync = promisify(exec)

const bootstrapInput = z.object({})

type BootstrapInput = z.infer<typeof bootstrapInput>

interface ProjectScripts {
  dev?: string
  build?: string
  start?: string
  test?: string
  lint?: string
  [key: string]: string | undefined
}

interface ConfigFiles {
  hasVite: boolean
  hasNextjs: boolean
  hasReact: boolean
  hasVue: boolean
  hasSvelte: boolean
  hasExpress: boolean
  hasFastapi: boolean
  hasDjango: boolean
  hasFlask: boolean
  hasRails: boolean
  hasLaravel: boolean
  hasNestjs: boolean
  hasRemix: boolean
}

interface Ports {
  dev: number
  suggested: number[]
}

interface InstallResult {
  success: boolean
  output: string
}

interface BootstrapResult {
  detected: {
    projectType: 'node' | 'python' | 'rust' | 'go' | 'unknown'
    packageManager: string | null
    languageVersion?: string
  }
  scripts: ProjectScripts
  configFiles: ConfigFiles
  ports: Ports
  install: InstallResult
  warnings: string[]
}

function detectProjectType(rootPath: string): { type: string; packageManager: string | null; lockFile: string | null } {
  if (fs.existsSync(path.join(rootPath, 'package.json'))) {
    if (fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) {
      return { type: 'node', packageManager: 'pnpm', lockFile: 'pnpm-lock.yaml' }
    }
    if (fs.existsSync(path.join(rootPath, 'yarn.lock'))) {
      return { type: 'node', packageManager: 'yarn', lockFile: 'yarn.lock' }
    }
    if (fs.existsSync(path.join(rootPath, 'package-lock.json'))) {
      return { type: 'node', packageManager: 'npm', lockFile: 'package-lock.json' }
    }
    return { type: 'node', packageManager: 'npm', lockFile: null }
  }
  if (fs.existsSync(path.join(rootPath, 'requirements.txt')) || fs.existsSync(path.join(rootPath, 'pyproject.toml'))) {
    return { type: 'python', packageManager: 'pip', lockFile: null }
  }
  if (fs.existsSync(path.join(rootPath, 'Cargo.toml'))) {
    return { type: 'rust', packageManager: 'cargo', lockFile: 'Cargo.lock' }
  }
  if (fs.existsSync(path.join(rootPath, 'go.mod'))) {
    return { type: 'go', packageManager: 'go', lockFile: null }
  }
  if (fs.existsSync(path.join(rootPath, 'Pipfile'))) {
    return { type: 'python', packageManager: 'pipenv', lockFile: 'Pipfile.lock' }
  }
  return { type: 'unknown', packageManager: null, lockFile: null }
}

function detectConfigFiles(rootPath: string): ConfigFiles {
  const configFiles: ConfigFiles = {
    hasVite: false,
    hasNextjs: false,
    hasReact: false,
    hasVue: false,
    hasSvelte: false,
    hasExpress: false,
    hasFastapi: false,
    hasDjango: false,
    hasFlask: false,
    hasRails: false,
    hasLaravel: false,
    hasNestjs: false,
    hasRemix: false,
  }

  const packageJsonPath = path.join(rootPath, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }

      configFiles.hasReact = !!deps.react
      configFiles.hasVue = !!deps.vue
      configFiles.hasSvelte = !!deps.svelte
      configFiles.hasExpress = !!deps.express
      configFiles.hasNestjs = !!deps['@nestjs/core']
      configFiles.hasNextjs = !!deps.next
      configFiles.hasRemix = !!deps['@remix-run/node']

      const scripts = pkg.scripts || {}
      const vites = ['vite', 'vite-plugin-react', 'vite-plugin-vue']
      configFiles.hasVite = vites.some(v => deps[v]) || Object.values(scripts).some(s => String(s).includes('vite'))
    } catch {}
  }

  const pyprojectPath = path.join(rootPath, 'pyproject.toml')
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8')
      configFiles.hasFastapi = content.includes('fastapi')
      configFiles.hasFlask = content.includes('flask')
      configFiles.hasDjango = content.includes('django')
    } catch {}
  }

  if (fs.existsSync(path.join(rootPath, 'requirements.txt'))) {
    const content = fs.readFileSync(path.join(rootPath, 'requirements.txt'), 'utf-8').toLowerCase()
    configFiles.hasFastapi = content.includes('fastapi')
    configFiles.hasFlask = content.includes('flask')
    configFiles.hasDjango = content.includes('django')
  }

  configFiles.hasRails = fs.existsSync(path.join(rootPath, 'Gemfile')) && fs.readFileSync(path.join(rootPath, 'Gemfile'), 'utf-8').includes('rails')
  configFiles.hasLaravel = fs.existsSync(path.join(rootPath, 'composer.json')) && fs.readFileSync(path.join(rootPath, 'composer.json'), 'utf-8').includes('laravel/framework')

  return configFiles
}

function detectScripts(rootPath: string, projectType: string): ProjectScripts {
  const scripts: ProjectScripts = {}

  if (projectType === 'node') {
    const pkgPath = path.join(rootPath, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        Object.assign(scripts, pkg.scripts || {})
      } catch {}
    }
  }

  return scripts
}

function detectPorts(rootPath: string, scripts: ProjectScripts, configFiles: ConfigFiles): Ports {
  const suggested: number[] = []

  if (configFiles.hasVite || configFiles.hasNextjs) {
    suggested.push(5173, 3000)
  }
  if (configFiles.hasExpress || configFiles.hasNestjs || configFiles.hasRemix) {
    suggested.push(3000)
  }
  if (configFiles.hasFastapi || configFiles.hasFlask || configFiles.hasDjango) {
    suggested.push(8000, 5000)
  }
  if (configFiles.hasRails || configFiles.hasLaravel) {
    suggested.push(3000)
  }

  const scriptValues = Object.values(scripts).filter(Boolean)
  const portMatch = scriptValues.join(' ').match(/(?:PORT|port)=(\d+)/i)
  if (portMatch) {
    suggested.unshift(parseInt(portMatch[1], 10))
  }

  const uniquePorts = [...new Set(suggested)].slice(0, 5)
  const devPort = uniquePorts[0] || 3000

  return { dev: devPort, suggested: uniquePorts }
}

async function runInstall(
  rootPath: string,
  projectType: string,
  packageManager: string | null,
  sandboxImage: string | null,
  sessionId: string,
): Promise<InstallResult> {
  if (!packageManager || projectType === 'unknown') {
    return { success: false, output: 'No package manager detected' }
  }

  const warnings: string[] = []
  let installCmd: string
  let installArgs: string[]

  switch (packageManager) {
    case 'pnpm':
      installCmd = 'pnpm'
      installArgs = ['install']
      break
    case 'yarn':
      installCmd = 'yarn'
      installArgs = ['install']
      break
    case 'npm':
      installCmd = 'npm'
      installArgs = ['install']
      break
    case 'pip':
      installCmd = 'pip'
      installArgs = ['install', '-r', 'requirements.txt']
      if (!fs.existsSync(path.join(rootPath, 'requirements.txt'))) {
        installArgs = ['install', '.']
      }
      break
    case 'pipenv':
      installCmd = 'pipenv'
      installArgs = ['install']
      break
    case 'cargo':
      return { success: true, output: 'Cargo does not require separate install (dependencies fetched on build)' }
    case 'go':
      return { success: true, output: 'Go modules auto-fetch on build' }
    default:
      return { success: false, output: `Unknown package manager: ${packageManager}` }
  }

  try {
    if (sandboxImage) {
      const containerName = await ensureContainer(sessionId, sandboxImage, rootPath)
      const result = await execInContainer(containerName, `cd "${rootPath}" && ${installCmd} ${installArgs.join(' ')}`, { timeout: 600000 })
      return {
        success: result.exitCode === 0,
        output: result.stdout + result.stderr,
      }
    } else {
      const { stdout, stderr } = await execAsync(`${installCmd} ${installArgs.join(' ')}`, {
        cwd: rootPath,
        timeout: 600000,
      })
      return { success: true, output: stdout + stderr }
    }
  } catch (error: any) {
    return {
      success: false,
      output: error.message || 'Install failed',
    }
  }
}

function detectLanguageVersion(rootPath: string, projectType: string): string | undefined {
  if (projectType === 'node') {
    const pkgPath = path.join(rootPath, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        return pkg.engines?.node
      } catch {}
    }
  }
  return undefined
}

export const bootstrapRepoTool: Tool<BootstrapInput, BootstrapResult> = {
  name: 'bootstrap_repo',
  description: 'Analyze and set up the cloned repository. Detects project type, package manager, available scripts, config files, and installs dependencies. Use this after cloning to understand the repo structure.',
  inputSchema: bootstrapInput,
  isReadOnly: true,
  defaultPermission: 'allow',

  async *call(_input: BootstrapInput, ctx: ToolContext): AsyncGenerator<Progress, BootstrapResult> {
    yield { type: 'progress', message: 'Analyzing repository...' }

    const rootPath = ctx.workspaceRoot
    const warnings: string[] = []

    if (!fs.existsSync(rootPath)) {
      throw new Error(`Workspace not found: ${rootPath}`)
    }

    const { type: projectType, packageManager, lockFile } = detectProjectType(rootPath)
    yield { type: 'progress', message: `Detected: ${projectType} project with ${packageManager || 'no'} package manager` }

    if (!packageManager) {
      warnings.push('No package manager detected. Manual setup may be required.')
    }

    const configFiles = detectConfigFiles(rootPath)
    const configDesc = Object.entries(configFiles).filter(([_, v]) => v).map(([k]) => k).join(', ')
    if (configDesc) {
      yield { type: 'progress', message: `Config detected: ${configDesc}` }
    }

    const scripts = detectScripts(rootPath, projectType)
    const scriptNames = Object.keys(scripts)
    if (scriptNames.length > 0) {
      yield { type: 'progress', message: `Scripts found: ${scriptNames.join(', ')}` }
    }

    const ports = detectPorts(rootPath, scripts, configFiles)
    yield { type: 'progress', message: `Dev server port: ${ports.dev}` }

    const languageVersion = detectLanguageVersion(rootPath, projectType)

    yield { type: 'progress', message: `Installing dependencies (${packageManager})...` }
    const install = await runInstall(rootPath, projectType, packageManager, ctx.sandboxImage, ctx.sessionId)

    if (install.success) {
      yield { type: 'progress', message: 'Dependencies installed successfully' }
    } else {
      warnings.push(`Dependency install failed: ${install.output.slice(0, 200)}`)
      yield { type: 'progress', message: `Install issue: ${install.output.slice(0, 100)}...` }
    }

    return {
      detected: {
        projectType: projectType as BootstrapResult['detected']['projectType'],
        packageManager,
        languageVersion,
      },
      scripts,
      configFiles,
      ports,
      install,
      warnings,
    }
  },
}