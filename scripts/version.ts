import semver from 'semver'
import {readFile, } from 'fs/promises'
import {join} from 'path'
import inquirer from 'inquirer'
import { exec } from 'child_process'

const execAsync = (cmd: string) => {
    return new Promise((resolve) => {
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.warn(error)
        }
        resolve(stdout || stderr)
      })
    })
  }

const requireGitCleanState = async () => {
    const status = await execAsync('git status --porcelain')
    if (!!status) {
        console.error('\nError: Git must be in a clean state\n')
        return
    }   
}

export const run = async () => {
    const file = await readFile(join(process.cwd(), 'package.json'))
    const packageJson = JSON.parse(file.toString('utf-8'))
    const {name: pkgName, version: pkgVersion} = packageJson

    const nextVersion = semver.parse(pkgVersion)?.inc('patch').format()
    const log = ["", "Changes:", `- ${pkgName}: ${pkgVersion} => ${nextVersion}`, ""].join("\n")
    
    console.log(log)
    
    const confirm = await inquirer
    .prompt([
      {
        type: "expand",
        name: "confirm",
        message: 'Are you sure you want to release this version?',
        default: 2,
        choices: [
          { key: "y", name: "Yes", value: true },
          { key: "n", name: "No", value: false },
        ],
      },
    ])

    if (confirm) {
        await requireGitCleanState()
        const tag = `${pkgName}@${nextVersion}`
        await execAsync('npm version patch --no-git-tag-version')
        await execAsync(`git tag ${tag} -m ${tag}`)
        await execAsync(`git commit -am "Publish"`)
        const mainBranch = await execAsync('git rev-parse --abbrev-ref "HEAD"')
        await execAsync(`git push --follow-tags --no-verify --atomic origin ${mainBranch}`)
    }
}

void run()
