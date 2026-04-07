import { Alert, Anchor, Button, Divider, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'

type View = 'login' | 'register'

export function ChatBridgeLogin() {
  const [view, setView] = useState<View>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const { login, register, loginDemo, isLoading, error } = useAuthStore()

  const handleLogin = async () => {
    setValidationError(null)
    try {
      await login(email, password)
    } catch {
      // error stored in authStore
    }
  }

  const handleRegister = async () => {
    setValidationError(null)
    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match')
      return
    }
    try {
      await register(email, password)
    } catch {
      // error stored in authStore
    }
  }

  const handleDemo = async () => {
    try {
      await loginDemo()
    } catch {
      // error stored in authStore
    }
  }

  const switchView = (next: View) => {
    setView(next)
    setValidationError(null)
  }

  const displayError = validationError ?? error

  return (
    <div className="flex items-center justify-center h-full w-full">
      <Paper shadow="md" p="xl" radius="md" withBorder w={380}>
        <Stack gap="md">
          <Title order={3} ta="center">
            ChatBridge
          </Title>

          <Button
            size="md"
            fullWidth
            onClick={() => void handleDemo()}
            loading={isLoading}
            variant="filled"
          >
            Try Demo
          </Button>

          <Divider label="or continue with email" labelPosition="center" />

          {displayError && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" p="xs">
              {displayError}
            </Alert>
          )}

          {view === 'login' ? (
            <>
              <TextInput
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleLogin()
                }}
                disabled={isLoading}
              />
              <PasswordInput
                label="Password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleLogin()
                }}
                disabled={isLoading}
              />
              <Button fullWidth onClick={() => void handleLogin()} loading={isLoading}>
                Sign In
              </Button>
              <Text ta="center" size="sm">
                No account?{' '}
                <Anchor component="button" onClick={() => switchView('register')}>
                  Create one
                </Anchor>
              </Text>
            </>
          ) : (
            <>
              <TextInput
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                disabled={isLoading}
              />
              <PasswordInput
                label="Password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                disabled={isLoading}
              />
              <PasswordInput
                label="Confirm Password"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRegister()
                }}
                disabled={isLoading}
              />
              <Button fullWidth onClick={() => void handleRegister()} loading={isLoading}>
                Create Account
              </Button>
              <Text ta="center" size="sm">
                Already have an account?{' '}
                <Anchor component="button" onClick={() => switchView('login')}>
                  Sign in
                </Anchor>
              </Text>
            </>
          )}
        </Stack>
      </Paper>
    </div>
  )
}
