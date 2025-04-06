import {
    Typography,
    Box,
    useTheme,
    Tabs,
    Tab,
    FormGroup,
    FormControlLabel,
    Checkbox,
    Button, Modal
} from '@mui/material'
import { Settings } from '../../../shared/types'
import { useTranslation } from 'react-i18next'
import { Accordion, AccordionSummary, AccordionDetails } from '../../components/Accordion'
import TextFieldReset from '../../components/TextFieldReset'
import { useAtom } from 'jotai'
import * as atoms from '../../stores/atoms'
import storage, { StorageKey } from '../../storage'
import { useState, useRef } from 'react'
import platform from '../../packages/platform'
import CircularProgress from '@mui/material/CircularProgress'

interface Props {
    settingsEdit: Settings
    setSettingsEdit: (settings: Settings) => void
    onCancel: () => void
}

export default function AdvancedSettingTab(props: Props) {
    const { settingsEdit, setSettingsEdit } = props
    const { t } = useTranslation()
    return (
        <Box>
            <Accordion>
                <AccordionSummary aria-controls="panel1a-content">
                    <Typography>{t('Network Proxy')}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <TextFieldReset
                        label={t('Proxy Address')}
                        value={settingsEdit.proxy || ''}
                        onValueChange={(value) => {
                            setSettingsEdit({ ...settingsEdit, proxy: value.trim() })
                        }}
                        placeholder="socks5://127.0.0.1:6153"
                        fullWidth
                        margin="dense"
                        variant="outlined"
                    />
                </AccordionDetails>
            </Accordion>
            <Accordion>
                <AccordionSummary aria-controls="panel1a-content">
                    <Typography>{t('Reset Data')}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <ResetData />
                </AccordionDetails>
            </Accordion>
            <Accordion>
                <AccordionSummary aria-controls="panel1a-content">
                    <Typography>{t('Data Backup and Restore')}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <ExportAndImport onCancel={props.onCancel} />
                </AccordionDetails>
            </Accordion>
            <Accordion>
                <AccordionSummary aria-controls="panel1a-content">
                    <Typography>{t('Error Reporting')}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <AnalyticsSetting />
                </AccordionDetails>
            </Accordion>
        </Box>
    )
}

export function AnalyticsSetting() {
    const { t } = useTranslation()
    return (
        <Box>
            <div>
                <p className='opacity-70'>
                    {t('Chatbox respects your privacy and only uploads anonymous error data and events when necessary. You can change your preferences at any time in the settings.')}
                </p>
            </div>
            <div className='my-2'>
                <AllowReportingAndTrackingCheckbox />
            </div>
        </Box>
    )
}

export function ResetData() {
    const { t } = useTranslation();
    const [isResetting, setIsResetting] = useState(false); // State to track progress
    const [resetComplete, setResetComplete] = useState(false); // State to track completion

    const handleReset = async () => {
        setIsResetting(true); // Show progress popup
        try {
            await platform.resetSettings(); // Reset data
            setResetComplete(true); // Mark reset as complete
        } catch (error) {
            console.error('Reset failed:', error);
        } finally {
            setIsResetting(false); // Hide progress popup
        }
    };

    return (
        <Box>
            <div>
                <p className='opacity-70'>
                    {t('Reset-Data-Text')}
                </p>
            </div>
            <div className='my-2'>
                <Button color={'error'} onClick={handleReset} disabled={isResetting}>
                    {t('Reset-Data-Button')}
                </Button>
            </div>

            {/* Progress Popup */}
            <Modal open={isResetting} onClose={() => setIsResetting(false)}>
                <Box sx={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    bgcolor: 'background.paper',
                    boxShadow: 24,
                    p: 4,
                    borderRadius: 1,
                    textAlign: 'center',
                }}>
                    <CircularProgress /> {/* Loading indicator */}
                    <Typography variant="h6" sx={{ mt: 2 }}>
                        {resetComplete ? t('Reset-Complete') : t('Resetting-Data')}
                    </Typography>
                </Box>
            </Modal>
        </Box>
    );
}

export function AllowReportingAndTrackingCheckbox(props: {
    className?: string
}) {
    const { t } = useTranslation()
    const [allowReportingAndTracking, setAllowReportingAndTracking] = useAtom(atoms.allowReportingAndTrackingAtom)
    return (
        <span className={props.className}>
            <input
                type='checkbox'
                checked={allowReportingAndTracking}
                onChange={(e) => setAllowReportingAndTracking(e.target.checked)}
            />
            {t('Enable optional anonymous reporting of crash and event data')}
        </span>
    )
}

