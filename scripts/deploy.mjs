// Publishes dist/ to the gh-pages branch of the `origin` remote (GitHub Pages).
// Usage: npm run deploy
import { execSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' })
const remote = execSync('git remote get-url origin').toString().trim()
const sha = execSync('git rev-parse --short HEAD').toString().trim()

// Served from https://<user>.github.io/only-reader/
execSync('npm run build', { stdio: 'inherit', env: { ...process.env, BASE_PATH: '/only-reader/' } })

const dist = 'dist'
rmSync(`${dist}/.git`, { recursive: true, force: true }) // Vite keeps .git when emptying dist
writeFileSync(`${dist}/.nojekyll`, '') // keep files and folders that start with "_"
run('git init -q -b gh-pages', dist)
run('git add -A', dist)
run(`git commit -q -m "Deploy ${sha}"`, dist)
run(`git push -q -f ${remote} gh-pages`, dist)
console.log('Deployed to gh-pages.')
