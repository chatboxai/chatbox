import { Box, Divider } from '@mui/material'
import { ModelSettings, OpenAICompModel, OpenAICompProviderSettings } from '../../../shared/types'
import AIProviderSelect from '../../components/AIProviderSelect'
import OpenAICompModelSelect from '@/components/OpenAICompModelSelect'
import * as React from 'react'
import { OpenAICompModelConfigure } from '@/components/OpenAICompModelConfigure'
import { useEffect, useState } from 'react'
import { v4 as uuid } from 'uuid';

interface ModelConfigProps {
    settingsEdit: ModelSettings
    setSettingsEdit: (settings: ModelSettings) => void
}

export default function ModelSettingTab(props: ModelConfigProps) {
    const { settingsEdit, setSettingsEdit } = props

    const [modalAddAIProvider, setModalAddAIProvider] = React.useState(false);
    const [currentProvider, setCurrentProvider] = useState<OpenAICompProviderSettings | undefined>();

    useEffect(() => {
        // Sync currentProvider when provider list or selected ID changes
        const provider = settingsEdit.modelProviderList?.find(
            (p) => p.uuid === settingsEdit.modelProviderID || p.name === settingsEdit.modelProvider
        );
        setCurrentProvider(provider);
    }, [settingsEdit.modelProviderID, settingsEdit.modelProviderList]);

    useEffect(() => {
        // Update provider list when currentProvider changes
        if (!currentProvider) return;

        setSettingsEdit({
            ...settingsEdit,
            modelProviderList: settingsEdit.modelProviderList.some(p => p.uuid === currentProvider.uuid)
                ? settingsEdit.modelProviderList.map(p =>
                    p.uuid === currentProvider.uuid ? currentProvider : p
                )
                : [...settingsEdit.modelProviderList, currentProvider]
        });
    }, [currentProvider]);

    const upsertProvider = (
        list: OpenAICompProviderSettings[],
        newItem: OpenAICompProviderSettings
    ): OpenAICompProviderSettings[] => {

        if (list === null || list === undefined) {
            return [newItem]
        }

        // Create a copy to avoid mutating the original array
        const newList = [...list];
        const existingIndex = newList.findIndex(item => item.uuid === newItem.uuid);

        if (existingIndex > -1) {
            // Update existing item (replace completely)
            newList[existingIndex] = newItem;

        } else {
            // Add new item
            newList.push(newItem);
        }

        return newList;
    };

    return (
        <Box>
            <AIProviderSelect
                settings={settingsEdit}
                setSettings={setSettingsEdit}
                openModalAddAIProvider={setModalAddAIProvider}
            />
            {settingsEdit.aiProvider !== 'openai-compatible' && (
                <Divider sx={{ marginTop: '10px', marginBottom: '24px' }} />
            )}

            <OpenAICompModelSelect
                open={modalAddAIProvider}
                onClose={function (): void {
                    setModalAddAIProvider(false)
                }}
                settings={settingsEdit}
                setSettings={setSettingsEdit}
                onSave={(settings)=>{
                    settingsEdit.modelProviderList = upsertProvider(settingsEdit.modelProviderList,settings)
                }}
            />

            {currentProvider && (
                <OpenAICompModelConfigure
                   provider={currentProvider}
                   setProvider={setCurrentProvider}
                />
            )}
        </Box>
    )
}
