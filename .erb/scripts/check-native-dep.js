import fs from 'fs'
import chalk from 'chalk'
import { execSync } from 'child_process'
import path from 'path'
import { dependencies } from '../../package.json'

// Helper function to recursively find .node files in a directory
function findNodeFiles(dir) {
    const nodeFiles = []
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                // Only search in common subdirectories to avoid performance issues
                if (['build', 'prebuilds', 'lib', 'bin'].includes(entry.name)) {
                    nodeFiles.push(...findNodeFiles(fullPath))
                }
            } else if (entry.isFile() && entry.name.endsWith('.node')) {
                nodeFiles.push(fullPath)
            }
        }
    } catch (e) {
        // Ignore permission errors or missing directories
    }
    return nodeFiles
}

if (dependencies) {
    const dependenciesKeys = Object.keys(dependencies)
    
    // Packages to exclude from native dependency check
    const excludePackages = ['capacitor-stream-http'] // Capacitor plugins are not native Electron dependencies
    
    // Check for packages with binding.gyp (source-based native modules)
    const nativeDepsByBindingGyp = fs
        .readdirSync('node_modules')
        .filter((folder) => !excludePackages.includes(folder) && fs.existsSync(`node_modules/${folder}/binding.gyp`))
    
    // Check for packages with .node files (precompiled native modules)
    const nativeDepsByNodeFiles = fs
        .readdirSync('node_modules')
        .filter((folder) => {
            if (excludePackages.includes(folder)) return false
            const nodeFiles = findNodeFiles(`node_modules/${folder}`)
            return nodeFiles.length > 0
        })
    
    // Combine both types of native dependencies
    const allNativeDeps = [...new Set([...nativeDepsByBindingGyp, ...nativeDepsByNodeFiles])]
    
    if (allNativeDeps.length === 0) {
        process.exit(0)
    }
    
    console.debug(chalk.blue(`Found native dependencies: ${allNativeDeps.join(', ')}`))
    console.debug(chalk.gray(`- With binding.gyp: ${nativeDepsByBindingGyp.join(', ') || 'none'}`))
    console.debug(chalk.gray(`- With .node files: ${nativeDepsByNodeFiles.join(', ') || 'none'}`))
    
    try {
        // Find the reason for why the dependency is installed. If it is installed
        // because of a devDependency then that is okay. Warn when it is installed
        // because of a dependency
        const { dependencies: dependenciesObject } = JSON.parse(
            execSync(`npm ls ${allNativeDeps.join(' ')} --json`).toString()
        )
        const rootDependencies = Object.keys(dependenciesObject)
        const filteredRootDependencies = rootDependencies.filter((rootDependency) =>
            dependenciesKeys.includes(rootDependency) && !excludePackages.includes(rootDependency)
        )
        if (filteredRootDependencies.length > 0) {
            const plural = filteredRootDependencies.length > 1
            console.log(`
 ${chalk.whiteBright.bgYellow.bold('Webpack does not work with native dependencies.')}
${chalk.bold(filteredRootDependencies.join(', '))} ${
                plural ? 'are native dependencies' : 'is a native dependency'
            } and should be installed inside of the "./release/app" folder.
 First, uninstall the packages from "./package.json":
${chalk.whiteBright.bgGreen.bold('npm uninstall your-package')}
 ${chalk.bold('Then, instead of installing the package to the root "./package.json":')}
${chalk.whiteBright.bgRed.bold('npm install your-package')}
 ${chalk.bold('Install the package to "./release/app/package.json"')}
${chalk.whiteBright.bgGreen.bold('cd ./release/app && npm install your-package')}
 Read more about native dependencies at:
${chalk.bold('https://electron-react-boilerplate.js.org/docs/adding-dependencies/#module-structure')}
 `)
            process.exit(1)
        }
    } catch (e) {
        console.log('Native dependencies could not be checked')
    }
}
