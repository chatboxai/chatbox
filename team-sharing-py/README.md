# Chatbox: Team Shared OpenAI API Resource Solution
[English](./README.md) | [中文介紹](./README_zh.md)

Chatbox allows your team members to share the same OpenAI API account resources while protecting your API KEY from being exposed. This Python tool not only forwards requests but also records the sending history of team members, controls high-cost activities (such as image generation), and sets daily call limits to effectively prevent abuse within the team.

## Instructions

### 1. Setup MySQL Database
First, set up a MySQL database locally and create the following tables:

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

### 2. Enable Database Events
Enable the event scheduler in the MySQL configuration file:

```ini
[mysqld]
event_scheduler = ON
```

### 3. Set Up Daily Usage Record Clearing
Create an event to clear the `ip_model_usage` table daily:

```sql
CREATE EVENT IF NOT EXISTS clear_ip_model_usage
ON SCHEDULE EVERY 1 DAY STARTS TIMESTAMP(CURRENT_DATE, '00:00:00')
DO
  TRUNCATE TABLE chatbox_server.ip_model_usage;
```

### 4. Configuration File
All related settings are in the `config.py` file. You can use environment variables to replace the API_KEY, for example:

```bash
export API_KEY="sk-xxxx"
```

### 5. Install Required Packages
Run the following command to install the required Python packages:

```bash
pip install -r requirements.txt
```