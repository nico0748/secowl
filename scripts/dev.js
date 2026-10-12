import { spawn } from 'node:child_process'

const procs = [
  spawn('node', ['server/index.js'], { stdio: 'inherit', shell: false }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: false }),
]
const stop = () => procs.forEach((p) => p.kill('SIGINT'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
procs.forEach((p) => p.on('exit', (code) => { stop(); process.exit(code ?? 0) }))
