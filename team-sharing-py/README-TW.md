# Chatbox: 團隊共享 OpenAI API 資源的解決方案
[English](./README.md) | [中文介紹](./README_zh.md)

Chatbox 能夠讓你的團隊成員在共享同一個 OpenAI API 賬號資源的同時，保護你的 API KEY 不被暴露。這個 Python 工具不僅簡單地轉發請求，還能記錄團隊成員的發送紀錄，控制高消費（如圖片生成）等功能，並設置每日調用上限，有效防止團隊中濫用的情況。

## 使用說明

### 1. 搭建 MySQL 數據庫
首先需要在本地搭建 MySQL 數據庫，並創建以下數據表：

```sql
CREATE TABLE user_queries ( 
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_ip VARCHAR(255) NOT NULL,
    model_name VARCHAR(255) NOT NULL,
    query TEXT NOT NULL,
    datetime DATETIME DEFAULT CURRENT_TIMESTAMP 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ip_model_usage (
    user_ip VARCHAR(15) NOT NULL,
    model_name VARCHAR(50) NOT NULL,
    usage_count INT NOT NULL DEFAULT '0',
    datetime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_ip, model_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2. 啟用數據庫事件
在 MySQL 配置文件中啟用事件調度器：

```ini
[mysqld]
event_scheduler = ON
```

### 3. 設置每日清空使用紀錄
創建一個每日清空 `ip_model_usage` 表的事件：

```sql
CREATE EVENT IF NOT EXISTS clear_ip_model_usage
ON SCHEDULE EVERY 1 DAY STARTS TIMESTAMP(CURRENT_DATE, '00:00:00')
DO
  TRUNCATE TABLE chatbox_server.ip_model_usage;
```

### 4. 配置文件
所有相關設置都在 `config.py` 文件中。你可以使用環境變數來替換 API_KEY，例如：

```bash
export API_KEY="sk-xxxx"
```

### 5. 安裝所需套件
運行以下命令來安裝所需的 Python 套件：

```bash
pip install -r requirements.txt
```