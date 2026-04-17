let appPromise

module.exports = async function handler(req, res) {
  try {
    if (!appPromise) {
      const { createApp } = require('../build/server/app.js')
      appPromise = createApp()
    }
    const runtime = await appPromise
    return runtime.app(req, res)
  } catch (error) {
    console.error('Vercel function bootstrap failed', error)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({
      error: error && error.message ? error.message : 'Vercel function bootstrap failed'
    }))
  }
}
