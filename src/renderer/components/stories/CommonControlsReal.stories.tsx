import { Box, Button, Group, Paper, Stack, Text } from '@mantine/core'
import { MenuList, Button as MuiButton } from '@mui/material'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconPencil, IconRefresh, IconTrash } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { AdaptiveModal } from '../common/AdaptiveModal'
import { ConfirmDeleteButton, ConfirmDeleteMenuItem } from '../common/ConfirmDeleteButton'
import CreatableSelect from '../common/CreatableSelect'
import LazyNumberInput from '../common/LazyNumberInput'
import { LazySlider } from '../common/LazySlider'
import MaxContextMessageCountSlider from '../common/MaxContextMessageCountSlider'
import { MessageLayoutSelector } from '../common/MessageLayoutPreview'
import MiniButton from '../common/MiniButton'
import PasswordTextField from '../common/PasswordTextField'
import PopoverConfirm from '../common/PopoverConfirm'
import { ScalableIcon } from '../common/ScalableIcon'
import SliderWithInput from '../common/SliderWithInput'
import TemperatureSlider from '../common/TemperatureSlider'
import TextFieldReset from '../common/TextFieldReset'
import TopPSlider from '../common/TopPSlider'

const meta: Meta = {
  title: 'Real Components/Common Controls',
  decorators: [
    (Story) => (
      <Box p="lg" bg="var(--chatbox-background-primary)" style={{ maxWidth: 900, minHeight: 540 }}>
        <Story />
      </Box>
    ),
  ],
}

export default meta

export const AdaptiveModalStates: StoryObj = {
  name: 'Adaptive modal open actions and close button states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/common/AdaptiveModal'],
  },
  render: () => {
    const [opened, setOpened] = useState(true)

    return (
      <Stack gap="lg">
        <SurfaceLabel
          title="AdaptiveModal"
          description="Actual adaptive modal shell used for shared desktop modal and mobile drawer flows."
        />
        <Button onClick={() => setOpened(true)}>Open adaptive modal</Button>
        <AdaptiveModal opened={opened} onClose={() => setOpened(false)} title="Reset model settings?">
          <Text size="sm">
            This modal uses the same AdaptiveModal.Actions and CloseButton slots as production forms.
          </Text>
          <AdaptiveModal.Actions>
            <AdaptiveModal.CloseButton onClick={() => setOpened(false)} />
            <Button color="chatbox-brand" onClick={() => setOpened(false)}>
              Save changes
            </Button>
          </AdaptiveModal.Actions>
        </AdaptiveModal>
      </Stack>
    )
  },
}

export const ConfirmDeleteStates: StoryObj = {
  name: 'Confirm delete button and menu item idle confirm states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/common/ConfirmDeleteButton'],
  },
  render: () => <ConfirmDeleteFixture />,
}

export const PopoverConfirmStates: StoryObj = {
  name: 'Popover confirm opened and confirm action states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/common/PopoverConfirm'],
  },
  render: () => <PopoverConfirmFixture />,
}

export const MessageLayoutSelectorStates: StoryObj = {
  name: 'Message layout selector classic bubble selected states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/common/MessageLayoutPreview'],
  },
  render: () => {
    const [layout, setLayout] = useState<'classic' | 'bubble'>('bubble')

    return (
      <Stack gap="lg">
        <SurfaceLabel
          title="MessageLayoutSelector"
          description="Actual settings control for choosing the classic or bubble chat layout."
        />
        <MessageLayoutSelector value={layout} onValueChange={setLayout} />
        <MessageLayoutSelector value="classic" onValueChange={() => undefined} size="sm" />
      </Stack>
    )
  },
}

export const NumericControlsStates: StoryObj = {
  name: 'Lazy number slider combined slider and context count states',
  parameters: {
    uiInventoryTargets: [
      'src/renderer/components/common/LazyNumberInput',
      'src/renderer/components/common/LazySlider',
      'src/renderer/components/common/SliderWithInput',
      'src/renderer/components/common/MaxContextMessageCountSlider',
    ],
  },
  render: () => {
    const [lazyNumber, setLazyNumber] = useState<number | undefined>(24)
    const [lazySlider, setLazySlider] = useState(0.38)
    const [sliderWithInput, setSliderWithInput] = useState<number | undefined>(0.72)
    const [contextMessages, setContextMessages] = useState(Number.MAX_SAFE_INTEGER)

    return (
      <Stack gap="lg">
        <SurfaceLabel
          title="Lazy numeric controls"
          description="Actual deferred-change numeric inputs used by settings forms and context controls."
        />
        <Paper withBorder radius="md" p="md">
          <Stack gap="md">
            <Group align="center">
              <Text size="sm" w={180}>
                Lazy number
              </Text>
              <LazyNumberInput value={lazyNumber} min={0} max={128} onChange={setLazyNumber} />
              <LazyNumberInput value={undefined} placeholder="Not set" onChange={() => undefined} hideControls />
              <LazyNumberInput value={32} disabled onChange={() => undefined} />
            </Group>
            <Stack gap="xs">
              <Text size="sm">Lazy slider</Text>
              <LazySlider value={lazySlider} min={0} max={1} step={0.01} onChange={setLazySlider} />
            </Stack>
            <Stack gap="xs">
              <Text size="sm">Slider with input</Text>
              <SliderWithInput value={sliderWithInput} onChange={setSliderWithInput} />
            </Stack>
            <MaxContextMessageCountSlider value={contextMessages} onChange={setContextMessages} />
          </Stack>
        </Paper>
      </Stack>
    )
  },
}

