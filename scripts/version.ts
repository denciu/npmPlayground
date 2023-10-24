import semver from 'semver'
import {readFile, } from 'fs/promises'
import {join} from 'path'
import inquirer from 'inquirer'
import { exec } from 'child_process'
import fetch from 'node-fetch'

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

const setupEnv = async () => {
    const packageJsonBuffer = await readFile(join(process.cwd(), 'package.json'))
    const packageJson = JSON.parse(packageJsonBuffer.toString('utf-8'))
    
    const pkgName = packageJson?.name
    const previousVersion = packageJson?.version

    if (!pkgName || !previousVersion) {
        console.error(`Error: Couldn't get package.json`)
        return null
    }

    const branch = await execAsync('git rev-parse --abbrev-ref "HEAD"')

    if (!branch) {
        console.error(`Error: Couldn't get HEAD branch`)
        return null
    }

    const nextVersion = semver.parse(previousVersion)?.inc('patch').format()
    const previousTag = `${pkgName}@${previousVersion}`
    const nextTag = `${pkgName}@${nextVersion}`

    const remoteUrl = await execAsync('git config --get remote.origin.url')
    if (!remoteUrl) {
        console.error(`Error: Remote 'origin' url not set`)
        return null
    }
    
    const repoUrlArr = /(?<=github.com[:|/]).*(?=\.git)/.exec(remoteUrl as string)

    if (repoUrlArr?.length !== 1) {
        console.error(`Error: Couldn't identify repo owner/name`)
        return null
    }

    const repoUrl = repoUrlArr[0]
    
    const npmrc = await execAsync('cat ~/.npmrc') as string
    const token = npmrc.slice(npmrc.indexOf('ghp_'), npmrc.indexOf('ghp_') + 40);

    if (!/^ghp_[A-Za-z0-9]{36}$/.test(token)) {
        console.error(`Error: Couldn't get Github token from .npmrc`)
        return null
    }

    return {
        pkgName, 
        previousVersion,
        previousTag, 
        nextVersion, 
        nextTag, 
        branch,
        token,
        repoUrl
    }
}

export const run = async () => {
    const env = await setupEnv()

    if (!env) return

    const {
        branch, 
        previousVersion, 
        nextVersion, 
        previousTag, 
        nextTag, 
        pkgName, 
        repoUrl, 
        token
    } = env
    
    const log = ["", "Changes:", `- ${pkgName}: ${previousVersion} => ${nextVersion}`, ""].join("\n")
    
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

    const releaseDescription = [
        `## [1.0.2](https://github.com/${repoUrl}/compare/${previousTag}...${nextTag}) (${new Date().toISOString().split('T')[0]})`, 
        `**Note:** Version bump only for package ${pkgName}`
    ].join('\n')

    if (confirm) {
        const status = await execAsync('git status --porcelain')
        if (!!status) {
            console.error('\nError: Git must be in a clean state\n')
            return
        } 
        await execAsync('npm version patch --no-git-tag-version')
        await execAsync(`git tag ${nextTag} -m ${nextTag}`)
        await execAsync(`git commit -am "Publish"`)
        
        await execAsync(`git push --follow-tags --no-verify --atomic origin ${branch}`)
    
        try {
            const res = await fetch(`https://api.github.com/repos/${repoUrl}/releases`, {
                method: 'POST',
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${token}`,
                    "X-GitHub-Api-Version": "2022-11-28"
                },
                body: JSON.stringify({
                    "tag_name":nextTag,
                    "target_commitish":branch,
                    "name":nextTag,
                    "body": releaseDescription,
                    "draft":false,
                    "prerelease":false,
                    "generate_release_notes":false
                })
            })

            if (!res.ok) {
                console.error(await res.json())
                console.error('\n' + 'Error: Release failed. You may need to make a release by your own through Github')
            }
            
        } catch(err) {
            console.error(err)
            console.error('\n' + 'Error: Release failed. You may need to make a release by your own through Github')
        }
        
    }
}

void run()
