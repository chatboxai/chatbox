import React from 'react'
import Alert from '@mui/material/Alert'
import { Trans } from 'react-i18next'
import { Message } from '../../shared/types'
import { aiProviderNameHash } from '../packages/models'
import * as atoms from '../stores/atoms'
import * as settingActions from '../stores/settingActions'
import { useSetAtom } from 'jotai'
import { Link } from '@mui/material'
import { ChatboxAIAPIError } from '@/packages/models/errors'
import platform from '@/packages/platform'
import { trackingEvent } from '@/packages/event'

export default function MessageErrTips(props: { msg: Message }) {
    const { msg } = props
    const setOpenSettingDialogAtom = useSetAtom(atoms.openSettingDialogAtom)
    if (!msg.error) {
        return null
    }
    const tips: React.ReactNode[] = []
    let onlyShowTips = false 
    if (msg.error.startsWith('API Error')) {
        tips.push(
            <Trans
                i18nKey="api error tips"
                values={{
                    aiProvider: msg.aiProvider ? aiProviderNameHash[msg.aiProvider] : 'AI Provider',
                }}
                components={[]}
            />
        )
    } else if (msg.error.startsWith('Network Error')) {
        tips.push(
            <Trans
                i18nKey="network error tips"
                values={{
                    host: msg.errorExtra?.['host'] || 'AI Provider',
                }}
            />
        )
        const proxy = settingActions.getProxy()
        if (proxy) {
            tips.push(<Trans i18nKey="network proxy error tips" values={{ proxy }} />)
        }
    } else if (msg.errorCode === 10003) {
        tips.push(
            <Trans
                i18nKey="ai provider no implemented paint tips"
                values={{
                    aiProvider: msg.aiProvider ? aiProviderNameHash[msg.aiProvider] : 'AI Provider',
                }}
                components={[
                    <Link className="cursor-pointer font-bold" onClick={() => setOpenSettingDialogAtom('ai')}></Link>,
                ]}
            />
        )
    } else if (msg.errorCode && ChatboxAIAPIError.getDetail(msg.errorCode)) {
        const chatboxAIErrorDetail = ChatboxAIAPIError.getDetail(msg.errorCode)
        if (chatboxAIErrorDetail) {
            onlyShowTips = true
            tips.push(
                <Trans
                    i18nKey={chatboxAIErrorDetail.i18nKey}
                    values={{
                        model: msg.model,
                    }}
                    components={{
                        OpenSettingButton: (
                            <Link className="cursor-pointer italic" onClick={() => setOpenSettingDialogAtom('ai')}></Link>
                        ),
                        OpenMorePlanButton: (<div></div>)
                    }}
                />
            )
        }
    } else {
        tips.push(
            <Trans
                i18nKey="unknown error tips"
                components={[
                    <a
                        target="_blank"
                    ></a>,
                ]}
            />
        )
    }
    return (
        <Alert icon={false} severity="error">
            {tips.map((tip, i) => (<b key={i}>{tip}</b>))}
            {
                onlyShowTips
                    ? <></>
                    : <>
                        <br />
                        <br />
                        {msg.error}
                    </>
            }
        </Alert>
    )
}
