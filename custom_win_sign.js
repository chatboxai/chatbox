const { execSync } = require('node:child_process')

exports.default = async configuration => {
  if (!process.env.SM_API_KEY) {
    console.info(`Skip signing because SM_API_KEY and  not configured`)
    return
  }

  if (!configuration.path) {
    throw new Error(`Path of application is not found`)
  }

  execSync(`smctl sign --keypair-alias="${process.env.SM_KEYPAIR_NAME}" --input "${String(configuration.path)}"`, {
    stdio: 'inherit',
  })
}
