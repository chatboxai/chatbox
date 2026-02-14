from fastapi import FastAPI, Request, HTTPException
import httpx
import json
from starlette.responses import StreamingResponse
import aiomysql
import os
import sys
from contextlib import asynccontextmanager
from config import ALLOW_MODEL, DB_CONFIG, API_URL, CONFIG_API_KEY, DISABLE_NON_TEXT

# 設置行緩存，每行輸出會立即寫入文件用於背景執行
sys.stdout = os.fdopen(sys.stdout.fileno(), "w", 1)

app = FastAPI()

API_KEY = os.getenv("API_KEY", CONFIG_API_KEY)
if API_KEY is None:
    print("API_KEY is not set.")


@asynccontextmanager
async def lifespan(fastapi_app: FastAPI):
    pool = await aiomysql.create_pool(**DB_CONFIG)
    fastapi_app.state.pool = pool
    yield
    pool.close()
    await pool.wait_closed()


app.router.lifespan_context = lifespan


@app.post("/v1/images/generations")
async def images():
    # 允許功能待建置中
    raise HTTPException(status_code=401, detail="禁用非文字功能")


@app.post("/v1/chat/completions")
async def proxy(request: Request):
    client_ip = request.client.host  # 獲取來源 IP
    request_body = await request.body()  # 捕獲請求內容
    request_data = json.loads(request_body.decode())  # 解碼並轉換為 JSON 對象

    # 從請求體中提取模型名稱
    model = request_data.get("model", "No model specified")
    # 檢查模型是否在允許的列表中
    if model not in ALLOW_MODEL:
        raise HTTPException(
            status_code=401,
            detail=f"禁用模型 '{model}' , 允許的模型及日次數上限為: {ALLOW_MODEL}",
        )

    # 檢查模型使用次數是否達到上限
    limit_reached, limit = await check_model_usage_limit(
        request.app.state.pool, client_ip, model
    )
    if limit_reached:
        raise HTTPException(
            status_code=429,
            detail=f"限制模型 '{model}' , 已達到日上限 {limit}/{limit} 次",
        )
    await update_usage_count(request.app.state.pool, client_ip, model)  # 更新使用次數

    # 檢查是否有傳送非文字
    if DISABLE_NON_TEXT:
        for message in request_data.get("messages", []):
            if message["role"] == "user":
                if isinstance(message["content"], list):  # 檢查 content 是否為列表
                    for item in message["content"]:
                        if item.get("type") != "text":  # 檢查是否包含圖片 URL
                            raise HTTPException(
                                status_code=401, detail="禁用非文字功能"
                            )
                last_user_content = message.get("content")

    if isinstance(last_user_content, str):
        print("使用者IP:", client_ip)
        print("使用模型:", model)
        print("發送問題:", last_user_content)
        await save_query_to_db(
            request.app.state.pool, client_ip, model, last_user_content
        )

    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

    async def fetch_data():
        async with httpx.AsyncClient() as client:
            try:
                async with client.stream(
                    "POST", API_URL, headers=headers, content=json.dumps(request_data)
                ) as response:
                    response.raise_for_status()  # 如果狀態碼不是 200，會引發 HTTPError
                    async for chunk in response.aiter_raw():
                        yield chunk
            except httpx.HTTPStatusError as e:
                # 捕獲 HTTP 錯誤並返回給客戶端
                error_response = {
                    "error": {
                        "message": str(e),
                        "status_code": e.response.status_code,
                        "details": await e.response.aread(),
                    }
                }
                yield json.dumps(error_response).encode()

    return StreamingResponse(fetch_data(), media_type="application/json")


async def save_query_to_db(pool, user_ip, model, query):
    try:
        async with pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(
                    "INSERT INTO user_queries (user_ip, model_name, query) VALUES (%s, %s, %s)",
                    (user_ip, model, query),
                )
                await conn.commit()
    except Exception as e:
        print(f"Error saving to database: {e}")


async def check_model_usage_limit(pool, user_ip, model):
    async with pool.acquire() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(
                "SELECT usage_count FROM ip_model_usage WHERE user_ip = %s AND model_name = %s",
                (user_ip, model),
            )
            result = await cursor.fetchone()
            if result:
                usage_count = result[0]
                limit = ALLOW_MODEL[model]
                if usage_count >= limit:
                    return True, limit
    return False, 0


async def update_usage_count(pool, user_ip, model):
    async with pool.acquire() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(
                "INSERT INTO ip_model_usage (user_ip, model_name, usage_count) VALUES (%s, %s, 1) ON DUPLICATE KEY UPDATE usage_count = usage_count + 1",
                (user_ip, model),
            )
            await conn.commit()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
