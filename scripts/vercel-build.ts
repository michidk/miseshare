export {}

const productionDeployment =
  process.env.VERCEL === '1' &&
  process.env.VERCEL_ENV === 'production' &&
  ['1', 'true'].includes(process.env.CI?.toLowerCase() ?? '')

if (productionDeployment) {
  console.log('Applying locked production database migrations before the Vercel build.')
  await run('db:migrate')
} else {
  console.log('Skipping production migrations outside a hosted Vercel production build.')
}

await run('build')

async function run(script: string) {
  const process = Bun.spawn(['bun', 'run', script], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`bun run ${script} exited with code ${exitCode}.`)
}
