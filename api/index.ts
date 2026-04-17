// @ts-nocheck
import { createApp } from '../server/app'

const appPromise = createApp()

export default async function handler(req: any, res: any) {
  try {
    const runtime = await appPromise
    return runtime.app(req, res)
  } catch (error: any) {
    console.error('Vercel function bootstrap failed', error)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({
      error: error?.message || 'Vercel function bootstrap failed'
    }))
  }
}
