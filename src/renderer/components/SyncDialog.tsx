import React, { MutableRefObject, useEffect, useMemo, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import platform from '@/packages/platform'
import { SyncPayload, SyncStatusEnum } from '../../shared/types'
import { useAtom } from 'jotai/index'
import { synchronizeErrorMessage, synchronizeShowLoading } from '@/stores/atoms'
import { useTranslation } from 'react-i18next'

export interface Props {}

export default function SyncDialog(props: Props) {
    const { t } = useTranslation()
    const [loading, setLoading] = useAtom(synchronizeShowLoading);
    const [syncErrMsg, setSyncErrMsg] = useAtom(synchronizeErrorMessage);
    const [reloadConfirm, setReloadConfirm] = useState(false);

    const handleSyncCallback = (payload: SyncPayload): void => {
        switch (payload.status) {
            case SyncStatusEnum.Finished:
                setLoading(false);
                break;
            case SyncStatusEnum.InProgress:
                setLoading(true);
                break;
            case SyncStatusEnum.RequireReload:
                setLoading(false);
                setSyncErrMsg(t("Changes have been downloaded locally. Please reload to apply them immediately to your UI. Otherwise, they won’t take effect."));
                setReloadConfirm(true);
                break;
            case SyncStatusEnum.Error:
                if (payload.error_message){
                    setSyncErrMsg(payload.error_message);
                }
                break
        }
    }

    useEffect(() => {
        platform.handleSync(handleSyncCallback)
    }, [])


    const onClose = () => {
        setSyncErrMsg('')
        setReloadConfirm(false)
    }

    return (
        <Dialog
            open={syncErrMsg !== ''}
            onClose={onClose}
            aria-labelledby="alert-dialog-title"
            aria-describedby="alert-dialog-description"
        >
            <DialogTitle id="alert-dialog-title">{t("Synchronization Response")}</DialogTitle>

            <DialogContent>
                <DialogContentText id="alert-dialog-description">
                    {syncErrMsg}
                </DialogContentText>
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} color="primary" autoFocus>
                    {t('OK')}
                </Button>
                {reloadConfirm && (
                    <Button onClick={()=> {
                        platform.reloadWebview();
                    }} color="primary" autoFocus>
                        {t('Reload immediately')}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
}
