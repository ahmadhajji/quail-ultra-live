// @ts-nocheck
import { createApp } from './app'

async function bootstrap() {
  const runtime = await createApp()
  runtime.app.listen(runtime.port, function started() {
    console.log(`Quail Ultra Live listening on http://localhost:${runtime.port}`)
    console.log(`Primary routes: ${runtime.routes.studyPacks}, ${runtime.routes.overview}, ${runtime.routes.newblock}`)
  })
}

bootstrap().catch(function onBootstrapError(error: any) {
  console.error(error)
  process.exit(1)
})