enum ExportDataItem {
    Setting = 'setting',
    Conversations = 'conversations',
    Copilot = 'copilot',
}

function ExportAndImport(props: { onCancel: () => void }) {
    const { t } = useTranslation()
    const theme = useTheme()
    const [tab, setTab] = useState<'export' | 'import'>('export')
    const [exportItems, setExportItems] = useState<ExportDataItem[]>([
        ExportDataItem.Setting,
        ExportDataItem.Conversations,
        ExportDataItem.Copilot,
    ])
    const importInputRef = useRef<HTMLInputElement>(null)
    const [importTips, setImportTips] = useState('')
    const onExport = async () => {
        const data = await storage.getAll()
        if (!exportItems.includes(ExportDataItem.Setting)) {
            delete data[StorageKey.Settings]
        }
        if (!exportItems.includes(ExportDataItem.Conversations)) {
            delete data[StorageKey.ChatSessions]
        }
        if (!exportItems.includes(ExportDataItem.Copilot)) {
            delete data[StorageKey.MyCopilots]
        }
        const date = new Date()
        data['__exported_items'] = exportItems
        data['__exported_at'] = date.toISOString()
        const dateStr = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
        platform.exporter.exportTextFile(`chatbox-exported-data-${dateStr}.json`, JSON.stringify(data))
    }
    const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const errTip = t('Import failed, unsupported data format')
        const file = e.target.files?.[0]
        if (!file) {
            return
        }
        const reader = new FileReader()
        reader.onload = (event) => {
            ; (async () => {
                setImportTips('')
                try {
                    let result = event.target?.result
                    if (typeof result !== 'string') {
                        throw new Error('FileReader result is not string')
                    }
                    const json = JSON.parse(result)
                    await storage.setAll(json)
                    props.onCancel()
                    platform.relaunch()
                } catch (err) {
                    setImportTips(errTip)

                    throw err
                }
            })()
        }
        reader.onerror = (event) => {
            setImportTips(errTip)
            const err = event.target?.error
            if (!err) {
                throw new Error('FileReader error but no error message')
            }
            throw err
        }
        reader.readAsText(file)
    }
    return (
        <Box
            sx={{
                backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[100],
            }}
            className="p-4"
        >
            <Tabs value={tab} onChange={(_, value) => setTab(value)} className="mb-4">
                <Tab
                    value="export"
                    label={<span className="inline-flex justify-center items-center">{t('Data Backup')}</span>}
                />
                <Tab
                    value="import"
                    label={<span className="inline-flex justify-center items-center">{t('Data Restore')}</span>}
                />
            </Tabs>
            {tab === 'export' && (
                <Box sx={{}}>
                    <FormGroup className="mb-2">
                        {[
                            { label: t('Settings'), value: ExportDataItem.Setting },
                            { label: t('Chat History'), value: ExportDataItem.Conversations },
                            { label: t('My Copilots'), value: ExportDataItem.Copilot },
                        ].map((item) => (
                            <FormControlLabel
                                label={item.label}
                                control={
                                    <Checkbox
                                        checked={exportItems.includes(item.value)}
                                        onChange={(e, checked) => {
                                            if (checked && !exportItems.includes(item.value)) {
                                                setExportItems([...exportItems, item.value])
                                            } else if (!checked) {
                                                setExportItems(exportItems.filter((v) => v !== item.value))
                                            }
                                        }}
                                    />
                                }
                            />
                        ))}
                    </FormGroup>
                    <Button variant="contained" color="primary" onClick={onExport}>
                        {t('Export Selected Data')}
                    </Button>
                </Box>
            )}
            {tab === 'import' && (
                <Box>
                    <Box className="p-1">
                        {t('Upon import, changes will take effect immediately and existing data will be overwritten')}
                    </Box>
                    {importTips && <Box className="p-1 text-red-600">{importTips}</Box>}
                    <input style={{ display: 'none' }} type="file" ref={importInputRef} onChange={onImport} />
                    <Button variant="contained" color="primary" onClick={() => importInputRef.current?.click()}>
                        {t('Import and Restore')}
                    </Button>
                </Box>
            )}
        </Box>
    )
}
