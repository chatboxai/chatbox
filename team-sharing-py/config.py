# 允許的模型及單日使用次數
ALLOW_MODEL = {
    "gpt-4o": 30,
    "gpt-4o-mini": 100
}

# 資料庫連接設定
DB_CONFIG = {
    'host': '127.0.0.1',
    'port': 3306,
    'user': 'chatbox_server',
    'password': 'xxxxxxxx',
    'db': 'chatbox_server',
}

# API端點
API_URL = "https://api.openai.com/v1/chat/completions"

# API金鑰
CONFIG_API_KEY = None

# 禁用非文字功能
DISABLE_NON_TEXT = True
