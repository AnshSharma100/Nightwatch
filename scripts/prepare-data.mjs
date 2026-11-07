import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const local = resolve('.eog-reference')
const adjacent = resolve('../.eog-reference')
const source = process.argv[2] ? resolve(process.argv[2]) : existsSync(adjacent) ? adjacent : local
if (!existsSync(source) && source === local) {
  execFileSync('git', ['clone', '--depth', '1', 'https://github.com/nihaal419/HackUTD-ZeroDay', local], { stdio: 'inherit' })
}
const history = join(source, 'history')
const destination = resolve('public/practice')
const files = ['network.json', 'ops.json', 'telemetry.csv']
const names = readdirSync(history, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && files.every((file) => existsSync(join(history, entry.name, file))))
  .map((entry) => entry.name)
if (existsSync(join(source, 'test', 'telemetry.csv'))) names.push('test')
for (const name of names) {
  const from = name === 'test' ? join(source, 'test') : join(history, name)
  const to = join(destination, name)
  mkdirSync(to, { recursive: true })
  for (const file of files) copyFileSync(join(from, file), join(to, file))
}
writeFileSync(join(destination, 'index.json'), JSON.stringify(names))
console.log('Prepared practice datasets:', names.join(', '))
