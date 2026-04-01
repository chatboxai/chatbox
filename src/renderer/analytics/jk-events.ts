// No-op event constants for open-source edition

export const JK_EVENTS = {
  ONBOARDING_CHOICE_CLICK: 'onboarding_choice_click',
  LOGIN_BUTTON_CLICK: 'login_button_click',
  FREE_LICENSE_CLAIM_CLICK: 'free_license_claim_click',
  KEY_VERIFY_SUCCESS: 'key_verify_success',
  KEY_VERIFY_FAILED: 'key_verify_failed',
  APP_LAUNCH: 'app_launch',
  PAGE_VIEW: 'page_view',
  PREVIEW_WEBPAGE_CLICK: 'preview_webpage_click',
  COPY_CODE_CLICK: 'copy_code_click',
} as const

export const JK_PAGE_NAMES = {
  CHAT_PAGE: 'chat_page',
  TASK_PAGE: 'task_page',
  SETTING_PAGE: 'setting_page',
  IMAGE_PAGE: 'image_page',
  COPILOTS_PAGE: 'copilots_page',
  HELP_PAGE: 'help_page',
  ABOUT_PAGE: 'about_page',
} as const
