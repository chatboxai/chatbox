import { Box, Button, Divider, FileButton, Flex, Stack, Switch, Text, Textarea, Title, Tooltip } from '@mantine/core'
import PersonIcon from '@mui/icons-material/Person'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { IconInfoCircle } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { chatSessionSettings, getDefaultPrompt } from 'src/shared/defaults'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import MaxContextMessageCountSlider from '@/components/MaxContextMessageCountSlider'
import SliderWithInput from '@/components/SliderWithInput'
import { useSettings } from '@/hooks/useSettings'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { add as addToast } from '@/stores/toastActions'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

export const Route = createFileRoute('/settings/chat')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const { settings, setSettings } = useSettings()

  return (
    <Stack gap="xxl" p="md">
      <Title order={5}>{t('Chat Settings')}</Title>

      {/* Avatars */}
      <Stack gap="md">
        <Stack gap="xxs">
          <Text fw="600">{t('Edit Avatars')}</Text>
          <Text size="xs" c="chatbox-tertiary">
            {t('Support jpg or png file smaller than 5MB')}
          </Text>
        </Stack>

        {/* User Avatar' */}
        <Stack>
          <Text size="xs" c="chatbox-secondary">
            {t('User Avatar')}
          </Text>
          <Flex align="center" gap="xs">
            <Box w={56} h={56} mr="xs" className=" rounded-full overflow-hidden">
              {settings.userAvatarKey ? (
                <ImageInStorage
                  storageKey={settings.userAvatarKey}
                  className="object-cover object-center w-full h-full"
                />
              ) : (
                <Flex align="center" justify="center" c="white" className="w-full h-full bg-[#bdbdbd] rounded-full">
                  <PersonIcon fontSize="medium" />
                </Flex>
              )}
            </Box>
            <FileButton
              onChange={(file) => {
                if (file) {
                  if (file.size > MAX_IMAGE_SIZE) {
                    addToast(t('Support jpg or png file smaller than 5MB'))
                    return
                  }
                  const key = StorageKeyGenerator.picture('user-avatar')
                  handleImageInputAndSave(file, key, () => setSettings({ userAvatarKey: key }))
                }
              }}
              accept="image/png,image/jpeg"
            >
              {(props) => (
                <Button {...props} variant="outline" size="xs">
                  {t('Upload Image')}
                </Button>
              )}
            </FileButton>
            {!!settings.userAvatarKey && (
              <Button color="chatbox-gray" size="xs" onClick={() => setSettings({ userAvatarKey: undefined })}>
                {t('Delete')}
              </Button>
            )}
          </Flex>
        </Stack>

        {/* Default Assistant Avatar */}
        <Stack>
          <Text size="xs" c="chatbox-secondary">
            {t('Default Assistant Avatar')}
          </Text>
          <Flex align="center" gap="xs">
            <Box w={56} h={56} mr="xs" className=" rounded-full overflow-hidden">
              {settings.defaultAssistantAvatarKey ? (
                <ImageInStorage
                  storageKey={settings.defaultAssistantAvatarKey}
                  className="object-cover object-center w-full h-full"
                />
              ) : (
                <Flex align="center" justify="center" c="white" className="w-full h-full bg-[#bdbdbd] rounded-full">
                  <SmartToyIcon fontSize="medium" />
                </Flex>
              )}
            </Box>
            <FileButton
              onChange={(file) => {
                if (file) {
                  if (file.size > MAX_IMAGE_SIZE) {
                    addToast(t('Support jpg or png file smaller than 5MB'))
                    return
                  }
                  const key = StorageKeyGenerator.picture('default-assistant-avatar')
                  handleImageInputAndSave(file, key, () => setSettings({ defaultAssistantAvatarKey: key }))
                }
              }}
              accept="image/png,image/jpeg"
            >
              {(props) => (
                <Button {...props} variant="outline" size="xs">
                  {t('Upload Image')}
                </Button>
              )}
            </FileButton>
            {!!settings.defaultAssistantAvatarKey && (
              <Button
                color="chatbox-gray"
                size="xs"
                onClick={() => setSettings({ defaultAssistantAvatarKey: undefined })}
              >
                {t('Delete')}
              </Button>
            )}
          </Flex>
        </Stack>
      </Stack>

      <Divider />

      {/* Default Settings */}
      <Stack gap="md">
        <Text fw="600">{t('Default Settings for New Conversation')}</Text>
        <Stack gap="xxs">
          <Text fw="500">{t('Prompt')}</Text>
          <Textarea
            value={settings.defaultPrompt || ''}
            autosize
            minRows={1}
            maxRows={12}
            onChange={(e) =>
              setSettings({
                defaultPrompt: e.currentTarget.value,
              })
            }
          />
          <Button
            variant="transparent"
            color="chatbox-gray"
            onClick={() => {
              setSettings({
                defaultPrompt: getDefaultPrompt(),
              })
            }}
            px={3}
            py={6}
            className=" self-start"
          >
            {t('Reset to Default')}
          </Button>
        </Stack>

        <MaxContextMessageCountSlider
          wrapperProps={{ gap: 'xxs' }}
          labelProps={{ fw: undefined }}
          value={settings?.maxContextMessageCount ?? chatSessionSettings().maxContextMessageCount!}
          onChange={(v) => setSettings({ maxContextMessageCount: v })}
        />

        <Stack gap="xxs">
          <Flex align="center" gap="xs">
            <Text size="sm">{t('Temperature')}</Text>
            <Tooltip
              label={t(
                'Modify the creativity of AI responses; the higher the value, the more random and intriguing the answers become, while a lower value ensures greater stability and reliability.'
              )}
              withArrow={true}
              maw={320}
              className="!whitespace-normal"
              zIndex={3000}
              events={{ hover: true, focus: true, touch: true }}
            >
              <IconInfoCircle size={20} className="text-[var(--mantine-color-chatbox-tertiary-text)]" />
            </Tooltip>
          </Flex>

          <SliderWithInput value={settings?.temperature} onChange={(v) => setSettings({ temperature: v })} max={2} />
        </Stack>

        <Stack gap="xxs">
          <Flex align="center" gap="xs">
            <Text size="sm">Top P</Text>
            <Tooltip
              label={t(
                'The topP parameter controls the diversity of AI responses: lower values make the output more focused and predictable, while higher values allow for more varied and creative replies.'
              )}
              withArrow={true}
              maw={320}
              className="!whitespace-normal"
              zIndex={3000}
              events={{ hover: true, focus: true, touch: true }}
            >
              <IconInfoCircle size={20} className="text-[var(--mantine-color-chatbox-tertiary-text)]" />
            </Tooltip>
          </Flex>

          <SliderWithInput value={settings?.topP} onChange={(v) => setSettings({ topP: v })} max={1} />
        </Stack>

        <Stack gap="xxs">
          <Flex align="center" gap="xs" justify="space-between">
            <Text size="sm">{t('Stream output')}</Text>
            <Switch
              // label={t('Stream output')}
              checked={settings?.stream ?? true}
              onChange={(v) => setSettings({ stream: v.target.checked })}
            />
          </Flex>
        </Stack>
      </Stack>
      <Divider />

      {/* Conversation Settings */}
      <Stack gap="md">
        <Text fw="600">{t('Conversation Settings')}</Text>

        {/* Display */}
        <Stack gap="sm">
          <Text c="chatbox-tertiary">{t('Display')}</Text>

          <Switch
            label={t('show message word count')}
            checked={settings.showWordCount}
            onChange={() =>
              setSettings({
                showWordCount: !settings.showWordCount,
              })
            }
          />

          {/* <Switch
            label={t('show message token count')}
            checked={settings.showTokenCount}
            onChange={() =>
              setSettings({
                showTokenCount: !settings.showTokenCount,
              })
            }
          /> */}

          <Switch
            label={t('show message token usage')}
            checked={settings.showTokenUsed}
            onChange={() =>
              setSettings({
                showTokenUsed: !settings.showTokenUsed,
              })
            }
          />

          <Switch
            label={t('show model name')}
            checked={settings.showModelName}
            onChange={() =>
              setSettings({
                showModelName: !settings.showModelName,
              })
            }
          />

          <Switch
            label={t('show message timestamp')}
            checked={settings.showMessageTimestamp}
            onChange={() =>
              setSettings({
                showMessageTimestamp: !settings.showMessageTimestamp,
              })
            }
          />

          <Switch
            label={t('show first token latency')}
            checked={settings.showFirstTokenLatency}
            onChange={() =>
              setSettings({
                showFirstTokenLatency: !settings.showFirstTokenLatency,
              })
            }
          />
        </Stack>

        {/* Function */}
        <Stack gap="sm">
          <Text c="chatbox-tertiary">{t('Function')}</Text>

          <Switch
            label={t('Auto-collapse code blocks')}
            checked={settings.autoCollapseCodeBlock}
            onChange={() =>
              setSettings({
                autoCollapseCodeBlock: !settings.autoCollapseCodeBlock,
              })
            }
          />
          <Switch
            label={t('Auto-Generate Chat Titles')}
            checked={settings.autoGenerateTitle}
            onChange={() =>
              setSettings({
                ...settings,
                autoGenerateTitle: !settings.autoGenerateTitle,
              })
            }
          />
          <Switch
            label={t('Spell Check')}
            checked={settings.spellCheck}
            onChange={() =>
              setSettings({
                ...settings,
                spellCheck: !settings.spellCheck,
              })
            }
          />
          <Switch
            label={t('Markdown Rendering')}
            checked={settings.enableMarkdownRendering}
            onChange={() =>
              setSettings({
                ...settings,
                enableMarkdownRendering: !settings.enableMarkdownRendering,
              })
            }
          />
          <Switch
            label={t('LaTeX Rendering (Requires Markdown)')}
            checked={settings.enableLaTeXRendering}
            onChange={() =>
              setSettings({
                ...settings,
                enableLaTeXRendering: !settings.enableLaTeXRendering,
              })
            }
          />
          <Switch
            label={t('Mermaid Diagrams & Charts Rendering')}
            checked={settings.enableMermaidRendering}
            onChange={() =>
              setSettings({
                ...settings,
                enableMermaidRendering: !settings.enableMermaidRendering,
              })
            }
          />
          <Switch
            label={t('Inject default metadata')}
            checked={settings.injectDefaultMetadata}
            description={t('e.g., Model Name, Current Date')}
            onChange={() =>
              setSettings({
                ...settings,
                injectDefaultMetadata: !settings.injectDefaultMetadata,
              })
            }
          />
          <Switch
            label={t('Auto-preview artifacts')}
            checked={settings.autoPreviewArtifacts}
            description={t('Automatically render generated artifacts (e.g., HTML with CSS, JS, Tailwind)')}
            onChange={() =>
              setSettings({
                ...settings,
                autoPreviewArtifacts: !settings.autoPreviewArtifacts,
              })
            }
          />
          <Switch
            label={t('Paste long text as a file')}
            checked={settings.pasteLongTextAsAFile}
            description={t(
              'Pasting long text will automatically insert it as a file, keeping chats clean and reducing token usage with prompt caching.'
            )}
            onChange={() =>
              setSettings({
                ...settings,
                pasteLongTextAsAFile: !settings.pasteLongTextAsAFile,
              })
            }
          />
        </Stack>
      </Stack>
    </Stack>
  )
}
