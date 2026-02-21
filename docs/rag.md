技术方案

## 数据流

1. 上传文件到目录
2. 在数据库创建对每个文件预处理 task
3. 触发 worker 处理 task，work 处理完自动停止，直到下次触发
4. worker 根据后缀名或 mime type，找到 loader，如果找不到 loader 任务失败，loader 加载文件内容
5. 根据文件内容调用 embedding，写入 vector store。（vector store 因为需要操作 db 文件，需要在桌面端后端层执行，在 renderer 层通过 ipc 调用）

## 文件读取

根据文件格式，采用不同的 loader

- Mastra MDocument
  - 文本，markdown，html，json
- officeparser（免费）
  - office 类
- unstructured api（付费用户可用）
  - 其他

## embedding

- vercel ai sdk

## rerank (TODO)

- 接入 cohere, voyage, jina

## vector store

- libsql

## UI

在设置页面添加知识库管理页面，可以列出和创建知识库，每个知识库中可以添加文件，添加后进入待处理、之后存在处理中、处理完或处理失败状态。

## AI 调用知识库

提供一系列 tool 让 AI 来访问知识库，用户可以选中一个知识库，AI 可以使用

# 和目前的系统结合

- settings/provider 页面，对 ProviderModelInfo 类型，增加模型分类：`embedding`，之前的默认分类为 `chat`，只有 `chat` 模型可以选择 `capabilities`
- 知识库页面可以设置使用的 embedding 和 reranker model，默认使用模型提供方设置里找到第一个可用的
- 桌面端后端层的 rag 服务，需要使用 renderer 层的 provider 参数（baseURL 和 apikey、modelId），所以需要在 renderer 层通过 ipc 来初始化 ai sdk 的 model，每次进行知识库操作需要保证初始化已经进行过