export const ModelParameterSliderStates: StoryObj = {
  name: 'Temperature and top-p slider settings states',
  parameters: {
    uiInventoryTargets: [
      'src/renderer/components/common/TemperatureSlider',
      'src/renderer/components/common/TopPSlider',
    ],
  },
  render: () => {
    const [temperature, setTemperature] = useState(0.7)
    const [topP, setTopP] = useState(0.9)

    return (
      <Stack gap="lg">
        <SurfaceLabel
          title="Model parameter sliders"
          description="Actual legacy settings sliders for temperature and top-p with text input mirrors."
        />
        <Paper withBorder radius="md" p="md">
          <TemperatureSlider value={temperature} onChange={setTemperature} />
          <TopPSlider topP={topP} setTopP={setTopP} />
        </Paper>
      </Stack>
    )
  },
}

export const FormFieldStates: StoryObj = {
  name: 'Creatable select password reset and mini button states',
  parameters: {
    uiInventoryTargets: [
      'src/renderer/components/common/CreatableSelect',
      'src/renderer/components/common/PasswordTextField',
      'src/renderer/components/common/TextFieldReset',
      'src/renderer/components/common/MiniButton',
    ],
  },
  render: () => {
    const [provider, setProvider] = useState('OpenAI')
    const [providers, setProviders] = useState(['OpenAI', 'Claude', 'Gemini'])
    const [password, setPassword] = useState('sk-storybook-redacted')
    const [apiHost, setApiHost] = useState('https://api.openai.com/v1')

    return (
      <Stack gap="lg">
        <SurfaceLabel
          title="Form field controls"
          description="Actual settings form controls for custom options, masked secrets, resettable text, and compact icon actions."
        />
        <Paper withBorder radius="md" p="md">
          <Stack gap="md">
            <CreatableSelect
              label="Provider"
              value={provider}
              options={providers}
              onChangeValue={setProvider}
              onUpdateOptions={setProviders}
            />
            <PasswordTextField
              label="API Key"
              value={password}
              setValue={setPassword}
              helperText="The visibility toggle is the production password field affordance."
            />
            <TextFieldReset
              label="API Host"
              fullWidth
              value={apiHost}
              defaultValue="https://api.openai.com/v1"
              onValueChange={setApiHost}
              helperText="Reset button appears when the value differs from the default."
            />
            <Group>
              <MiniButton tooltipTitle="Edit provider">
                <ScalableIcon icon={IconPencil} size={18} />
              </MiniButton>
              <MiniButton disabled tooltipTitle="Disabled refresh">
                <ScalableIcon icon={IconRefresh} size={18} />
              </MiniButton>
            </Group>
          </Stack>
        </Paper>
      </Stack>
    )
  },
}

function ConfirmDeleteFixture() {
  const buttonWrapperRef = useRef<HTMLDivElement>(null)
  const menuWrapperRef = useRef<HTMLDivElement>(null)
  const [deleted, setDeleted] = useState(0)

  useEffect(() => {
    const button = buttonWrapperRef.current?.querySelector('button')
    const menuItem = menuWrapperRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null
    button?.click()
    menuItem?.click()
  }, [])

  return (
    <Stack gap="lg">
      <SurfaceLabel
        title="ConfirmDeleteButton and ConfirmDeleteMenuItem"
        description="Actual two-step destructive action controls, including the confirmation state after the first click."
      />
      <Group align="flex-start">
        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb="xs">
            Button confirmation
          </Text>
          <div ref={buttonWrapperRef}>
            <ConfirmDeleteButton
              label="Delete provider"
              icon={<ScalableIcon icon={IconTrash} size={18} />}
              onDelete={() => setDeleted((value) => value + 1)}
            />
          </div>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb="xs">
            Menu item confirmation
          </Text>
          <MenuList ref={menuWrapperRef}>
            <ConfirmDeleteMenuItem label="Delete model" onDelete={() => setDeleted((value) => value + 1)} />
          </MenuList>
        </Paper>
        <Text size="sm" c="dimmed">
          Confirmed actions: {deleted}
        </Text>
      </Group>
    </Stack>
  )
}

function PopoverConfirmFixture() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    const button = wrapperRef.current?.querySelector('button')
    button?.click()
  }, [])

  return (
    <Stack gap="lg">
      <SurfaceLabel
        title="PopoverConfirm"
        description="Actual confirmation popover that clones its child trigger while preserving the original button behavior."
      />
      <div ref={wrapperRef}>
        <PopoverConfirm
          title="Clear all generated images?"
          confirmButtonText="Clear images"
          confirmButtonColor="red"
          onConfirm={() => setConfirmed(true)}
          withinPortal={false}
        >
          <MuiButton variant="outlined" color="error">
            Clear image cache
          </MuiButton>
        </PopoverConfirm>
      </div>
      <Text size="sm" c="dimmed">
        Confirmed: {confirmed ? 'yes' : 'no'}
      </Text>
    </Stack>
  )
}

function SurfaceLabel({ title, description }: { title: string; description: string }) {
  return (
    <Box>
      <Text fw={700}>{title}</Text>
      <Text size="sm" c="dimmed">
        {description}
      </Text>
    </Box>
  )
}
