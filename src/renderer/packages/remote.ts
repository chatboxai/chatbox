import {
    Config,
    CopilotDetail,
    SponsorAboutBanner,
    SponsorAd,
    RemoteConfig,
    ChatboxAILicenseDetail,
    Settings,
} from '../../shared/types'
import { ofetch } from 'ofetch'

export const API_ORIGIN = 'https://chatboxai.app'


export async function checkNeedUpdate(version: string, os: string, config: Config, settings: Settings) {
    // type Response = {
    //     need_update?: boolean
    // }
    // const res = await ofetch<Response>(`${API_ORIGIN}/ce/chatbox_need_update/${version}`, {
    //     method: 'POST',
    //     retry: 3,
    //     body: {
    //         uuid: config.uuid,
    //         os: os,
    //         allowReportingAndTracking: settings.allowReportingAndTracking ? 1 : 0,
    //     },
    // })
    // return !!res['need_update']
    return // next update the new version to github
}

export async function listCopilots(lang: string) {
    type Response = {
        data: CopilotDetail[]
    }
    const res = await ofetch<Response>(`${API_ORIGIN}/api/copilots/list`, {
        method: 'POST',
        retry: 3,
        body: { lang },
    })
    return res['data']
}

export async function recordCopilotShare(detail: CopilotDetail) {
    await ofetch(`${API_ORIGIN}/api/copilots/share-record`, {
        method: 'POST',
        body: {
            detail: detail,
        },
    })
}

export async function getRemoteConfig(config: keyof RemoteConfig) {
    type Response = {
        data: Pick<RemoteConfig, typeof config>
    }
    const res = await ofetch<Response>(`${API_ORIGIN}/api/remote_config/${config}`, {
        retry: 3,
    })
    return res['data']
}

export interface DialogConfig {
    markdown: string
    buttons: { label: string; url: string }[]
}

export async function getDialogConfig(params: { uuid: string; language: string; version: string }) {
    type Response = {
        data: null | DialogConfig
    }
    const res = await ofetch<Response>(`${API_ORIGIN}/api/dialog_config`, {
        method: 'POST',
        retry: 3,
        body: params,
    })
    return res['data'] || null
}

export async function getLicenseDetail(params: { licenseKey: string }) {
    type Response = {
        data: ChatboxAILicenseDetail | null
    }
    const res = await ofetch<Response>(`${API_ORIGIN}/api/license/detail`, {
        retry: 3,
        headers: {
            Authorization: params.licenseKey,
        },
    })
    return res['data'] || null
}

export async function getLicenseDetailRealtime(params: { licenseKey: string }) {
    type Response = {
        data: ChatboxAILicenseDetail | null
    }
    const res = await ofetch<Response>(`${API_ORIGIN}/api/license/detail/realtime`, {
        retry: 3,
        headers: {
            Authorization: params.licenseKey,
        },
    })
    return res['data'] || null
}

export async function activateLicense(params: {
    licenseKey: string,
    instanceName: string
}) {
    type Response = {
        data: {
            valid: boolean
            instanceId: string
            error: string
        }
    }
    const res = await ofetch(`${API_ORIGIN}/api/license/activate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    })
    const json: Response = await res.json()
    return json['data']
}

export async function deactivateLicense(params: {
    licenseKey: string,
    instanceId: string
}) {
    await ofetch(`${API_ORIGIN}/api/license/deactivate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    })
}

export async function validateLicense(params: {
    licenseKey: string,
    instanceId: string
}) {
    type Response = {
        data: {
            valid: boolean
        }
    }
    const res = await ofetch(`${API_ORIGIN}/api/license/validate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    })
    const json: Response = await res.json()
    return json['data']
}
