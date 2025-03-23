import * as Sentry from '@sentry/react'
import platform from '../packages/platform'

;(async () => {

    try {
        const settings = await platform.getSettings()

        // ONLY enable Sentry when reporting and tracking is allowed by the user
        if (! settings.allowReportingAndTracking) {
            return
        }
    } catch(e) {
        if (typeof e  === 'string' && e.includes('not allowed on window main, webview main, allowed windows:')) {
            setTimeout(function() {
                location.reload()
            }, 1000);
            return;
        }
        console.log("azdim :",e)
        console.error(e)
    }
})()
