// @ts-nocheck
import { createApp } from '../server/app'

const appPromise = createApp()

export default async function handler(req: any, res: any) {
  const runtime = await appPromise
  return runtime.app(req, res)
}
